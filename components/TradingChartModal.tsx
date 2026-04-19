"use client";

import { useState, useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  HistogramSeries,
} from "lightweight-charts";
import { IconX, IconChevronLeft, IconChartBar, IconCurrencyRupee, IconLayoutGrid } from "@tabler/icons-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { optionsApi, accountApi, createWS } from "@/lib/api";
import { calcRR } from "@/lib/options";
import { getLotSize } from "@/lib/constants";
import { useTheme } from "@/lib/theme";

// ── Types ─────────────────────────────────────────────────────────────────────
type TfLabel = "1m" | "3m" | "5m" | "10m" | "15m" | "1h" | "4h" | "1D" | "1W";
type ChartType = "candle" | "ha" | "line" | "area";

function toHeikinAshi(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c  = candles[i];
    const hc = (c.open + c.high + c.low + c.close) / 4;
    const ho = i === 0 ? (c.open + c.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    const hh = Math.max(c.high, ho, hc);
    const hl = Math.min(c.low,  ho, hc);
    out.push({ time: c.time, open: ho, high: hh, low: hl, close: hc, volume: c.volume });
  }
  return out;
}
type Indicator = "RSI" | "BB" | "VOL";

interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradingChartModalProps {
  token: number;
  strike: number;
  type: "CE" | "PE";
  expiry: string;
  sym: string;
  tradingsymbol?: string;
  index?: string;        // "NIFTY" | "SENSEX"
  isEquity?: boolean;   // NSE equity stock (no strike/expiry)
  isIndex?: boolean;    // Index chart — no Buy/Sell
  prevClose?: number;   // passed from IndexSwiper for simple view
  ltpChange?: number;   // passed from IndexSwiper for simple view
  onClose: () => void;
  onOpenChain?: (chainIndex: "NIFTY" | "SENSEX") => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const MONO = { fontFamily: "'Space Mono', monospace" } as const;

type TfConfig = { label: TfLabel; kiteInterval: string; fromDays: number; aggMinutes: number };

const TF_LIST: TfConfig[] = [
  { label: "1m",  kiteInterval: "minute",   fromDays: 2,   aggMinutes: 1    },
  { label: "3m",  kiteInterval: "minute",   fromDays: 2,   aggMinutes: 3    },
  { label: "5m",  kiteInterval: "minute",   fromDays: 3,   aggMinutes: 5    },
  { label: "10m", kiteInterval: "minute",   fromDays: 4,   aggMinutes: 10   },
  { label: "15m", kiteInterval: "minute",   fromDays: 5,   aggMinutes: 15   },
  { label: "1h",  kiteInterval: "60minute", fromDays: 20,  aggMinutes: 0    },
  { label: "4h",  kiteInterval: "60minute", fromDays: 45,  aggMinutes: 240  },
  { label: "1D",  kiteInterval: "day",      fromDays: 90,  aggMinutes: 0    },
  { label: "1W",  kiteInterval: "day",      fromDays: 1825, aggMinutes: 7200 },
];

const HOLIDAYS_2026 = new Set([
  "2026-01-26", "2026-02-18", "2026-03-20", "2026-04-03",
  "2026-04-14", "2026-05-01", "2026-05-19", "2026-06-16",
  "2026-10-02", "2026-10-22", "2026-11-10", "2026-11-11",
  "2026-11-30", "2026-12-25",
]);

// ── Pure helpers ──────────────────────────────────────────────────────────────
function istToUnix(s: string): number {
  const [dp, tp] = s.split(" ");
  const [dd, mm, yyyy] = dp.split("-");
  const [hh, mi] = (tp ?? "09:15").split(":");
  return Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi) / 1000;
}

function getPrevTradingDay(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  for (let i = 0; i < 10; i++) {
    const day = d.getDay();
    const str = d.toISOString().split("T")[0];
    if (day !== 0 && day !== 6 && !HOLIDAYS_2026.has(str)) return str;
    d.setDate(d.getDate() - 1);
  }
  return d.toISOString().split("T")[0];
}

function dateFromDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

// ── Zerodha charge calculator (Kite brokerage structure) ─────────────────────
function calcEquityCharges(price: number, qty: number, isIntraday: boolean) {
  const turnover = price * qty;
  // Brokerage: delivery = ₹0; intraday = min(0.03%, ₹20) per leg
  const brokPerLeg = isIntraday ? Math.min(turnover * 0.0003, 20) : 0;
  const brokerage  = brokPerLeg * 2; // buy + sell legs
  // STT: delivery = 0.1% both sides; intraday = 0.025% sell only
  const stt = isIntraday ? turnover * 0.00025 : turnover * 0.002;
  // Exchange transaction charges (NSE): 0.00307%
  const txn  = turnover * 0.0000307 * 2;
  // SEBI turnover fee: ₹10/crore = 0.000001 per ₹
  const sebi = turnover * 0.000001 * 2;
  // Stamp duty on buy side only: intraday 0.003%; delivery 0.015%
  const stamp = turnover * (isIntraday ? 0.00003 : 0.00015);
  // GST 18% on (brokerage + SEBI + transaction)
  const gst  = (brokerage + sebi + txn) * 0.18;
  const total = brokerage + stt + txn + sebi + stamp + gst;
  return { brokerage, stt, txn, sebi, stamp, gst, total };
}

// Returns the first trading day of the current expiry cycle.
// Expiry is YYYY-MM-DD. NSE weekly = 7 cal days, monthly ≤ 35 cal days.
function getExpiryStart(expiry: string): string {
  const exp = new Date(expiry + "T00:00:00Z");
  exp.setUTCDate(exp.getUTCDate() - 35); // go back far enough to cover any monthly expiry
  const today = new Date();
  return (exp > today ? today : exp).toISOString().split("T")[0];
}

// Keep only intraday candles within market hours (9:15 AM – 3:30 PM IST)
// Works because istToUnix encodes IST time as UTC unix seconds
function filterMarketHours(candles: Candle[]): Candle[] {
  const open  = 9 * 3600 + 15 * 60;  // 9:15 AM
  const close = 15 * 3600 + 30 * 60; // 3:30 PM
  return candles.filter(c => { const s = c.time % 86400; return s >= open && s <= close; });
}

function aggregate(candles: Candle[], minutes: number): Candle[] {
  if (minutes <= 1) return candles;
  const buckets = new Map<number, Candle[]>();
  for (const c of candles) {
    const b = Math.floor(c.time / (minutes * 60)) * (minutes * 60);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b)!.push(c);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([t, cs]) => ({
      time:   t,
      open:   cs[0].open,
      high:   Math.max(...cs.map(c => c.high)),
      low:    Math.min(...cs.map(c => c.low)),
      close:  cs[cs.length - 1].close,
      volume: cs.reduce((s, c) => s + c.volume, 0),
    }));
}

function computeRSI(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let sg = 0, sl = 0, ag = 0, al = 0, warm = false;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = Math.max(d, 0), l2 = Math.max(-d, 0);
    if (!warm) {
      sg += g; sl += l2;
      const sag = sg / i, sal = sl / i;
      out[i] = sal === 0 ? 100 : +(100 - 100 / (1 + sag / sal)).toFixed(2);
      if (i >= period) { ag = sg / period; al = sl / period; warm = true; }
    } else {
      ag = (ag * (period - 1) + g) / period;
      al = (al * (period - 1) + l2) / period;
      out[i] = al === 0 ? 100 : +(100 - 100 / (1 + ag / al)).toFixed(2);
    }
  }
  return out;
}

function computeBB(closes: number[], period = 20, mult = 2) {
  return closes.map((_, i) => {
    const p   = Math.min(i + 1, period); // grow from 1 up to full period
    const sl  = closes.slice(i - p + 1, i + 1);
    const mid = sl.reduce((a, b) => a + b, 0) / p;
    const sd  = Math.sqrt(sl.reduce((a, b) => a + (b - mid) ** 2, 0) / p);
    return { mid: +mid.toFixed(2), up: +(mid + mult * sd).toFixed(2), dn: +(mid - mult * sd).toFixed(2) };
  });
}

// ── Component ─────────────────────────────────────────────────────────────────
const SIMPLE_PERIOD_TF: Record<string, TfLabel> = {
  "1D": "1m", "1W": "1D", "1M": "1D", "3M": "1D", "6M": "1D", "1Y": "1D", "5Y": "1W",
};
const SIMPLE_PERIOD_DAYS: Record<string, number> = {
  "1D": 1, "1W": 7, "1M": 30, "3M": 90, "6M": 180, "1Y": 365, "5Y": 1825,
};

export default function TradingChartModal({
  token, strike, type, expiry, sym, tradingsymbol, index = "NIFTY", isEquity = false, isIndex = false,
  prevClose, ltpChange, onClose, onOpenChain,
}: TradingChartModalProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  // Theme palette — matches the options page exactly
  const panelBg    = isDark ? "#0f172a" : "#ffffff";
  const border     = isDark ? "#1e293b" : "#e2e8f0";
  const divider    = isDark ? "#1e293b" : "#f1f5f9";
  const btnBg      = isDark ? "#1e293b" : "#f1f5f9";
  const btnClr     = isDark ? "#94a3b8" : "#475569";
  const txtPrimary = isDark ? "#e2e8f0" : "#1e293b";
  const txtMuted   = isDark ? "#64748b" : "#94a3b8";

  // Chart palette
  const chartBg   = isDark ? "#0f172a" : "#ffffff";
  const chartText = isDark ? "#64748b"  : "#475569";
  const chartGrid = isDark ? "#1e293b"  : "#f1f5f9";
  const chartBdr  = isDark ? "#1e293b"  : "#e2e8f0";

  // ── UI state ────────────────────────────────────────────────────────────────
  const [tf, setTf]         = useState<TfLabel>("1m");
  const [chartType, setCT]  = useState<ChartType>("area");
  const [simpleMode, setSimpleMode] = useState(true);
  const [simplePeriod, setSimplePeriod] = useState("1D");
  const [todayStats, setTodayStats] = useState<{ open: number; high: number; low: number } | null>(null);
  const [derivedPrevClose, setDerivedPrevClose] = useState<number | null>(null);
  const [indicators, setInd]= useState<Set<Indicator>>(new Set<Indicator>());
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [livePrice, setLP]  = useState<number | null>(null);
  const [ohlc, setOhlc]     = useState<{ o:number; h:number; l:number; c:number; v:number } | null>(null);
  const [wallet, setWallet] = useState<number | null>(null);
  const [orderState, setOS] = useState<{ loading: boolean; result: string | null }>({ loading: false, result: null });
  const [tradeLines, setTL] = useState<{ entry:number; target:number; sl:number; entryTime:string } | null>(null);
  const [orderLots, setOL]  = useState(1);
  const [tradeOpen, setTO]  = useState(false); // footer trade panel visibility
  const [indOpen,   setIndOpen] = useState(false);
  const [equityMode, setEquityMode] = useState<"intraday" | "swing">(isEquity ? "swing" : "intraday");
  const [equityQty, setEquityQty] = useState(1);
  const [equityQtyStr, setEquityQtyStr] = useState("1");
  const [rsiHeight, setRsiHeight] = useState(80);
  const rsiHeightRef = useRef(80);
  const rsiDragRef   = useRef<{ startY: number; startH: number } | null>(null);
  const indDropRef  = useRef<HTMLDivElement>(null);

  // ── Replay state ─────────────────────────────────────────────────────────────
  const [replayMode,    setReplayMode]    = useState(false);
  const [replayPicking, setReplayPicking] = useState(false); // waiting for user to click start candle
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayIdx,     setReplayIdx]     = useState(0);
  const [replaySpeed,   setReplaySpeed]   = useState(1);
  const replayCandlesRef  = useRef<Candle[]>([]);
  const replayIdxRef      = useRef(0);
  const replayPlayingRef  = useRef(false);
  const replayPickingRef  = useRef(false);
  const replayTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  // Close indicator dropdown on outside click
  useEffect(() => {
    if (!indOpen) return;
    const handler = (e: MouseEvent) => {
      if (indDropRef.current && !indDropRef.current.contains(e.target as Node)) setIndOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [indOpen]);

  // RSI pane drag-to-resize
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!rsiDragRef.current) return;
      const delta = rsiDragRef.current.startY - e.clientY;
      const newH  = Math.max(40, Math.min(300, rsiDragRef.current.startH + delta));
      rsiHeightRef.current = newH;
      setRsiHeight(newH);
      try {
        if (seriesRef.current.rsiPane) seriesRef.current.rsiPane.setHeight(newH);
        seriesRef.current.rsi?.applyOptions({ visible: true });
      } catch {}
    };
    const onUp = () => { rsiDragRef.current = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, []);

  // Compute OHLC stats for simple view — always based on the last trading day in data
  useEffect(() => {
    if (loading || !rawRef.current.length) return;
    const candles = rawRef.current;
    // Use last candle's date as "today" — works correctly on weekends/holidays too
    const lastTs  = candles[candles.length - 1].time;
    const lastD   = new Date(lastTs * 1000);
    const lastDayStart = Date.UTC(lastD.getUTCFullYear(), lastD.getUTCMonth(), lastD.getUTCDate()) / 1000;

    const dayCandles  = candles.filter(c => c.time >= lastDayStart);
    const prevCandles = candles.filter(c => c.time <  lastDayStart);

    if (dayCandles.length > 0) {
      setTodayStats({
        open: dayCandles[0].open,
        high: Math.max(...dayCandles.map(c => c.high)),
        low:  Math.min(...dayCandles.map(c => c.low)),
      });
    }
    // prevClose = last candle of the trading day BEFORE the last trading day
    if (prevCandles.length > 0) setDerivedPrevClose(prevCandles[prevCandles.length - 1].close);
  }, [loading]);

  // Apply visible range after data loads when in simple mode
  useEffect(() => {
    if (loading || !chartRef.current || !simpleMode) return;
    const ts = chartRef.current.timeScale();
    const candles = rawRef.current;
    if (!candles.length || !ts) return;
    // Remove right padding so chart fills to last candle
    try { ts.applyOptions({ rightOffset: 0 }); } catch {}
    if (simplePeriod === "1D") {
      // Start exactly at 9:15 AM of the last trading day (no previous day bleed)
      const lastTs = candles[candles.length - 1].time;
      const lastD  = new Date(lastTs * 1000);
      const lastDayStart = Date.UTC(lastD.getUTCFullYear(), lastD.getUTCMonth(), lastD.getUTCDate()) / 1000;
      const fi = candles.findIndex(c => c.time >= lastDayStart);
      ts.setVisibleLogicalRange({ from: fi >= 0 ? fi : 0, to: candles.length - 1 });
    } else {
      const fromTime = Date.now() / 1000 - SIMPLE_PERIOD_DAYS[simplePeriod] * 86400;
      const fi = candles.findIndex(c => c.time >= fromTime);
      if (fi >= 0) ts.setVisibleLogicalRange({ from: fi, to: candles.length - 1 });
      else ts.fitContent();
    }
  }, [loading, simplePeriod, simpleMode]);

  // Disable grid + interaction in simple mode; restore in tech mode
  useEffect(() => {
    if (!chartRef.current) return;
    const noInteract = { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false };
    const noScale    = { mouseWheel: false, pinch: false, axisPressedMouseMove: false, axisDoubleClickReset: false };
    chartRef.current.applyOptions({
      grid: {
        vertLines: { visible: !simpleMode },
        horzLines: { visible: !simpleMode },
      },
      handleScroll: simpleMode ? noInteract : true,
      handleScale:  simpleMode ? noScale    : true,
    });
    try { chartRef.current.timeScale().applyOptions({ shiftVisibleRangeOnNewBar: false, lockVisibleTimeRangeOnResize: simpleMode }); } catch {}
  }, [simpleMode, loading]);

  // Clean up replay timer on unmount
  useEffect(() => () => { if (replayTimerRef.current) clearInterval(replayTimerRef.current); }, []);

  // Restart replay interval when speed changes mid-play
  useEffect(() => {
    if (!replayPlayingRef.current) return;
    if (replayTimerRef.current) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    const delay = Math.round(400 / replaySpeed);
    replayTimerRef.current = setInterval(() => {
      const next = replayIdxRef.current + 1;
      if (next >= replayCandlesRef.current.length) {
        clearInterval(replayTimerRef.current!); replayTimerRef.current = null;
        replayPlayingRef.current = false; setReplayPlaying(false); return;
      }
      replayIdxRef.current = next; setReplayIdx(next);
      applyReplayData(replayCandlesRef.current.slice(0, next + 1));
    }, delay);
    return () => { if (replayTimerRef.current) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaySpeed]);

  // ── Stable refs ──────────────────────────────────────────────────────────────
  const chartDivRef  = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<any>(null);
  const seriesRef    = useRef<Record<string, any>>({});
  const rawRef       = useRef<Candle[]>([]);
  const currentRef   = useRef<Candle | null>(null);
  const tfMinRef     = useRef(1);
  const ctRef        = useRef<ChartType>("candle");
  const indRef       = useRef<Set<Indicator>>(new Set<Indicator>());
  const tlDataRef    = useRef<typeof tradeLines>(null);
  const tlSeriesRef  = useRef<{ ep:any; tp:any; sp:any } | null>(null);
  const isDarkRef    = useRef(isDark);
  const fetchedFromRef  = useRef<string>("");
  const hasMoreRef      = useRef(false);
  const loadingMoreRef  = useRef(false);

  const isCE  = type === "CE";
  const clr   = isEquity ? "#16a34a" : isCE ? "#0284c7" : "#dc2626";
  const chartLabel = isEquity
    ? (tradingsymbol ?? sym ?? `Token ${token}`)
    : `${index} ${strike} ${type}`;
  const tfCfg = TF_LIST.find(t => t.label === tf)!;
  // All TFs available for all charts; 1W only makes sense for equity but allowed everywhere
  const availableTFs = TF_LIST;
  const activeLotSize = getLotSize(index);

  // ── Fetch wallet ─────────────────────────────────────────────────────────────
  useEffect(() => {
    accountApi.get().then(d => setWallet(d.wallet.available)).catch(() => {});
  }, []);

  // ── Fetch candles when token or tf changes ───────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setError(null);
    rawRef.current       = [];
    currentRef.current   = null;
    hasMoreRef.current     = false;
    loadingMoreRef.current = false;

    const today = new Date().toISOString().split("T")[0];

    let fetchPromise: Promise<Candle[]>;

    const mapRows = (d: any): Candle[] =>
      (d.rows ?? []).map((r: any) => ({
        time: istToUnix(r.date), open: r.open, high: r.high,
        low: r.low, close: r.close, volume: r.volume ?? 0,
      }));

    if (tfCfg.kiteInterval === "day") {
      // Daily candles: equity gets 5 years, options get standard 90 days
      const fromDate = isEquity ? dateFromDaysAgo(1825) : dateFromDaysAgo(tfCfg.fromDays);
      fetchPromise = optionsApi
        .candleRange(token, fromDate, today, "day")
        .catch(() => ({ rows: [] }))
        .then(mapRows);
    } else if (tfCfg.kiteInterval === "minute") {
      if (isEquity) {
        // 60 days initial load (fast, 1 Kite call); scroll left loads older chunks on demand
        const fromDate = dateFromDaysAgo(60);
        fetchedFromRef.current = fromDate;
        hasMoreRef.current     = true;
        fetchPromise = optionsApi
          .candleRange(token, fromDate, today, "minute")
          .catch(() => ({ rows: [] }))
          .then(mapRows);
      } else {
        // FNO options: expiry period only
        fetchPromise = optionsApi
          .candleRange(token, getExpiryStart(expiry), today, "minute")
          .catch(() => ({ rows: [] }))
          .then(mapRows);
      }
    } else {
      // 60minute (1h, 4h): 60 days initial for equity; scroll-lazy loads up to 5 years
      const fromDate = isEquity ? dateFromDaysAgo(60) : getExpiryStart(expiry);
      if (isEquity) { fetchedFromRef.current = fromDate; hasMoreRef.current = true; }
      fetchPromise = optionsApi
        .candleRange(token, fromDate, today, tfCfg.kiteInterval)
        .catch(() => ({ rows: [] }))
        .then(mapRows);
    }

    fetchPromise
      .then(candles => {
        rawRef.current = tfCfg.kiteInterval === "day" ? candles : filterMarketHours(candles);
        setLoading(false);
      })
      .catch((e: any) => { setError(e?.message ?? "Failed to load"); setLoading(false); });
  }, [token, tf]);

  // ── Build / rebuild chart on data / tf / chartType / theme change ─────────
  useEffect(() => {
    if (!chartDivRef.current || loading || rawRef.current.length === 0) return;

    const aggMin = tfCfg.aggMinutes;
    const candles = aggMin > 1 ? aggregate(rawRef.current, aggMin) : rawRef.current;

    tfMinRef.current = aggMin > 1 ? aggMin : (tfCfg.kiteInterval === "60minute" ? 60 : tfCfg.kiteInterval === "day" ? 1440 : 1);
    ctRef.current    = chartType;
    isDarkRef.current = isDark;

    const closes = candles.map(c => c.close);
    const rsiArr = computeRSI(closes);
    const bbArr  = computeBB(closes);

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current   = null;
      seriesRef.current  = {};
      tlSeriesRef.current = null;
    }

    const chart = createChart(chartDivRef.current, {
      layout: {
        background: { color: chartBg },
        textColor:  chartText,
        fontFamily: "'Space Mono', monospace",
        fontSize:   10,
        attributionLogo: false,
      },
      grid: { vertLines: { color: chartGrid, visible: !simpleMode }, horzLines: { color: chartGrid, visible: !simpleMode } },
      crosshair: { mode: 1 },
      localization: {
        // istToUnix encodes IST time as UTC, so read UTC fields directly — no offset needed
        timeFormatter: (ts: number) => {
          const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
          const d    = new Date(ts * 1000);
          const day  = d.getUTCDate();
          const mon  = MONTHS[d.getUTCMonth()];
          const yr   = d.getUTCFullYear();
          const h    = d.getUTCHours();
          const m    = String(d.getUTCMinutes()).padStart(2, "0");
          const ap   = h >= 12 ? "PM" : "AM";
          const h12  = h % 12 || 12;
          // Daily candle: show date + year only
          if (h === 0 && m === "00") return `${day} ${mon} ${yr}`;
          return `${day} ${mon} ${yr} ${h12}:${m} ${ap}`;
        },
        priceFormatter: (p: number) => p.toFixed(2),
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: chartBdr,
        tickMarkFormatter: (ts: number, tickType: number) => {
          const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          const d  = new Date(ts * 1000);
          const yr = d.getUTCFullYear();
          const mo = MONTHS[d.getUTCMonth()];
          const dy = d.getUTCDate();
          const h  = d.getUTCHours();
          const mi = String(d.getUTCMinutes()).padStart(2, "0");
          // tickType: 0=Year 1=Month 2=Day 3=Time
          if (tickType === 0) return String(yr);
          if (tickType === 1) return `${mo} ${yr}`;
          if (tickType === 2) return `${dy} ${mo} ${yr}`;
          const ap  = h >= 12 ? "PM" : "AM";
          const h12 = h % 12 || 12;
          return `${h12}:${mi} ${ap}`;
        },
      },
      rightPriceScale: { borderColor: chartBdr, scaleMargins: { top: 0.06, bottom: simpleMode ? 0 : 0.06 }, minimumWidth: 0 },
      handleScroll: simpleMode ? { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false } : true,
      handleScale:  simpleMode ? { mouseWheel: false, pinch: false, axisPressedMouseMove: false, axisDoubleClickReset: false } : true,
      autoSize: true,
    } as any);

    chartRef.current = chart;
    const s   = seriesRef.current;
    const ind = indRef.current;

    // Pane 0: main series
    if (chartType === "candle" || chartType === "ha") {
      s.main = chart.addSeries(CandlestickSeries, {
        upColor: "#16a34a", downColor: "#dc2626",
        borderUpColor: "#16a34a", borderDownColor: "#dc2626",
        wickUpColor: "#16a34a", wickDownColor: "#dc2626",
      } as any, 0);
    } else if (chartType === "area") {
      s.main = chart.addSeries(AreaSeries, {
        lineColor: clr, topColor: `${clr}55`, bottomColor: `${clr}05`,
        lineWidth: 2, lastValueVisible: true, priceLineVisible: false,
      } as any, 0);
    } else {
      s.main = chart.addSeries(LineSeries, { color: clr, lineWidth: 1.5, lastValueVisible: true, priceLineVisible: false } as any, 0);
    }

    // BB overlay — same pane, same right scale, but don't let extreme early values expand axis
    const bbBase = {
      lineWidth: 1, lastValueVisible: false, priceLineVisible: false, visible: ind.has("BB"),
      autoscaleInfoProvider: () => null,  // BB doesn't drive the price axis range
    };
    s.bbUp  = chart.addSeries(LineSeries, { ...bbBase, color: "#16a34a", lineStyle: 0 } as any, 0);
    s.bbMid = chart.addSeries(LineSeries, { ...bbBase, color: "#3b82f6", lineStyle: 0 } as any, 0);
    s.bbDn  = chart.addSeries(LineSeries, { ...bbBase, color: "#dc2626", lineStyle: 0 } as any, 0);

    // Volume — overlay on main pane at bottom; start with empty data so bars are invisible until toggled
    s.vol = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol",
      priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false,
    } as any, 0);
    // Apply margins now that the series exists (scale is created), then empty data = hidden
    try { chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false }); } catch {}
    if (!ind.has("VOL")) s.vol.setData([]);

    // RSI — dedicated pane 1; use visible flag + pane height to control display
    s.rsi = chart.addSeries(LineSeries, {
      color: "#f59e0b", lineWidth: 1.5, lastValueVisible: true, priceLineVisible: false,
      priceFormat: { type: "custom", formatter: (v: number) => v.toFixed(1) },
      visible: ind.has("RSI"),
    } as any, 1);
    const allPanes = (chart as any).panes?.() ?? [];
    s.rsiPane = allPanes[1] ?? null;
    if (s.rsiPane) s.rsiPane.setHeight(ind.has("RSI") ? rsiHeightRef.current : 0);
    if (ind.has("RSI") && s.rsi) {
      try {
        s.rsiL70 = s.rsi.createPriceLine({ price: 70, color: "rgba(220,38,38,0.7)", lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: "70" });
        s.rsiL30 = s.rsi.createPriceLine({ price: 30, color: "rgba(22,163,74,0.7)",  lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: "30" });
      } catch {}
    }

    // Populate data
    const t = (c: Candle) => c.time as any;
    if (chartType === "candle") {
      s.main.setData(candles.map(c => ({ time: t(c), open: c.open, high: c.high, low: c.low, close: c.close })));
    } else if (chartType === "ha") {
      s.main.setData(toHeikinAshi(candles).map(c => ({ time: t(c), open: c.open, high: c.high, low: c.low, close: c.close })));
    } else {
      s.main.setData(candles.map(c => ({ time: t(c), value: c.close })));
    }
    const bbV = candles.map((c, i) => ({ c, bb: bbArr[i] })).filter(x => x.bb.mid != null);
    s.bbUp.setData(bbV.map(x => ({ time: t(x.c), value: x.bb.up!  })));
    s.bbMid.setData(bbV.map(x => ({ time: t(x.c), value: x.bb.mid! })));
    s.bbDn.setData(bbV.map(x => ({ time: t(x.c), value: x.bb.dn!  })));
    if (ind.has("VOL")) s.vol.setData(candles.map(c => ({ time: t(c), value: c.volume, color: c.close >= c.open ? "rgba(22,163,74,0.4)" : "rgba(220,38,38,0.4)" })));
    const rsiV = candles.map((c, i) => ({ c, rsi: rsiArr[i] })).filter(x => x.rsi != null);
    s.rsi.setData(rsiV.map(x => ({ time: t(x.c), value: x.rsi! })));

    // Default view
    if (simpleMode && candles.length > 0) {
      // Simple mode: show exact last trading day from first candle, no gap
      const lastTs = candles[candles.length - 1].time;
      const lastD  = new Date(lastTs * 1000);
      const lastDayStart = Date.UTC(lastD.getUTCFullYear(), lastD.getUTCMonth(), lastD.getUTCDate()) / 1000;
      const fi = candles.findIndex(c => c.time >= lastDayStart);
      try { chart.timeScale().applyOptions({ rightOffset: 0 }); } catch {}
      chart.timeScale().setVisibleLogicalRange({ from: fi >= 0 ? fi : 0, to: candles.length - 1 });
    } else if ((tfCfg.kiteInterval === "minute" || tfCfg.kiteInterval === "60minute") && candles.length > 0) {
      // Pin today's 9:15 AM candle at the left edge; show full day extent (9:15–3:30) on the right
      const lastTime     = candles[candles.length - 1].time;
      const lastDayStart = Math.floor(lastTime / 86400) * 86400;
      const todayOpen    = lastDayStart + 9 * 3600 + 15 * 60; // 9:15 AM (IST-as-UTC encoding)
      const firstIdx     = candles.findIndex(c => c.time >= todayOpen);
      const startIdx     = firstIdx >= 0 ? firstIdx : candles.length - 1;
      // Full trading session = 375 minutes; scale to current TF
      const barsPerDay   = aggMin > 1 ? Math.ceil(375 / aggMin) : tfCfg.kiteInterval === "60minute" ? 7 : 375;
      chart.timeScale().setVisibleLogicalRange({
        from: startIdx > 0 ? startIdx - 0.5 : 0,
        to:   startIdx + barsPerDay + 5,
      });
    } else {
      chart.timeScale().fitContent();
    }

    // Show last candle OHLC by default
    const lastCandle = candles[candles.length - 1];
    if (lastCandle) {
      const lastHa = chartType === "ha" ? toHeikinAshi(candles).at(-1) : null;
      const lc = lastHa ?? lastCandle;
      setOhlc({ o: lc.open, h: lc.high, l: lc.low, c: lc.close, v: lastCandle.volume });
    }

    // Crosshair tooltip — restore last candle when crosshair leaves
    chart.subscribeCrosshairMove((param: any) => {
      if (!param.time || !param.seriesData?.size) {
        const last = rawRef.current[rawRef.current.length - 1];
        if (last) setOhlc({ o: last.open, h: last.high, l: last.low, c: last.close, v: last.volume });
        return;
      }
      const md = param.seriesData.get(s.main);
      const vd = param.seriesData.get(s.vol);
      if (md) setOhlc({ o: md.open ?? md.value ?? 0, h: md.high ?? md.value ?? 0, l: md.low ?? md.value ?? 0, c: md.close ?? md.value ?? 0, v: vd?.value ?? 0 });
      else setOhlc(null);
    });

    // Redraw persisted trade lines
    if (tlDataRef.current) {
      try { tlSeriesRef.current = mkTLs(s.main, tlDataRef.current); } catch {}
    }

    // ── Scroll-lazy: load older 60-day chunks when user scrolls to left edge ────
    let unsubRange: (() => void) | null = null;
    if ((tfCfg.kiteInterval === "minute" || tfCfg.kiteInterval === "60minute") && isEquity) {
      const loadMore = async () => {
        if (!hasMoreRef.current || loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        try {
          const oldFrom  = fetchedFromRef.current;
          const oldFromD = new Date(oldFrom);
          const toD      = new Date(oldFromD); toD.setDate(toD.getDate() - 1);
          const newFromD = new Date(oldFromD); newFromD.setDate(newFromD.getDate() - 60);
          const limit5Y  = new Date(); limit5Y.setDate(limit5Y.getDate() - 1825);
          if (newFromD <= limit5Y) { newFromD.setTime(limit5Y.getTime()); hasMoreRef.current = false; }

          const newFromStr = newFromD.toISOString().split("T")[0];
          const toStr      = toD.toISOString().split("T")[0];

          const raw = await optionsApi.candleRange(token, newFromStr, toStr, tfCfg.kiteInterval).catch(() => ({ rows: [] }));
          const newCandles = filterMarketHours(
            (raw.rows ?? []).map((r: any) => ({
              time: istToUnix(r.date), open: r.open, high: r.high,
              low: r.low, close: r.close, volume: r.volume ?? 0,
            }))
          );
          if (newCandles.length === 0) { hasMoreRef.current = false; return; }

          fetchedFromRef.current = newFromStr;
          const prevAggLen = aggMin > 1 ? aggregate(rawRef.current, aggMin).length : rawRef.current.length;
          rawRef.current   = [...newCandles, ...rawRef.current];
          const newAgg     = aggMin > 1 ? aggregate(rawRef.current, aggMin) : rawRef.current;
          const addedBars  = newAgg.length - prevAggLen;

          const closes2 = newAgg.map(c => c.close);
          const rsiArr2 = computeRSI(closes2);
          const bbArr2  = computeBB(closes2);
          const tc = (c: Candle) => c.time as any;
          const s2 = seriesRef.current;

          if (ctRef.current === "candle") {
            s2.main?.setData(newAgg.map(c => ({ time: tc(c), open: c.open, high: c.high, low: c.low, close: c.close })));
          } else if (ctRef.current === "ha") {
            s2.main?.setData(toHeikinAshi(newAgg).map(c => ({ time: tc(c), open: c.open, high: c.high, low: c.low, close: c.close })));
          } else {
            s2.main?.setData(newAgg.map(c => ({ time: tc(c), value: c.close })));
          }
          const bbV2 = newAgg.map((c, i) => ({ c, bb: bbArr2[i] })).filter(x => x.bb.mid != null);
          s2.bbUp?.setData(bbV2.map(x => ({ time: tc(x.c), value: x.bb.up! })));
          s2.bbMid?.setData(bbV2.map(x => ({ time: tc(x.c), value: x.bb.mid! })));
          s2.bbDn?.setData(bbV2.map(x => ({ time: tc(x.c), value: x.bb.dn! })));
          if (indRef.current.has("VOL")) {
            s2.vol?.setData(newAgg.map(c => ({ time: tc(c), value: c.volume, color: c.close >= c.open ? "rgba(22,163,74,0.4)" : "rgba(220,38,38,0.4)" })));
          }
          const rsiV2 = newAgg.map((c, i) => ({ c, rsi: rsiArr2[i] })).filter(x => x.rsi != null);
          s2.rsi?.setData(rsiV2.map(x => ({ time: tc(x.c), value: x.rsi! })));

          try {
            const range = chart.timeScale().getVisibleLogicalRange();
            if (range && addedBars > 0) {
              chart.timeScale().setVisibleLogicalRange({ from: range.from + addedBars, to: range.to + addedBars });
            }
          } catch {}
        } finally {
          loadingMoreRef.current = false;
        }
      };
      const onRangeChange = (range: any) => { if (range && range.from <= 5) loadMore(); };
      chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);
      unsubRange = () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange);
    }

    return () => { unsubRange?.(); chart.remove(); chartRef.current = null; seriesRef.current = {}; };
  }, [loading, tf, chartType, isDark]);

  // ── Live ticks via WebSocket ──────────────────────────────────────────────
  useEffect(() => {
    const ws = createWS((msg) => {
      if (msg.type !== "ticks") return;
      const tick = (msg.data as any[]).find((t: any) => t.instrument_token === token);
      if (!tick) return;

      const price: number = tick.last_price;
      setLP(price);

      // Encode current IST time the same way istToUnix does for historical candles:
      // treat IST clock values as UTC so the live candle aligns with historical data.
      const istNow  = new Date(Date.now() + 5.5 * 3600 * 1000);
      const nowEnc  = Date.UTC(
        istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(),
        istNow.getUTCHours(), istNow.getUTCMinutes(), 0,
      ) / 1000;
      const tfSec   = tfMinRef.current * 60;
      const bucket  = Math.floor(nowEnc / tfSec) * tfSec;

      let curr = currentRef.current;
      if (!curr || curr.time !== bucket) {
        const prev = curr?.close ?? rawRef.current[rawRef.current.length - 1]?.close ?? price;
        curr = { time: bucket, open: prev, high: Math.max(prev, price), low: Math.min(prev, price), close: price, volume: tick.volume_traded ?? 0 };
      } else {
        curr = { ...curr, high: Math.max(curr.high, price), low: Math.min(curr.low, price), close: price, volume: tick.volume_traded ?? curr.volume };
      }
      currentRef.current = curr;

      const s = seriesRef.current;
      if (!s.main) return;
      try {
        if (ctRef.current === "candle" || ctRef.current === "ha")
          s.main.update({ time: bucket as any, open: curr.open, high: curr.high, low: curr.low, close: curr.close });
        else
          s.main.update({ time: bucket as any, value: curr.close });
        s.vol?.update({ time: bucket as any, value: curr.volume, color: curr.close >= curr.open ? "rgba(22,163,74,0.4)" : "rgba(220,38,38,0.4)" });
      } catch {}
    });
    if (ws) ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "subscribe", tokens: [token] })));
    return () => { ws?.close(); };
  }, [token]);

  // ── Indicator toggle (no chart rebuild) ──────────────────────────────────
  function toggleInd(ind: Indicator) {
    const next = new Set(indRef.current);
    if (next.has(ind)) next.delete(ind); else next.add(ind);
    indRef.current = next;
    setInd(new Set(next));
    const on = next.has(ind);
    const s  = seriesRef.current;
    if (ind === "BB")  { s.bbUp?.applyOptions({ visible: on }); s.bbMid?.applyOptions({ visible: on }); s.bbDn?.applyOptions({ visible: on }); }
    if (ind === "VOL") {
      // Show/hide by swapping data — no reliance on series `visible` option
      if (on) {
        const aggMin = tfMinRef.current;
        const candles = aggMin > 1 ? aggregate(rawRef.current, aggMin) : rawRef.current;
        const t = (c: Candle) => c.time as any;
        s.vol?.setData(candles.map(c => ({ time: t(c), value: c.volume, color: c.close >= c.open ? "rgba(22,163,74,0.4)" : "rgba(220,38,38,0.4)" })));
      } else {
        s.vol?.setData([]);
      }
    }
    if (ind === "RSI") {
      // Primary: visible flag. Secondary: pane height (if pane API available)
      s.rsi?.applyOptions({ visible: on });
      try { if (s.rsiPane) s.rsiPane.setHeight(on ? rsiHeightRef.current : 0); } catch {}
      try {
        if (on && s.rsi) {
          s.rsiL70 = s.rsi.createPriceLine({ price: 70, color: "rgba(220,38,38,0.7)", lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: "70" });
          s.rsiL30 = s.rsi.createPriceLine({ price: 30, color: "rgba(22,163,74,0.7)",  lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: "30" });
        } else if (!on && s.rsi) {
          if (s.rsiL70) { s.rsi.removePriceLine(s.rsiL70); s.rsiL70 = null; }
          if (s.rsiL30) { s.rsi.removePriceLine(s.rsiL30); s.rsiL30 = null; }
        }
      } catch {}
    }
  }

  function handleSimplePeriod(p: string) {
    const newTf = SIMPLE_PERIOD_TF[p] as TfLabel;
    setSimplePeriod(p);
    if (tf !== newTf) setTf(newTf);
  }

  // ── Zoom / Scroll ─────────────────────────────────────────────────────────
  function zoomChart(zoomIn: boolean) {
    const ts = chartRef.current?.timeScale();
    if (!ts) return;
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const center = (range.from + range.to) / 2;
    const half   = (range.to - range.from) / 2;
    ts.setVisibleLogicalRange({ from: center - half * (zoomIn ? 0.65 : 1.5), to: center + half * (zoomIn ? 0.65 : 1.5) });
  }

  function scrollChart(delta: number) {
    chartRef.current?.timeScale().scrollToPosition(delta, true);
  }

  function fitToday() {
    const ts = chartRef.current?.timeScale();
    if (!ts) return;
    // Find today's candle range in logical coords
    const allCandles = replayMode ? replayCandlesRef.current.slice(0, replayIdxRef.current + 1) : rawRef.current;
    if (!allCandles.length) { ts.fitContent(); return; }
    const today = new Date();
    const todayKey = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 1000;
    const firstIdx = allCandles.findIndex(c => c.time >= todayKey);
    if (firstIdx < 0) { ts.fitContent(); return; }
    ts.setVisibleLogicalRange({ from: firstIdx - 0.5, to: allCandles.length - 0.5 });
  }

  // ── Replay helpers ────────────────────────────────────────────────────────
  function applyReplayData(candles: Candle[]) {
    const t = (c: Candle) => c.time as any;
    const s = seriesRef.current;
    if (!s.main || !chartRef.current) return;
    try {
      const closes = candles.map(c => c.close);
      const bbArr  = computeBB(closes, 20, 2);
      const rsiArr = computeRSI(closes, 14);
      if (ctRef.current === "candle")
        s.main.setData(candles.map(c => ({ time: t(c), open: c.open, high: c.high, low: c.low, close: c.close })));
      else if (ctRef.current === "ha")
        s.main.setData(toHeikinAshi(candles).map(c => ({ time: t(c), open: c.open, high: c.high, low: c.low, close: c.close })));
      else
        s.main.setData(candles.map(c => ({ time: t(c), value: c.close })));
      const bbV = candles.map((c, i) => ({ c, bb: bbArr[i] })).filter(x => x.bb.mid != null);
      s.bbUp?.setData(bbV.map(x => ({ time: t(x.c), value: x.bb.up! })));
      s.bbMid?.setData(bbV.map(x => ({ time: t(x.c), value: x.bb.mid! })));
      s.bbDn?.setData(bbV.map(x => ({ time: t(x.c), value: x.bb.dn! })));
      if (indRef.current.has("VOL")) s.vol?.setData(candles.map(c => ({ time: t(c), value: c.volume, color: c.close >= c.open ? "rgba(22,163,74,0.4)" : "rgba(220,38,38,0.4)" })));
      const rsiV = candles.map((c, i) => ({ c, rsi: rsiArr[i] })).filter(x => x.rsi != null);
      s.rsi?.setData(rsiV.map(x => ({ time: t(x.c), value: x.rsi! })));
    } catch {}
  }

  function startReplay() {
    const all = rawRef.current;
    if (!all.length || !chartRef.current) return;
    const aggMin = tfCfg.aggMinutes;
    replayCandlesRef.current = aggMin > 1 ? aggregate(all, aggMin) : all;
    replayIdxRef.current = 0;
    replayPlayingRef.current = false;
    replayPickingRef.current  = true;
    setReplayMode(true);
    setReplayPicking(true);
    setReplayPlaying(false);
    setReplayIdx(0);
    // Show full chart so user can click any candle as start point
    const fullCandles = replayCandlesRef.current;
    const t = (c: Candle) => c.time as any;
    const s = seriesRef.current;
    try {
      if (ctRef.current === "candle")
        s.main?.setData(fullCandles.map(c => ({ time: t(c), open: c.open, high: c.high, low: c.low, close: c.close })));
      else if (ctRef.current === "ha")
        s.main?.setData(toHeikinAshi(fullCandles).map(c => ({ time: t(c), open: c.open, high: c.high, low: c.low, close: c.close })));
      else
        s.main?.setData(fullCandles.map(c => ({ time: t(c), value: c.close })));
    } catch {}
    // Subscribe click once to pick start candle
    const handler = (param: any) => {
      if (!replayPickingRef.current) return;
      if (param.logical == null) return;
      const idx = Math.max(0, Math.min(Math.round(param.logical as number), replayCandlesRef.current.length - 1));
      replayIdxRef.current  = idx;
      replayPickingRef.current = false;
      setReplayPicking(false);
      setReplayIdx(idx);
      applyReplayData(replayCandlesRef.current.slice(0, idx + 1));
      chartRef.current?.unsubscribeClick(handler);
    };
    chartRef.current.subscribeClick(handler);
  }

  function stopReplay() {
    if (replayTimerRef.current) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    replayPlayingRef.current  = false;
    replayPickingRef.current  = false;
    setReplayMode(false);
    setReplayPicking(false);
    setReplayPlaying(false);
    setReplayIdx(0);
    replayIdxRef.current = 0;
    // Restore full aggregated candles
    const aggMin  = tfCfg.aggMinutes;
    const candles = aggMin > 1 ? aggregate(rawRef.current, aggMin) : rawRef.current;
    applyReplayData(candles);
    chartRef.current?.timeScale().fitContent();
  }

  function toggleReplayPlay() {
    if (replayPlayingRef.current) {
      // pause
      clearInterval(replayTimerRef.current!);
      replayTimerRef.current = null;
      replayPlayingRef.current = false;
      setReplayPlaying(false);
    } else {
      // play
      replayPlayingRef.current = true;
      setReplayPlaying(true);
      const delay = Math.round(400 / replaySpeed);
      replayTimerRef.current = setInterval(() => {
        const next = replayIdxRef.current + 1;
        if (next >= replayCandlesRef.current.length) {
          clearInterval(replayTimerRef.current!);
          replayTimerRef.current = null;
          replayPlayingRef.current = false;
          setReplayPlaying(false);
          return;
        }
        replayIdxRef.current = next;
        setReplayIdx(next);
        applyReplayData(replayCandlesRef.current.slice(0, next + 1));
      }, delay);
    }
  }

  function stepReplay(delta: number) {
    if (replayPlayingRef.current) return; // don't step while playing
    const next = Math.max(0, Math.min(replayCandlesRef.current.length - 1, replayIdxRef.current + delta));
    replayIdxRef.current = next;
    setReplayIdx(next);
    applyReplayData(replayCandlesRef.current.slice(0, next + 1));
  }

  // ── Trade line helpers ────────────────────────────────────────────────────
  function mkTLs(series: any, tl: NonNullable<typeof tradeLines>) {
    return {
      ep: series.createPriceLine({ price: tl.entry,  color: "#38bdf8", lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: `Entry ₹${tl.entry.toFixed(2)} (${tl.entryTime})` }),
      tp: series.createPriceLine({ price: tl.target, color: "#16a34a", lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: `Target ₹${tl.target.toFixed(2)}` }),
      sp: series.createPriceLine({ price: tl.sl,     color: "#e11d48", lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: `SL ₹${tl.sl.toFixed(2)}` }),
    };
  }

  // ── Place order ────────────────────────────────────────────────────────────
  async function placeOrder(action: "BUY" | "SELL") {
    const tsym = tradingsymbol ?? sym;
    if (!tsym) { setOS({ loading: false, result: "✗ No trading symbol" }); return; }
    setOS({ loading: true, result: null });
    try {
      const qty = isEquity ? equityQty : orderLots * activeLotSize;
      await accountApi.placeOrder(tsym, action, qty, isEquity ? "NSE" : undefined);
      const entry     = livePrice ?? rawRef.current[rawRef.current.length - 1]?.close ?? 0;
      const rr        = calcRR(entry);
      const now       = new Date();
      const entryTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const tl        = { entry, target: rr.target1, sl: rr.sl, entryTime };
      tlDataRef.current = tl;
      setTL(tl);
      setOS({ loading: false, result: `✓ ${action} @ ₹${entry.toFixed(2)}` });
      const s = seriesRef.current;
      if (s.main) {
        if (tlSeriesRef.current) {
          try { s.main.removePriceLine(tlSeriesRef.current.ep); s.main.removePriceLine(tlSeriesRef.current.tp); s.main.removePriceLine(tlSeriesRef.current.sp); } catch {}
        }
        try { tlSeriesRef.current = mkTLs(s.main, tl); } catch {}
      }
    } catch (e: any) {
      setOS({ loading: false, result: `✗ ${e?.message ?? "Order failed"}` });
    }
  }

  // ── Simple view computed ─────────────────────────────────────────────────
  const currentPrice      = livePrice ?? rawRef.current[rawRef.current.length - 1]?.close ?? 0;
  const effectivePrevClose = prevClose ?? derivedPrevClose;
  const changeVal         = effectivePrevClose && effectivePrevClose > 0 ? currentPrice - effectivePrevClose : (ltpChange ?? 0);
  const changeAbs         = Math.abs(changeVal);
  const changePct         = effectivePrevClose && effectivePrevClose > 0 ? Math.abs(changeVal / effectivePrevClose * 100) : 0;
  const simpleIsUp        = changeVal >= 0;
  const simpleChgClr      = simpleIsUp ? "#16a34a" : "#e11d48";
  const fmtPrice          = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // badge colour per chart type
  const simpleBadgeBg  = isIndex ? (isDark ? "#1e3a5f" : "#dbeafe") : isEquity ? (isDark ? "#14532d" : "#dcfce7") : isCE ? (isDark ? "#0c2a3f" : "#e0f2fe") : (isDark ? "#3b0764" : "#fae8ff");
  const simpleBadgeClr = isIndex ? (isDark ? "#60a5fa" : "#1d4ed8") : isEquity ? (isDark ? "#4ade80" : "#166534") : isCE ? (isDark ? "#38bdf8" : "#0284c7") : (isDark ? "#e879f9" : "#a21caf");
  const simpleBadgeTxt = isIndex ? "INDEX" : isEquity ? "NSE" : type;

  // ── Computed for footer ───────────────────────────────────────────────────
  const liveOrLast   = livePrice ?? rawRef.current[rawRef.current.length - 1]?.close ?? 0;
  const isIntraday5x = isEquity && equityMode === "intraday";
  // 5x margin leverage for equity intraday
  const effectiveWallet = isIntraday5x && wallet !== null ? wallet * 5 : wallet;
  // Charges (equity only; options charges shown separately)
  const eqCharges    = isEquity && liveOrLast > 0
    ? calcEquityCharges(liveOrLast, equityQty, isIntraday5x)
    : null;
  const stockCost    = isEquity ? liveOrLast * equityQty : liveOrLast * orderLots * activeLotSize;
  const approxBuy    = isEquity ? stockCost + (eqCharges?.total ?? 0) : stockCost;
  // Max shares affordable with effective wallet
  const maxQty       = isEquity && liveOrLast > 0 && effectiveWallet !== null
    ? Math.floor(effectiveWallet / liveOrLast)
    : null;
  const canBuy       = effectiveWallet === null || effectiveWallet >= approxBuy;
  const fmtWallet    = effectiveWallet !== null ? `₹${effectiveWallet.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—";
  const approxClr    = !canBuy ? "#e11d48" : txtPrimary;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: panelBg, zIndex: 100 }}>

      {/* ══ FULL MODE HEADER ══ */}
      {!simpleMode && (
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 flex-wrap"
        style={{ borderBottom: `1px solid ${border}`, background: isDark ? "#0d1424" : "#f8fafc" }}>

        {/* Back / close */}
        <button onClick={onClose}
          className="flex items-center gap-1 px-2 h-7 rounded cursor-pointer flex-shrink-0 transition-colors hover:opacity-80"
          style={{ background: btnBg, color: txtMuted }}>
          <IconChevronLeft size={13} />
          <span className="text-[9px] font-bold hidden sm:inline" style={MONO}>Back</span>
        </button>

        {/* Equity: stock name label (same pill style as options) */}
        {isEquity && !loading && !error && (
          <span className="hidden lg:flex items-center h-7 px-2.5 rounded text-[9px] font-black flex-shrink-0"
            style={{ ...MONO, color: "#16a34a", background: "#16a34a15", border: "1px solid #16a34a40" }}>
            {chartLabel}
          </span>
        )}

        {/* Large screen: options symbol + Buy/Sell */}
        {!loading && !error && (
          <div className="hidden lg:flex items-center gap-1.5 flex-shrink-0">
            {/* Options symbol badge */}
            {!isEquity && (
              <span className="flex items-center h-7 px-2.5 rounded text-[9px] font-black"
                style={{ ...MONO, color: isCE ? "#38bdf8" : "#f472b6", background: isCE ? "#38bdf815" : "#f472b615", border: `1px solid ${isCE ? "#38bdf840" : "#f472b640"}` }}>
                {chartLabel}
              </span>
            )}
            {!isIndex && (<>
            <button onClick={() => setTO(v => !v)}
              className="h-7 px-2.5 rounded text-[9px] font-black cursor-pointer transition-all"
              style={{ ...MONO, background: tradeOpen ? "#e11d48" : "#e11d4820", color: tradeOpen ? "#fff" : "#e11d48", border: "1px solid #e11d4840" }}>
              Sell
            </button>
            <button onClick={() => setTO(v => !v)}
              className="h-7 px-2.5 rounded text-[9px] font-black cursor-pointer transition-all"
              style={{ ...MONO, background: tradeOpen ? "#16a34a" : "#16a34a20", color: tradeOpen ? "#fff" : "#16a34a", border: "1px solid #16a34a40" }}>
              Buy
            </button>
            </>)}
          </div>
        )}

        <div className="flex-1" />

        {/* TF dropdown (shadcn Select) */}
        <Select value={tf} onValueChange={(v) => setTf(v as TfLabel)}>
          <SelectTrigger
            className="h-7 w-[68px] text-[9px] font-bold border-0 shadow-none px-2 rounded cursor-pointer"
            style={{ ...MONO, background: btnBg, color: txtPrimary, border: `1px solid ${border}` }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[200]">
            {availableTFs.map(({ label }) => (
              <SelectItem key={label} value={label} className="text-[9px] font-bold" style={MONO}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Chart type dropdown */}
        <Select value={chartType} onValueChange={(v) => setCT(v as ChartType)}>
          <SelectTrigger
            className="h-7 w-[90px] text-[9px] font-bold border-0 shadow-none px-2 rounded cursor-pointer"
            style={{ ...MONO, background: btnBg, color: txtPrimary, border: `1px solid ${border}` }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[200]">
            <SelectItem value="candle" className="text-[9px] font-bold" style={MONO}>Candle</SelectItem>
            <SelectItem value="ha"     className="text-[9px] font-bold" style={MONO}>Heikin Ashi</SelectItem>
            <SelectItem value="line"   className="text-[9px] font-bold" style={MONO}>Line</SelectItem>
            <SelectItem value="area"   className="text-[9px] font-bold" style={MONO}>Area</SelectItem>
          </SelectContent>
        </Select>

        {/* Indicators multi-select dropdown */}
        <div className="relative flex-shrink-0" ref={indDropRef}>
          <button onClick={() => setIndOpen(v => !v)}
            className="flex items-center gap-1 px-2 h-7 rounded text-[9px] font-bold cursor-pointer transition-all"
            style={{ ...MONO, background: indicators.size > 0 ? (isDark ? "#1e3a5f" : "#dbeafe") : btnBg,
              color: indicators.size > 0 ? (isDark ? "#60a5fa" : "#1d4ed8") : txtMuted,
              border: `1px solid ${indicators.size > 0 ? (isDark ? "#3b82f660" : "#93c5fd") : border}` }}>
            Indicators
            {indicators.size > 0 && (
              <span className="text-[8px] px-1 rounded-full font-black"
                style={{ background: isDark ? "#3b82f6" : "#2563eb", color: "#fff" }}>
                {indicators.size}
              </span>
            )}
            <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ opacity: 0.6 }}>
              <path d="M1 2.5L4 5.5L7 2.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
            </svg>
          </button>

          {indOpen && (
            <div className="absolute right-0 top-8 rounded-lg shadow-xl overflow-hidden z-[200] min-w-[110px]"
              style={{ background: panelBg, border: `1px solid ${border}` }}>
              {(["RSI", "BB", "VOL"] as Indicator[]).map((ind, i) => (
                <button key={ind} onClick={() => toggleInd(ind)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[9px] font-bold cursor-pointer transition-colors hover:opacity-80"
                  style={{ ...MONO, borderTop: i > 0 ? `1px solid ${border}` : "none",
                    background: indicators.has(ind) ? (isDark ? "#1e3a5f40" : "#dbeafe80") : "transparent",
                    color: indicators.has(ind) ? (isDark ? "#60a5fa" : "#1d4ed8") : txtMuted }}>
                  <span className="w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0"
                    style={{ background: indicators.has(ind) ? (isDark ? "#3b82f6" : "#2563eb") : "transparent",
                      border: `1.5px solid ${indicators.has(ind) ? (isDark ? "#3b82f6" : "#2563eb") : border}` }}>
                    {indicators.has(ind) && (
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                        <polyline points="1.5,4 3,5.5 6.5,2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </span>
                  {ind}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Close X */}
        <button onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-full cursor-pointer flex-shrink-0 transition-colors hover:opacity-70"
          style={{ background: btnBg, color: txtMuted }}>
          <IconX size={13} />
        </button>
      </div>
      )}

      {/* ══ CHART ══ */}
      <div className="flex-1 relative overflow-hidden">

        {/* Simple mode — transparent info overlay */}
        {simpleMode && (
          <div className="absolute top-0 left-0 right-0 z-20 px-4 pt-3 pb-2" style={{ background: "transparent" }}>

            {/* back button row */}
            <div className="mb-1.5 flex items-center gap-2">
              <button onClick={onClose}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg cursor-pointer transition-all hover:opacity-90 active:scale-95"
                style={{ background: isDark ? "#1e2a3a" : "#e2e8f0", color: txtPrimary, border: `1px solid ${border}` }}>
                <IconChevronLeft size={13} />
                <span className="text-[9px] font-bold" style={MONO}>Back</span>
              </button>
              {isIndex && (sym === "NIFTY50" || sym === "SENSEX") && onOpenChain && (
                <button
                  onClick={() => onOpenChain(sym === "SENSEX" ? "SENSEX" : "NIFTY")}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg cursor-pointer transition-all hover:opacity-90 active:scale-95"
                  style={{ background: isDark ? "#0c2a3fdd" : "#0284c7dd", color: "#fff", border: "1px solid #0284c760" }}>
                  <IconLayoutGrid size={11} />
                  <span className="text-[9px] font-bold" style={MONO}>Option Chain</span>
                </button>
              )}
            </div>

            {/* company label + badge */}
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[20px] font-black leading-tight truncate" style={{ ...MONO, color: txtPrimary }}>{chartLabel}</span>
              <span className="text-[8px] font-bold px-2 py-0.5 rounded flex-shrink-0" style={{ ...MONO, background: simpleBadgeBg, color: simpleBadgeClr }}>{simpleBadgeTxt}</span>
            </div>

            {/* price + change */}
            <div className="flex items-end gap-2">
              <span className="text-[16px] font-black leading-none" style={{ ...MONO, color: txtPrimary }}>
                {currentPrice > 0 ? fmtPrice(currentPrice) : "—"}
              </span>
              <span className="text-[11px] font-bold pb-0.5" style={{ ...MONO, color: simpleChgClr }}>
                {simpleIsUp ? "▲" : "▼"} {changeAbs.toFixed(2)} ({simpleIsUp ? "+" : ""}{changePct.toFixed(2)}%)
              </span>
            </div>

            {/* stats — compact single row */}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {(isIndex || isEquity ? [
                ["Open",       todayStats?.open  != null ? fmtPrice(todayStats.open)     : "—", txtPrimary],
                ["Low",        todayStats?.low   != null ? fmtPrice(todayStats.low)      : "—", "#e11d48"],
                ["High",       todayStats?.high  != null ? fmtPrice(todayStats.high)     : "—", "#16a34a"],
                ["Prev Close", effectivePrevClose != null ? fmtPrice(effectivePrevClose) : "—", txtMuted],
              ] : [
                ["Strike",  strike > 0 ? strike.toLocaleString("en-IN") : "—",               simpleBadgeClr],
                ["Low",     todayStats?.low  != null ? fmtPrice(todayStats.low)          : "—", "#e11d48"],
                ["High",    todayStats?.high != null ? fmtPrice(todayStats.high)         : "—", "#16a34a"],
                ["Expiry",  expiry || "—",                                                     txtMuted],
              ] as [string, string, string][]).map(([label, val, clr], i) => (
                <div key={label} className="flex items-center gap-1">
                  {i > 0 && <span style={{ color: txtMuted, opacity: 0.3, fontSize: 8 }}>|</span>}
                  <span className="text-[8px]" style={{ ...MONO, color: txtMuted }}>{label}</span>
                  <span className="text-[9px] font-black" style={{ ...MONO, color: clr }}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Simple mode — Tech Chart icon button only */}
        {simpleMode && (
          <div className="absolute z-20" style={{ bottom: 65, right: 65 }}>
            <button onClick={() => { setCT("candle"); setTf("1m"); setSimpleMode(false); }}
              title="Tech Chart"
              className="w-9 h-9 flex items-center justify-center rounded-full cursor-pointer transition-all hover:scale-105 active:scale-95"
              style={{ background: isDark ? "#1e3a5fdd" : "#2563ebdd", color: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }}>
              <IconChartBar size={18} />
            </button>
          </div>
        )}

        {/* OHLC single line — top-left, appears on crosshair move (full mode only) */}
        {!simpleMode && !loading && !error && ohlc && (
          <div className="absolute top-2 left-2 z-20 flex items-center gap-2 px-1.5 py-0.5 rounded text-[9px] font-bold"
            style={{ ...MONO, background: isDark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.8)", backdropFilter: "blur(4px)" }}>
            <span style={{ color: txtMuted }}>O<span style={{ color: txtPrimary }}> {ohlc.o.toFixed(2)}</span></span>
            <span style={{ color: txtMuted }}>H<span style={{ color: "#16a34a" }}> {ohlc.h.toFixed(2)}</span></span>
            <span style={{ color: txtMuted }}>L<span style={{ color: "#dc2626" }}> {ohlc.l.toFixed(2)}</span></span>
            <span style={{ color: txtMuted }}>C<span style={{ color: txtPrimary }}> {ohlc.c.toFixed(2)}</span></span>
          </div>
        )}

        {/* Symbol badge + Buy/Sell toggles — bottom-left (small screens, tech chart only) */}
        {!simpleMode && !loading && !error && !isIndex && (
          <div className="lg:hidden absolute left-2 z-20 flex flex-col gap-1 items-start" style={{ bottom: "100px" }}>
            <div className="flex gap-1.5">
              <button onClick={() => setTO(v => !v)}
                className="px-2.5 py-1 rounded text-[9px] font-black cursor-pointer transition-all"
                style={{ ...MONO, background: tradeOpen ? "#e11d48" : "#e11d4820", color: tradeOpen ? "#fff" : "#e11d48", border: "1px solid #e11d4840" }}>
                Sell
              </button>
              <button onClick={() => setTO(v => !v)}
                className="px-2.5 py-1 rounded text-[9px] font-black cursor-pointer transition-all"
                style={{ ...MONO, background: tradeOpen ? "#16a34a" : "#16a34a20", color: tradeOpen ? "#fff" : "#16a34a", border: "1px solid #16a34a40" }}>
                Buy
              </button>
            </div>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2"
            style={{ background: panelBg }}>
            <div className="w-7 h-7 rounded-full border-2 animate-spin"
              style={{ borderColor: border, borderTopColor: clr }} />
            <span className="text-[10px]" style={{ ...MONO, color: txtMuted }}>Loading {chartLabel} chart…</span>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3"
            style={{ background: panelBg }}>
            <p className="text-[11px]" style={{ ...MONO, color: "#e11d48" }}>{error}</p>
            <button onClick={() => { setError(null); setLoading(true); }}
              className="px-3 py-1 rounded text-[9px] font-bold cursor-pointer"
              style={{ ...MONO, background: btnBg, color: txtMuted }}>Retry</button>
          </div>
        )}
        {/* ── Replay pick-start overlay ── */}
        {!simpleMode && replayPicking && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
            <div className="px-4 py-2 rounded-lg text-[11px] font-bold text-center"
              style={{ ...MONO, background: "rgba(245,158,11,0.92)", color: "#000", boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
              Click any candle to start replay from that point
            </div>
          </div>
        )}

        {/* ── Chart nav + replay controls — bottom below buy/sell ── */}
        {!simpleMode && !loading && !error && (
          <div className="absolute left-2 z-20 flex items-center gap-1 flex-wrap" style={{ bottom: "70px" }}>
            {/* Scroll left */}
            <button onClick={() => scrollChart(-15)} title="Scroll left"
              className="w-6 h-6 flex items-center justify-center rounded cursor-pointer opacity-60 hover:opacity-100"
              style={{ background: isDark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.85)", color: txtPrimary, border: `1px solid ${border}` }}>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M5 1L2 4l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
            {/* Zoom in */}
            <button onClick={() => zoomChart(true)} title="Zoom in"
              className="w-6 h-6 flex items-center justify-center rounded cursor-pointer opacity-60 hover:opacity-100 text-[11px] font-bold"
              style={{ background: isDark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.85)", color: txtPrimary, border: `1px solid ${border}`, ...MONO }}>
              +
            </button>
            {/* Zoom out */}
            <button onClick={() => zoomChart(false)} title="Zoom out"
              className="w-6 h-6 flex items-center justify-center rounded cursor-pointer opacity-60 hover:opacity-100 text-[11px] font-bold"
              style={{ background: isDark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.85)", color: txtPrimary, border: `1px solid ${border}`, ...MONO }}>
              −
            </button>
            {/* Scroll right */}
            <button onClick={() => scrollChart(15)} title="Scroll right"
              className="w-6 h-6 flex items-center justify-center rounded cursor-pointer opacity-60 hover:opacity-100"
              style={{ background: isDark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.85)", color: txtPrimary, border: `1px solid ${border}` }}>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M3 1l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
            {/* Today */}
            <button onClick={fitToday} title="Fit to today"
              className="h-6 px-1.5 flex items-center justify-center rounded cursor-pointer opacity-60 hover:opacity-100 text-[9px] font-bold"
              style={{ background: isDark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.85)", color: txtPrimary, border: `1px solid ${border}`, ...MONO }}>
              1D
            </button>

            {/* Replay button / controls */}
            {!replayMode ? (
              <button onClick={startReplay} title="Replay"
                className="h-6 px-2 flex items-center gap-1 rounded cursor-pointer opacity-70 hover:opacity-100 text-[9px] font-bold"
                style={{ background: isDark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.85)", color: "#f59e0b", border: `1px solid #f59e0b50`, ...MONO }}>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><polygon points="1,0 8,4 1,8" fill="currentColor"/></svg>
                Replay
              </button>
            ) : replayPicking ? (
              <button onClick={stopReplay}
                className="h-6 px-2 flex items-center gap-1 rounded cursor-pointer text-[9px] font-bold"
                style={{ background: "#f59e0b", color: "#000", ...MONO }}>
                Cancel
              </button>
            ) : (
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded"
                style={{ background: isDark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.92)", border: `1px solid #f59e0b60` }}>
                {/* Step back */}
                <button onClick={() => stepReplay(-1)} disabled={replayPlaying} title="Step back"
                  className="w-5 h-5 flex items-center justify-center rounded cursor-pointer opacity-70 hover:opacity-100 disabled:opacity-30"
                  style={{ color: "#f59e0b" }}>
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M7 1L3 4l4 3V1z" fill="currentColor"/><rect x="0" y="1" width="1.5" height="6" rx="0.5" fill="currentColor"/></svg>
                </button>
                {/* Play/Pause */}
                <button onClick={toggleReplayPlay} title={replayPlaying ? "Pause" : "Play"}
                  className="w-5 h-5 flex items-center justify-center rounded cursor-pointer"
                  style={{ color: "#f59e0b" }}>
                  {replayPlaying
                    ? <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><rect x="0" y="0" width="3" height="8" rx="0.5" fill="currentColor"/><rect x="5" y="0" width="3" height="8" rx="0.5" fill="currentColor"/></svg>
                    : <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><polygon points="0,0 8,4 0,8" fill="currentColor"/></svg>}
                </button>
                {/* Step forward */}
                <button onClick={() => stepReplay(1)} disabled={replayPlaying} title="Step forward"
                  className="w-5 h-5 flex items-center justify-center rounded cursor-pointer opacity-70 hover:opacity-100 disabled:opacity-30"
                  style={{ color: "#f59e0b" }}>
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 1l4 3-4 3V1z" fill="currentColor"/><rect x="6.5" y="1" width="1.5" height="6" rx="0.5" fill="currentColor"/></svg>
                </button>
                {/* Speed */}
                <button onClick={() => setReplaySpeed(s => s === 1 ? 2 : s === 2 ? 4 : 1)}
                  className="text-[8px] font-bold px-1 cursor-pointer"
                  style={{ ...MONO, color: "#f59e0b" }}>{replaySpeed}x</button>
                {/* Counter */}
                <span className="text-[8px] font-bold" style={{ ...MONO, color: "#f59e0b" }}>
                  {replayIdx + 1}/{replayCandlesRef.current.length}
                </span>
                {/* Stop */}
                <button onClick={stopReplay} title="Stop"
                  className="w-5 h-5 flex items-center justify-center rounded cursor-pointer opacity-70 hover:opacity-100"
                  style={{ color: "#e11d48" }}>
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><rect x="0" y="0" width="8" height="8" rx="1" fill="currentColor"/></svg>
                </button>
              </div>
            )}
          </div>
        )}

        {/* RSI pane resize handle — tech chart only */}
        {!simpleMode && indicators.has("RSI") && !loading && !error && (
          <div
            className="absolute left-0 right-0 z-30 flex items-center justify-center cursor-ns-resize select-none"
            style={{ bottom: rsiHeight - 3, height: 8 }}
            onMouseDown={(e) => {
              e.preventDefault();
              rsiDragRef.current = { startY: e.clientY, startH: rsiHeightRef.current };
            }}
          >
            <div className="w-12 h-[3px] rounded-full" style={{ background: isDark ? "#334155" : "#cbd5e1" }} />
          </div>
        )}

        <div ref={chartDivRef} className="absolute inset-0" />
      </div>

      {/* ══ SIMPLE MODE — period buttons ══ */}
      {simpleMode && (
        <div className="flex-shrink-0 flex items-center gap-1 px-3 py-2"
          style={{ borderTop: `1px solid ${border}`, background: isDark ? "#080b0f" : "#f1f5f9" }}>
          {["1D","1W","1M","3M","6M","1Y","5Y"].map(p => (
            <button key={p} onClick={() => handleSimplePeriod(p)}
              className="flex-1 py-1 rounded text-[9px] font-black cursor-pointer transition-all active:scale-95"
              style={{
                ...MONO,
                background: simplePeriod === p ? "#16a34a" : "transparent",
                color: simplePeriod === p ? "#fff" : txtMuted,
              }}>
              {p}
            </button>
          ))}
        </div>
      )}

      {/* ══ FOOTER — absolute overlay so chart never shrinks ══ */}
      {tradeOpen && !isIndex && (
      <div className="absolute bottom-0 left-0 right-0 z-30" style={{ borderTop: `1px solid ${border}`, background: panelBg }}>

        {/* Equity mode toggle — Intraday / Equity */}
        {isEquity && (
          <div className="flex items-center px-4 py-2" style={{ borderBottom: `1px solid ${divider}` }}>
            <div className="flex items-center rounded-lg overflow-hidden"
              style={{ border: `1px solid ${border}` }}>
              {(["intraday", "swing"] as const).map(m => (
                <button key={m}
                  onClick={() => setEquityMode(m)}
                  className="px-3 h-7 text-[9px] font-bold cursor-pointer transition-colors"
                  style={{ ...MONO, background: equityMode === m ? "#16a34a" : "transparent", color: equityMode === m ? "#fff" : txtMuted }}>
                  {m === "intraday" ? "Intraday" : "Equity"}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Row 1: symbol + action badge + live price */}
        <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: `1px solid ${divider}` }}>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-bold truncate" style={{ ...MONO, color: txtPrimary }}>
              {chartLabel}
            </span>
            {!isEquity && (
              <span className="text-[8px] px-1.5 py-0.5 rounded font-bold flex-shrink-0"
                style={{ ...MONO, background: isCE ? "#0284c720" : "#e11d4820", color: isCE ? "#0284c7" : "#e11d48" }}>
                {type}
              </span>
            )}
            {isEquity && (
              <span className="text-[8px] px-1.5 py-0.5 rounded font-bold flex-shrink-0"
                style={{ ...MONO, background: "#16a34a20", color: "#16a34a" }}>
                NSE
              </span>
            )}
            {liveOrLast > 0 && (
              <span className="text-[13px] font-black flex-shrink-0" style={{ ...MONO, color: txtPrimary }}>
                ₹{liveOrLast.toFixed(2)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {orderState.result && (
              <span className="text-[9px] font-bold"
                style={{ ...MONO, color: orderState.result.startsWith("✓") ? "#16a34a" : "#e11d48" }}>
                {orderState.result}
              </span>
            )}
            <button onClick={() => setTO(false)}
              className="w-6 h-6 flex items-center justify-center rounded-full cursor-pointer transition-colors hover:opacity-70"
              style={{ background: btnBg, color: txtMuted }}>
              <IconX size={11} />
            </button>
          </div>
        </div>

        {/* Row 2: Available wallet + Total cost */}
        <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: `1px solid ${divider}` }}>
          <div className="flex flex-col items-start gap-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] uppercase" style={{ ...MONO, color: txtMuted }}>Available</span>
              {isIntraday5x && (
                <span className="text-[7px] font-black px-1 py-0.5 rounded"
                  style={{ background: "#f59e0b20", color: "#f59e0b", border: "1px solid #f59e0b40", ...MONO }}>
                  5x
                </span>
              )}
              {isIntraday5x && maxQty !== null && (
                <span className="text-[7px]" style={{ ...MONO, color: txtMuted }}>
                  max {maxQty} shares
                </span>
              )}
            </div>
            <span className="text-[12px] font-bold"
              style={{ ...MONO, color: effectiveWallet !== null && !canBuy ? "#e11d48" : "#16a34a" }}>
              {fmtWallet}
            </span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[8px] uppercase" style={{ ...MONO, color: txtMuted }}>
              {isEquity ? "Stock + Charges" : "Approx Req"}
            </span>
            <span className="text-[12px] font-bold" style={{ ...MONO, color: approxClr }}>
              ₹{approxBuy.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>

        {/* Equity charges breakdown */}
        {isEquity && eqCharges !== null && equityQty > 0 && liveOrLast > 0 && (
          <div className="px-4 py-1.5 flex flex-wrap gap-x-3 gap-y-0.5" style={{ borderBottom: `1px solid ${divider}`, background: isDark ? "#0a0f1a" : "#f8fafc" }}>
            <span className="text-[8px]" style={{ ...MONO, color: txtMuted }}>
              Stock <span style={{ color: txtPrimary }}>₹{stockCost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
            </span>
            {isIntraday5x && (
              <span className="text-[8px]" style={{ ...MONO, color: txtMuted }}>
                Brok <span style={{ color: txtPrimary }}>₹{eqCharges.brokerage.toFixed(2)}</span>
              </span>
            )}
            <span className="text-[8px]" style={{ ...MONO, color: txtMuted }}>
              STT <span style={{ color: txtPrimary }}>₹{eqCharges.stt.toFixed(2)}</span>
            </span>
            <span className="text-[8px]" style={{ ...MONO, color: txtMuted }}>
              Txn <span style={{ color: txtPrimary }}>₹{eqCharges.txn.toFixed(2)}</span>
            </span>
            <span className="text-[8px]" style={{ ...MONO, color: txtMuted }}>
              GST <span style={{ color: txtPrimary }}>₹{eqCharges.gst.toFixed(2)}</span>
            </span>
            <span className="text-[8px]" style={{ ...MONO, color: txtMuted }}>
              Stamp <span style={{ color: txtPrimary }}>₹{eqCharges.stamp.toFixed(2)}</span>
            </span>
            <span className="text-[8px] font-bold ml-auto" style={{ ...MONO, color: "#f59e0b" }}>
              Total charges ₹{eqCharges.total.toFixed(2)}
            </span>
          </div>
        )}

        {/* Row 3: Qty (equity) / Lots (options) */}
        <div className="px-4 py-2.5 flex items-center gap-3" style={{ borderBottom: `1px solid ${divider}` }}>
          {isEquity ? (
            <>
              <span className="text-[9px] uppercase" style={{ ...MONO, color: txtMuted }}>Qty</span>
              <button onClick={() => { const v = Math.max(1, equityQty - 1); setEquityQty(v); setEquityQtyStr(String(v)); }}
                className="w-7 h-7 rounded-full flex items-center justify-center text-[14px] font-bold cursor-pointer"
                style={{ background: btnBg, color: btnClr }}>−</button>
              <input
                type="text"
                inputMode="numeric"
                value={equityQtyStr}
                onChange={e => { const raw = e.target.value.replace(/[^0-9]/g, ""); setEquityQtyStr(raw); const n = parseInt(raw, 10); if (!isNaN(n) && n >= 1) setEquityQty(n); }}
                onFocus={e => e.target.select()}
                onBlur={() => { const n = parseInt(equityQtyStr, 10); const safe = isNaN(n) || n < 1 ? 1 : n; setEquityQty(safe); setEquityQtyStr(String(safe)); }}
                className="text-[14px] font-bold text-center rounded outline-none w-14 h-7"
                style={{ ...MONO, color: txtPrimary, background: btnBg, border: `1px solid ${border}` }}
              />
              <button onClick={() => { const v = equityQty + 1; setEquityQty(v); setEquityQtyStr(String(v)); }}
                className="w-7 h-7 rounded-full flex items-center justify-center text-[14px] font-bold cursor-pointer"
                style={{ background: btnBg, color: btnClr }}>+</button>
              <div className="ml-auto flex flex-col items-end gap-0">
                <span className="text-[9px] font-bold" style={{ ...MONO, color: txtPrimary }}>
                  {equityQty} share{equityQty !== 1 ? "s" : ""}
                </span>
                {maxQty !== null && (
                  <span className="text-[8px]" style={{ ...MONO, color: "#f59e0b" }}>
                    {isIntraday5x ? `5x margin · max ${maxQty}` : `max ${maxQty}`}
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              <span className="text-[9px] uppercase" style={{ ...MONO, color: txtMuted }}>Lots</span>
              <button onClick={() => setOL(v => Math.max(1, v - 1))}
                className="w-7 h-7 rounded-full flex items-center justify-center text-[14px] font-bold cursor-pointer"
                style={{ background: btnBg, color: btnClr }}>−</button>
              <span className="text-[14px] font-bold w-6 text-center" style={{ ...MONO, color: txtPrimary }}>
                {orderLots}
              </span>
              <button onClick={() => setOL(v => v + 1)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-[14px] font-bold cursor-pointer"
                style={{ background: btnBg, color: btnClr }}>+</button>
              <span className="text-[9px] ml-auto" style={{ ...MONO, color: txtMuted }}>
                {orderLots} × {activeLotSize} = {orderLots * activeLotSize} qty
              </span>
            </>
          )}
        </div>

        {/* Insufficient funds warning */}
        {!canBuy && effectiveWallet !== null && (
          <div className="mx-4 mb-2 px-3 py-1.5 rounded-lg text-[9px] text-center font-bold"
            style={{ ...MONO, background: "#e11d4815", color: "#e11d48", border: "1px solid #e11d4830" }}>
            Insufficient funds · Need ₹{(approxBuy - effectiveWallet).toLocaleString("en-IN", { maximumFractionDigits: 0 })} more
          </div>
        )}

        {/* Row 4: Sell / Buy buttons */}
        <div className="grid grid-cols-2 gap-2 px-4 pb-3 pt-2">
          <button disabled={orderState.loading || !canBuy} onClick={() => placeOrder("SELL")}
            className="py-1.5 rounded-lg text-[10px] font-black tracking-[0.5px] transition-opacity cursor-pointer"
            style={{ ...MONO, background: "#e11d48", color: "#fff", opacity: orderState.loading || !canBuy ? 0.4 : 1 }}>
            {orderState.loading ? "..." : "↙ Sell @ Mkt"}
          </button>
          <button disabled={orderState.loading || !canBuy} onClick={() => placeOrder("BUY")}
            className="py-1.5 rounded-lg text-[10px] font-black tracking-[0.5px] transition-opacity cursor-pointer"
            style={{ ...MONO, background: "#16a34a", color: "#fff", opacity: orderState.loading || !canBuy ? 0.4 : 1 }}>
            {orderState.loading ? "..." : "↗ Buy @ Mkt"}
          </button>
        </div>

        {/* Trade line legend */}
        {tradeLines && (
          <div className="flex items-center gap-3 px-4 pb-2.5 flex-wrap">
            <div className="flex items-center gap-1">
              <div className="w-4 border-t-[2px] border-dashed" style={{ borderColor: "#38bdf8" }} />
              <span className="text-[8px] font-bold" style={{ ...MONO, color: "#38bdf8" }}>Entry ₹{tradeLines.entry.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 border-t-[2px] border-dashed" style={{ borderColor: "#16a34a" }} />
              <span className="text-[8px] font-bold" style={{ ...MONO, color: "#16a34a" }}>Target ₹{tradeLines.target.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 border-t-[2px] border-dashed" style={{ borderColor: "#e11d48" }} />
              <span className="text-[8px] font-bold" style={{ ...MONO, color: "#e11d48" }}>SL ₹{tradeLines.sl.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

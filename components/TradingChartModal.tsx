"use client";

import { useState, useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
} from "lightweight-charts";
import { IconX, IconChevronLeft } from "@tabler/icons-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { optionsApi, accountApi, createWS } from "@/lib/api";
import { calcRR } from "@/lib/options";
import { LOT_SIZE } from "@/lib/constants";
import { useTheme } from "@/lib/theme";

// ── Types ─────────────────────────────────────────────────────────────────────
type TfLabel = "1m" | "3m" | "5m" | "10m" | "15m" | "1h" | "4h" | "1D";
type ChartType = "candle" | "line";
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
  onClose: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const MONO = { fontFamily: "'Space Mono', monospace" } as const;

type TfConfig = { label: TfLabel; kiteInterval: string; fromDays: number; aggMinutes: number };

const TF_LIST: TfConfig[] = [
  { label: "1m",  kiteInterval: "minute",   fromDays: 2,  aggMinutes: 1   },
  { label: "3m",  kiteInterval: "minute",   fromDays: 2,  aggMinutes: 3   },
  { label: "5m",  kiteInterval: "minute",   fromDays: 3,  aggMinutes: 5   },
  { label: "10m", kiteInterval: "minute",   fromDays: 4,  aggMinutes: 10  },
  { label: "15m", kiteInterval: "minute",   fromDays: 5,  aggMinutes: 15  },
  { label: "1h",  kiteInterval: "60minute", fromDays: 20, aggMinutes: 0   },
  { label: "4h",  kiteInterval: "60minute", fromDays: 45, aggMinutes: 240 },
  { label: "1D",  kiteInterval: "day",      fromDays: 90, aggMinutes: 0   },
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
export default function TradingChartModal({
  token, strike, type, expiry, sym, tradingsymbol, index = "NIFTY", onClose,
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
  const [chartType, setCT]  = useState<ChartType>("candle");
  const [indicators, setInd]= useState<Set<Indicator>>(new Set(["RSI", "BB", "VOL"] as Indicator[]));
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
  const indDropRef  = useRef<HTMLDivElement>(null);

  // Close indicator dropdown on outside click
  useEffect(() => {
    if (!indOpen) return;
    const handler = (e: MouseEvent) => {
      if (indDropRef.current && !indDropRef.current.contains(e.target as Node)) setIndOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [indOpen]);

  // ── Stable refs ──────────────────────────────────────────────────────────────
  const chartDivRef  = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<any>(null);
  const seriesRef    = useRef<Record<string, any>>({});
  const rawRef       = useRef<Candle[]>([]);
  const currentRef   = useRef<Candle | null>(null);
  const tfMinRef     = useRef(1);
  const ctRef        = useRef<ChartType>("candle");
  const indRef       = useRef<Set<Indicator>>(new Set(["RSI", "BB", "VOL"] as Indicator[]));
  const tlDataRef    = useRef<typeof tradeLines>(null);
  const tlSeriesRef  = useRef<{ ep:any; tp:any; sp:any } | null>(null);
  const isDarkRef    = useRef(isDark);

  const isCE  = type === "CE";
  const clr   = isCE ? "#0284c7" : "#dc2626";
  const tfCfg = TF_LIST.find(t => t.label === tf)!;

  // ── Fetch wallet ─────────────────────────────────────────────────────────────
  useEffect(() => {
    accountApi.get().then(d => setWallet(d.wallet.available)).catch(() => {});
  }, []);

  // ── Fetch candles when token or tf changes ───────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setError(null);
    rawRef.current   = [];
    currentRef.current = null;

    const today = new Date().toISOString().split("T")[0];

    let fetchPromise: Promise<Candle[]>;

    if (tfCfg.kiteInterval === "minute") {
      // Full expiry period — from expiry cycle start date to today
      const fromDate = getExpiryStart(expiry);
      fetchPromise = optionsApi
        .candleRange(token, fromDate, today, "minute")
        .catch(() => ({ rows: [] }))
        .then((d: any) => (d.rows ?? []).map((r: any) => ({
          time: istToUnix(r.date), open: r.open, high: r.high,
          low: r.low, close: r.close, volume: r.volume ?? 0,
        })));
    } else {
      // Multi-day range fetch with the correct kite interval
      const fromDate = dateFromDaysAgo(tfCfg.fromDays);
      fetchPromise = optionsApi
        .candleRange(token, fromDate, today, tfCfg.kiteInterval)
        .catch(() => ({ rows: [] }))
        .then((d: any) => (d.rows ?? []).map((r: any) => ({
          time: istToUnix(r.date), open: r.open, high: r.high,
          low: r.low, close: r.close, volume: r.volume ?? 0,
        })));
    }

    fetchPromise
      .then(candles => {
        // Strip pre/post-market candles for all intraday intervals
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
      },
      grid: { vertLines: { color: chartGrid }, horzLines: { color: chartGrid } },
      crosshair: { mode: 1 },
      localization: {
        // istToUnix encodes IST time as UTC, so read UTC fields directly — no offset needed
        timeFormatter: (ts: number) => {
          const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
          const d   = new Date(ts * 1000);
          const day = d.getUTCDate();
          const mon = MONTHS[d.getUTCMonth()];
          const h   = d.getUTCHours();
          const m   = String(d.getUTCMinutes()).padStart(2, "0");
          const ap  = h >= 12 ? "PM" : "AM";
          const h12 = h % 12 || 12;
          return `${day} ${mon} ${h12}:${m} ${ap}`;
        },
        priceFormatter: (p: number) => `₹${p.toFixed(2)}`,
      },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: chartBdr },
      rightPriceScale: { borderColor: chartBdr, scaleMargins: { top: 0.06, bottom: 0.06 } },
      autoSize: true,
    } as any);

    chartRef.current = chart;
    const s   = seriesRef.current;
    const ind = indRef.current;

    // Pane 0: main series
    if (chartType === "candle") {
      s.main = chart.addSeries(CandlestickSeries, {
        upColor: "#16a34a", downColor: "#dc2626",
        borderUpColor: "#16a34a", borderDownColor: "#dc2626",
        wickUpColor: "#16a34a", wickDownColor: "#dc2626",
      } as any, 0);
    } else {
      s.main = chart.addSeries(LineSeries, { color: clr, lineWidth: 2, lastValueVisible: true, priceLineVisible: false } as any, 0);
    }

    // BB overlay
    const bbBase = { lineWidth: 1, lastValueVisible: false, priceLineVisible: false, visible: ind.has("BB") };
    s.bbUp  = chart.addSeries(LineSeries, { ...bbBase, color: "#a855f7", lineStyle: 1 } as any, 0);
    s.bbMid = chart.addSeries(LineSeries, { ...bbBase, color: "#a855f7", lineStyle: 2 } as any, 0);
    s.bbDn  = chart.addSeries(LineSeries, { ...bbBase, color: "#a855f7", lineStyle: 1 } as any, 0);

    // Pane 1: volume
    s.vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false, visible: ind.has("VOL"),
    } as any, 1);

    // Pane 2: RSI
    s.rsi = chart.addSeries(LineSeries, {
      color: "#f59e0b", lineWidth: 1.5, lastValueVisible: true, priceLineVisible: false, visible: ind.has("RSI"),
    } as any, 2);
    if (ind.has("RSI")) {
      try {
        s.rsi.createPriceLine({ price: 70, color: "rgba(220,38,38,0.5)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "70" });
        s.rsi.createPriceLine({ price: 30, color: "rgba(22,163,74,0.5)",  lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "30" });
      } catch {}
    }

    // Pane heights — collapse hidden indicator panes to avoid empty gaps
    try {
      const p = (chart as any).panes?.();
      if (p?.[1]) p[1].setHeight(ind.has("VOL") ? 55 : 0);
      if (p?.[2]) p[2].setHeight(ind.has("RSI") ? 75 : 0);
    } catch {}

    // Populate data
    const t = (c: Candle) => c.time as any;
    if (chartType === "candle") {
      s.main.setData(candles.map(c => ({ time: t(c), open: c.open, high: c.high, low: c.low, close: c.close })));
    } else {
      s.main.setData(candles.map(c => ({ time: t(c), value: c.close })));
    }
    // Pin right-side price axis to start at 0
    s.main.applyOptions({
      autoscaleInfoProvider: (original: () => any) => {
        const res = original();
        if (!res) return res;
        return { ...res, priceRange: { ...res.priceRange, minValue: 0 } };
      },
    } as any);

    const bbV = candles.map((c, i) => ({ c, bb: bbArr[i] })).filter(x => x.bb.mid != null);
    s.bbUp.setData(bbV.map(x => ({ time: t(x.c), value: x.bb.up!  })));
    s.bbMid.setData(bbV.map(x => ({ time: t(x.c), value: x.bb.mid! })));
    s.bbDn.setData(bbV.map(x => ({ time: t(x.c), value: x.bb.dn!  })));
    s.vol.setData(candles.map(c => ({ time: t(c), value: c.volume, color: c.close >= c.open ? "rgba(22,163,74,0.4)" : "rgba(220,38,38,0.4)" })));
    const rsiV = candles.map((c, i) => ({ c, rsi: rsiArr[i] })).filter(x => x.rsi != null);
    s.rsi.setData(rsiV.map(x => ({ time: t(x.c), value: x.rsi! })));

    chart.timeScale().fitContent();

    // Crosshair tooltip
    chart.subscribeCrosshairMove((param: any) => {
      if (!param.time || !param.seriesData?.size) { setOhlc(null); return; }
      const md = param.seriesData.get(s.main);
      const vd = param.seriesData.get(s.vol);
      if (md) setOhlc({ o: md.open ?? md.value ?? 0, h: md.high ?? md.value ?? 0, l: md.low ?? md.value ?? 0, c: md.close ?? md.value ?? 0, v: vd?.value ?? 0 });
      else setOhlc(null);
    });

    // Redraw persisted trade lines
    if (tlDataRef.current) {
      try { tlSeriesRef.current = mkTLs(s.main, tlDataRef.current); } catch {}
    }

    return () => { chart.remove(); chartRef.current = null; seriesRef.current = {}; };
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
        if (ctRef.current === "candle")
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
    if (ind === "VOL") { s.vol?.applyOptions({ visible: on }); }
    if (ind === "RSI") { s.rsi?.applyOptions({ visible: on }); }
    // Resize panes so empty panes don't leave a gap
    try {
      const p = (chartRef.current as any)?.panes?.();
      if (p?.[1]) p[1].setHeight(next.has("VOL") ? 55 : 0);
      if (p?.[2]) p[2].setHeight(next.has("RSI") ? 75 : 0);
    } catch {}
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
      await accountApi.placeOrder(tsym, action, orderLots * LOT_SIZE);
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

  // ── Computed for footer ───────────────────────────────────────────────────
  const liveOrLast = livePrice ?? rawRef.current[rawRef.current.length - 1]?.close ?? 0;
  const approxBuy  = liveOrLast * orderLots * LOT_SIZE;
  const canBuy     = wallet === null || wallet >= approxBuy;
  const fmtWallet  = wallet !== null ? `₹${wallet.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—";
  const approxClr  = !canBuy ? "#e11d48" : txtPrimary;

  // ── Render ─────────────────────────────────────────────────────────────────
  // Fills absolute inset-0 of parent — no overlay/modal
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: panelBg, zIndex: 100 }}>

      {/* ══ HEADER ══ */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 flex-wrap"
        style={{ borderBottom: `1px solid ${border}`, background: isDark ? "#0d1424" : "#f8fafc" }}>

        {/* Back / close */}
        <button onClick={onClose}
          className="flex items-center gap-1 px-2 h-7 rounded cursor-pointer flex-shrink-0 transition-colors hover:opacity-80"
          style={{ background: btnBg, color: txtMuted }}>
          <IconChevronLeft size={13} />
          <span className="text-[9px] font-bold hidden sm:inline" style={MONO}>Back</span>
        </button>

        {/* Large screen: symbol label + Buy/Sell — next to Back button */}
        {!loading && !error && (
          <div className="hidden lg:flex items-center gap-1.5 flex-shrink-0">
            <span className="flex items-center h-7 px-2.5 rounded text-[9px] font-black"
              style={{ ...MONO, color: isCE ? "#38bdf8" : "#f472b6", background: isCE ? "#38bdf815" : "#f472b615", border: `1px solid ${isCE ? "#38bdf840" : "#f472b640"}` }}>
              {index} {strike} {type}
            </span>
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
            {TF_LIST.map(({ label }) => (
              <SelectItem key={label} value={label} className="text-[9px] font-bold" style={MONO}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Chart type */}
        <div className="flex rounded overflow-hidden flex-shrink-0" style={{ border: `1px solid ${border}` }}>
          <button onClick={() => setCT("candle")} title="Candlestick"
            className="w-7 h-7 flex items-center justify-center cursor-pointer transition-colors"
            style={{ background: chartType === "candle" ? clr : "transparent", color: chartType === "candle" ? "#fff" : txtMuted }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="1" y="3" width="3.5" height="5" rx="0.4" fill="currentColor"/>
              <line x1="2.75" y1="1" x2="2.75" y2="3"   stroke="currentColor" strokeWidth="1.4"/>
              <line x1="2.75" y1="8" x2="2.75" y2="11"  stroke="currentColor" strokeWidth="1.4"/>
              <rect x="7.5" y="4.5" width="3.5" height="3" rx="0.4" fill="currentColor" opacity="0.55"/>
              <line x1="9.25" y1="2" x2="9.25" y2="4.5"  stroke="currentColor" strokeWidth="1.4"/>
              <line x1="9.25" y1="7.5" x2="9.25" y2="10" stroke="currentColor" strokeWidth="1.4"/>
            </svg>
          </button>
          <button onClick={() => setCT("line")} title="Line"
            className="w-7 h-7 flex items-center justify-center cursor-pointer transition-colors"
            style={{ background: chartType === "line" ? clr : "transparent", color: chartType === "line" ? "#fff" : txtMuted }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <polyline points="1,9 3.5,5.5 6,7 9,3 11,4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

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

      {/* ══ CHART ══ */}
      <div className="flex-1 relative overflow-hidden">

        {/* OHLC single line — top-left, appears on crosshair move */}
        {!loading && !error && ohlc && (
          <div className="absolute top-2 left-2 z-20 flex items-center gap-2 px-1.5 py-0.5 rounded text-[8px]"
            style={{ ...MONO, background: isDark ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.7)", backdropFilter: "blur(4px)" }}>
            <span style={{ color: txtMuted }}>O<span style={{ color: txtPrimary }}> {ohlc.o.toFixed(2)}</span></span>
            <span style={{ color: txtMuted }}>H<span style={{ color: "#16a34a" }}> {ohlc.h.toFixed(2)}</span></span>
            <span style={{ color: txtMuted }}>L<span style={{ color: "#dc2626" }}> {ohlc.l.toFixed(2)}</span></span>
            <span style={{ color: txtMuted }}>C<span style={{ color: txtPrimary }}> {ohlc.c.toFixed(2)}</span></span>
          </div>
        )}

        {/* Symbol badge + Buy/Sell toggles — bottom-left (small screens only) */}
        {!loading && !error && (
          <div className="lg:hidden absolute left-2 z-20 flex flex-col gap-1 items-start" style={{ bottom: "100px" }}>
            <span className="text-[9px] font-black px-2 py-0.5 rounded"
              style={{ ...MONO, color: isCE ? "#38bdf8" : "#f472b6",
                background: isDark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.75)",
                backdropFilter: "blur(6px)", border: `1px solid ${isCE ? "#38bdf840" : "#f472b640"}` }}>
              {index} {strike} {type}
            </span>
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
            <span className="text-[10px]" style={{ ...MONO, color: txtMuted }}>Loading {strike} {type} chart…</span>
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
        <div ref={chartDivRef} className="absolute inset-0" />
      </div>

      {/* ══ FOOTER — exact scalper design, hidden until Buy/Sell clicked ══ */}
      {tradeOpen && (
      <div className="flex-shrink-0" style={{ borderTop: `1px solid ${border}`, background: panelBg }}>

        {/* Row 1: symbol + action badge + live price */}
        <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: `1px solid ${divider}` }}>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-bold truncate" style={{ ...MONO, color: txtPrimary }}>
              {index} {strike} {type}
            </span>
            <span className="text-[8px] px-1.5 py-0.5 rounded font-bold flex-shrink-0"
              style={{ ...MONO, background: isCE ? "#0284c720" : "#e11d4820", color: isCE ? "#0284c7" : "#e11d48" }}>
              {type}
            </span>
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

        {/* Row 2: Wallet + Approx Req */}
        <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: `1px solid ${divider}` }}>
          <div className="flex flex-col items-start gap-0.5">
            <span className="text-[8px] uppercase" style={{ ...MONO, color: txtMuted }}>Available</span>
            <span className="text-[12px] font-bold"
              style={{ ...MONO, color: wallet !== null && !canBuy ? "#e11d48" : "#16a34a" }}>
              {fmtWallet}
            </span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[8px] uppercase" style={{ ...MONO, color: txtMuted }}>Approx Req</span>
            <span className="text-[12px] font-bold" style={{ ...MONO, color: approxClr }}>
              ₹{approxBuy.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>

        {/* Row 3: Lots */}
        <div className="px-4 py-2.5 flex items-center gap-3" style={{ borderBottom: `1px solid ${divider}` }}>
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
            {orderLots} × {LOT_SIZE} = {orderLots * LOT_SIZE} qty
          </span>
        </div>

        {/* Insufficient funds warning */}
        {!canBuy && wallet !== null && (
          <div className="mx-4 mb-2 px-3 py-1.5 rounded-lg text-[9px] text-center font-bold"
            style={{ ...MONO, background: "#e11d4815", color: "#e11d48", border: "1px solid #e11d4830" }}>
            Insufficient funds · Need ₹{(approxBuy - wallet).toLocaleString("en-IN", { maximumFractionDigits: 0 })} more
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

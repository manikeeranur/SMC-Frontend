"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  Suspense,
  useMemo,
} from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
} from "lightweight-charts";
import { useSearchParams, useRouter } from "next/navigation";
import { generateChain, getNiftyExpiries } from "@/lib/demoOptions";
import {
  calcRR,
  calcPnL,
  calcMaxPain,
  calcPCR,
  fmtOI,
  getATM,
  type OptionsChainData,
  type OptionsRow,
  type OptionLeg,
  type WatchedOption,
} from "@/lib/options";
import {
  smcApi,
  optionsApi,
  authApi,
  autoTradeApi,
  accountApi,
  watchlistApi,
  createWS,
  isDemoMode,
  AuthError,
} from "@/lib/api";

import { LOT_SIZE, SENSEX_LOT_SIZE } from "@/lib/constants";
import { ThemeToggle, useTheme } from "@/lib/theme";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ResultsContent } from "@/components/ResultsContent";
import { AccountTab } from "@/components/AccountTab";
import TradingChartModal from "@/components/TradingChartModal";
import WatchlistCombobox, { type SearchResult } from "@/components/WatchlistCombobox";
import IndexSwiper from "@/components/IndexSwiper";
import {
  IconPower,
  IconCopy,
  IconCopyCheck,
  IconX,
  IconChartCandle,
  IconScan,
  IconBookmark,
  IconBookmarkFilled,
  IconLayoutGrid,
  IconChartLine,
  IconFileAnalytics,
  IconWallet,
  IconPlus,
  IconCheck,
  IconTrash,
} from "@tabler/icons-react";

const MONO = { fontFamily: "'Space Mono', monospace" } as const;
const BEBAS = { fontFamily: "'Bebas Neue', sans-serif" } as const;

const MARKET_HOLIDAYS_2026: { date: string; name: string }[] = [
  { date: "2026-01-26", name: "Republic Day" },
  { date: "2026-02-18", name: "Mahashivratri" },
  { date: "2026-03-20", name: "Holi" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-14", name: "Dr. Ambedkar Jayanti" },
  { date: "2026-05-01", name: "Maharashtra Day" },
  { date: "2026-05-19", name: "Buddha Purnima" },
  { date: "2026-06-16", name: "Eid-ul-Adha" },
  { date: "2026-10-02", name: "Gandhi Jayanti" },
  { date: "2026-10-22", name: "Dussehra" },
  { date: "2026-11-10", name: "Diwali — Laxmi Puja" },
  { date: "2026-11-11", name: "Diwali — Balipratipada" },
  { date: "2026-11-30", name: "Guru Nanak Jayanti" },
  { date: "2026-12-25", name: "Christmas" },
];
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
function holidayDayName(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return DAY_NAMES[d.getDay()];
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="text-[8px] px-1.5 py-0.5 rounded-sm font-bold tracking-[1px]"
      style={{
        ...MONO,
        background: `${color}22`,
        color,
        border: `1px solid ${color}44`,
      }}
    >
      {label}
    </span>
  );
}

// ─── Inner page (uses useSearchParams — must be inside Suspense) ───────────────
function OptionsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const kiteStatus = searchParams.get("kite");
  const kiteUser = searchParams.get("user") ?? "";
  const kiteErrMsg = searchParams.get("msg") ?? "";

  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [expiries, setExpiries] = useState<string[]>(getNiftyExpiries());
  const [expiry, setExpiry] = useState("");
  // SMC always uses NIFTY expiry regardless of chainIndex
  const [niftyExpiry, setNiftyExpiry] = useState("");
  const [data, setData] = useState<OptionsChainData | null>(null);
  const [loading, setLoading] = useState(false);
  const [strikeRange] = useState<5 | 10 | 15>(15);
  const [live, setLive] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "chain" | "smc" | "watchlist" | "ohlc" | "results" | "account"
  >("chain");
  type WlistGroup = { id: string; name: string; items: WatchedOption[] };
  const [wlistGroups, setWlistGroups] = useState<WlistGroup[]>([{ id: "wl_default", name: "My Watchlist", items: [] }]);
  const [activeWlId, setActiveWlId] = useState("wl_default");
  const [wlDragToken, setWlDragToken]     = useState<number | null>(null);
  const [wlDragOverToken, setWlDragOverToken] = useState<number | null>(null);
  const [showCreateWlist, setShowCreateWlist] = useState(false);
  const [newWlistName, setNewWlistName] = useState("");
  const watchlist = wlistGroups.find(g => g.id === activeWlId)?.items ?? [];
  function setWatchlist(fn: ((prev: WatchedOption[]) => WatchedOption[]) | WatchedOption[]) {
    const updater = typeof fn === "function" ? fn : (_: WatchedOption[]) => fn as WatchedOption[];
    setWlistGroups(prev => prev.map(g => g.id === activeWlId ? { ...g, items: updater(g.items) } : g));
  }
  const [smcAlerts, setSmcAlerts] = useState<any[]>([]);
  const [smcWinRate, setSmcWinRate] = useState<number | null>(null);
  const [smcStatus, setSmcStatus] = useState<{
    scanActive: boolean;
    lastScanAt: string | null;
    wins: number;
    losses: number;
  } | null>(null);
  const [smcBusy, setSmcBusy] = useState(false);
  const [histDate, setHistDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  });
  const [histBusy, setHistBusy] = useState(false);
  const [histErr, setHistErr] = useState("");
  const [histResults, setHistResults] = useState<any[] | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [autoPositions, setAutoPositions] = useState<any[]>([]);
  const [candles3m, setCandles3m] = useState<Record<number, any[]>>({});
  const dragIdxRef = useRef<number | null>(null);
  const chainScrollRef = useRef<HTMLDivElement>(null);
  const atmRowRef = useRef<HTMLDivElement>(null);
  const [authenticated, setAuthenticated] = useState(isDemoMode);
  const [liveUser, setLiveUser] = useState(kiteUser);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [holidaysOpen, setHolidaysOpen] = useState(false);
  const [kiteProfile, setKiteProfile] = useState<{
    user_id: string;
    user_name: string;
    email: string | null;
    avatar_url: string | null;
    broker: string;
  } | null>(null);
  const [justLoggedIn, setJustLoggedIn] = useState(kiteStatus === "connected");
  const [ohlcDate, setOhlcDate] = useState(
    () => new Date().toISOString().split("T")[0],
  );
  const [ohlcCE, setOhlcCE] = useState<{
    token: number;
    strike: number;
  } | null>(null);
  const [ohlcPE, setOhlcPE] = useState<{
    token: number;
    strike: number;
  } | null>(null);
  const [ohlcBusy, setOhlcBusy] = useState(false);

  // ── Option chain mode toggles ───────────────────────────────────────────────
  const [chainIndex, setChainIndex] = useState<"NIFTY" | "SENSEX">("NIFTY");
  const chainLotSize = chainIndex === "SENSEX" ? SENSEX_LOT_SIZE : LOT_SIZE;
  const [scalperOn, setScalerOn] = useState(true);
  const [strategyOn, setStrategyOn] = useState(false);
  type ChainOrder = {
    strike: number;
    type: "CE" | "PE";
    action: "BUY" | "SELL";
    ltp: number;
    token: number;
    leg: OptionLeg;
  };
  const [chainOrderPanel, setChainOrderPanel] = useState<ChainOrder | null>(
    null,
  );
  const [orderLots, setOrderLots] = useState(1);
  const [basketLegs, setBasketLegs] = useState<ChainOrder[]>([]);
  const [walletAvailable, setWalletAvailable] = useState<number | null>(null);
  const [orderState, setOrderState] = useState<{ loading: boolean; result: string | null }>({ loading: false, result: null });

  // ── Trading chart modal ──────────────────────────────────────────────────────
  const [chartTarget, setChartTarget] = useState<{
    token: number;
    strike: number;
    type: "CE" | "PE";
    expiry: string;
    sym: string;
    tradingsymbol?: string;
    index: string;
    isEquity?: boolean;
    isIndex?: boolean;
    prevClose?: number;
    ltpChange?: number;
  } | null>(null);

  // Restore all persisted state after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    if (!isDemoMode && localStorage.getItem("kite_auth") === "1") {
      setAuthenticated(true);
      const u = localStorage.getItem("kite_user");
      if (u) setLiveUser(u);
    }
    // Load watchlists: localStorage first (always up-to-date), then sync MongoDB in background
    try {
      const v2 = localStorage.getItem("kite_wlist_v2");
      if (v2) {
        const parsed = JSON.parse(v2);
        setWlistGroups(parsed.groups ?? [{ id: "wl_default", name: "My Watchlist", items: [] }]);
        setActiveWlId(parsed.activeId ?? "wl_default");
      } else {
        const old = localStorage.getItem("kite_watchlist");
        if (old) setWlistGroups([{ id: "wl_default", name: "My Watchlist", items: JSON.parse(old) }]);
      }
    } catch {}
    // Background sync from MongoDB only if localStorage was empty
    (async () => {
      try {
        if (!isDemoMode && !localStorage.getItem("kite_wlist_v2")) {
          const { groups } = await watchlistApi.getGroups();
          if (groups.length > 0) {
            setWlistGroups(groups);
            setActiveWlId(groups[0].id);
          }
        }
      } catch {}
    })();
    const savedTab = localStorage.getItem("kite_tab") as
      | "chain"
      | "smc"
      | "watchlist"
      | "ohlc"
      | "results"
      | null;
    if (savedTab) setActiveTab(savedTab);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    // Always save to localStorage as fallback
    try {
      localStorage.setItem("kite_wlist_v2", JSON.stringify({ groups: wlistGroups, activeId: activeWlId }));
    } catch {}
    // Sync to MongoDB — debounced 2s
    if (!isDemoMode) {
      const t = setTimeout(() => {
        wlistGroups.forEach(g => {
          watchlistApi.saveGroup(g.id, g.name, g.items).catch(() => {});
        });
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [wlistGroups, activeWlId, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem("kite_tab", activeTab);
    } catch {}
  }, [activeTab, hydrated]);

  const tickRef = useRef<ReturnType<typeof setInterval>>();
  // 1-min candle closes per option token → for RSI(14) on watchlist
  const priceHistRef = useRef<
    Record<number, { closes: number[]; lastKey: number }>
  >({});
  // 6-min OI/Vol snapshot per token → ratio = delta-OI / delta-Volume every 6 minutes
  const oiVolHistRef = useRef<
    Record<
      number,
      { snapOI: number; snapVol: number; lastKey: number; ratio: number }
    >
  >({});

  // ── Fetch live expiry dates from backend ────────────────────────────────────
  useEffect(() => {
    if (isDemoMode) return;
    optionsApi
      .expiries(chainIndex)
      .then((d) => {
        if (d.expiries?.length) {
          setExpiries(d.expiries);
          setExpiry(d.expiries[0]);
        }
      })
      .catch(() => {});
  }, [authenticated, chainIndex]);

  // ── Always keep a fresh NIFTY expiry for SMC (independent of chainIndex) ───
  useEffect(() => {
    if (isDemoMode) return;
    optionsApi
      .expiries("NIFTY")
      .then((d) => { if (d.expiries?.length) setNiftyExpiry(d.expiries[0]); })
      .catch(() => {});
  }, [authenticated]);

  // ── Check backend auth status on mount ─────────────────────────────────────
  useEffect(() => {
    if (isDemoMode) return;
    if (kiteStatus === "connected") {
      setAuthenticated(true);
      setLiveUser(kiteUser);
      localStorage.setItem("kite_auth", "1");
      if (kiteUser) localStorage.setItem("kite_user", kiteUser);
      window.history.replaceState({}, "", "/options");
      setTimeout(() => setJustLoggedIn(false), 2200);
      return;
    }
    authApi
      .status()
      .then((d) => {
        setAuthenticated(d.authenticated);
        if (!d.authenticated) {
          localStorage.removeItem("kite_auth");
          localStorage.removeItem("kite_user");
        }
      })
      .catch(() => {
        // Network error — keep existing localStorage auth state, don't force logout
      });
  }, [kiteStatus, kiteUser]);

  useEffect(() => {
    if (isDemoMode && expiries.length && !expiry) setExpiry(expiries[0]);
  }, [expiries, expiry]);

  // ── Fetch Kite profile once authenticated ──────────────────────────────────
  useEffect(() => {
    if (!authenticated || isDemoMode) return;
    authApi
      .profile()
      .then(setKiteProfile)
      .catch(() => {});
  }, [authenticated]);

  // ── WebSocket ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isDemoMode || !authenticated) return;
    const ws = createWS((msg) => {
      if (msg.type === "scan_result") {
        if (msg.active) setActiveTab("smc");
        fetchSMCAlerts(); // refresh CMP + peakMove on every backend scan
      }
      if (msg.type === "status") setAuthenticated(msg.authenticated);
    });
    return () => ws?.close();
  }, [authenticated]);

  // ── Refresh option chain ────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!expiry) return;

    // helper: push LTP into 1-min candle bucket (for RSI-14 on watchlist)
    function trackCandle(token: number, ltp: number) {
      const n = new Date();
      const key = n.getHours() * 60 + n.getMinutes(); // 1-minute key
      if (!priceHistRef.current[token]) {
        priceHistRef.current[token] = { closes: [ltp], lastKey: key };
      } else {
        const h = priceHistRef.current[token];
        if (key !== h.lastKey) {
          h.closes = [...h.closes.slice(-44), ltp]; // keep 45 closes for stable RSI-14
          h.lastKey = key;
        }
      }
    }

    // helper: track OI/Volume ratio in 6-min buckets
    function trackOIVol(token: number, oi: number, volume: number) {
      const n = new Date();
      const key = Math.floor((n.getHours() * 60 + n.getMinutes()) / 6); // 6-min bucket
      const h = oiVolHistRef.current[token];
      if (!h) {
        oiVolHistRef.current[token] = {
          snapOI: oi,
          snapVol: volume,
          lastKey: key,
          ratio: volume > 0 ? +(oi / volume).toFixed(1) : 0,
        };
      } else if (key !== h.lastKey) {
        // New 6-min window: ratio = delta-OI / delta-Volume
        const dVol = volume - h.snapVol;
        const dOI = oi - h.snapOI;
        const ratio = dVol > 0 ? +(dOI / dVol).toFixed(1) : dOI !== 0 ? 999 : 0;
        oiVolHistRef.current[token] = {
          snapOI: oi,
          snapVol: volume,
          lastKey: key,
          ratio,
        };
      }
    }

    // ── DEMO MODE ─────────────────────────────────────────────────────────
    if (isDemoMode) {
      const d = generateChain(expiry);
      setData(d);
      d.rows.forEach((r) => {
        trackCandle(r.ce.token, r.ce.ltp);
        trackCandle(r.pe.token, r.pe.ltp);
      });
      setWatchlist((prev) =>
        prev.map((w) => {
          const row = d.rows.find((r) => r.strike === w.leg.strike);
          const newLeg = w.leg.type === "CE" ? row?.ce : row?.pe;
          const current = newLeg?.ltp ?? w.leg.ltp;
          trackCandle(w.leg.token, current);
          if (newLeg) trackOIVol(w.leg.token, newLeg.oi, newLeg.volume);
          const { pnl, pct, status } = calcPnL(current, w.rr);
          return {
            ...w,
            leg: newLeg ?? w.leg,
            currentPnL: pnl,
            pnlPct: pct,
            status: w.status !== "ACTIVE" ? w.status : status,
          };
        }),
      );
      return;
    }

    // ── LIVE MODE ─────────────────────────────────────────────────────────
    if (!authenticated) return;
    try {
      setLoading(true);
      const d = (await optionsApi.chain(
        expiry,
        strikeRange,
        chainIndex,
      )) as OptionsChainData;
      setData(d);
      d.rows.forEach((r) => {
        trackCandle(r.ce.token, r.ce.ltp);
        trackCandle(r.pe.token, r.pe.ltp);
      });
      setWatchlist((prev) =>
        prev.map((w) => {
          const row = d.rows.find((r) => r.strike === w.leg.strike);
          const newLeg = w.leg.type === "CE" ? row?.ce : row?.pe;
          const current = newLeg?.ltp ?? w.leg.ltp;
          trackCandle(w.leg.token, current);
          if (newLeg) trackOIVol(w.leg.token, newLeg.oi, newLeg.volume);
          const { pnl, pct, status } = calcPnL(current, w.rr);
          return {
            ...w,
            leg: newLeg ?? w.leg,
            currentPnL: pnl,
            pnlPct: pct,
            status: w.status !== "ACTIVE" ? w.status : status,
          };
        }),
      );
    } catch (err: any) {
      console.error("[Chain] Fetch error:", err.message);
      if (err instanceof AuthError) {
        setAuthenticated(false);
        localStorage.removeItem("kite_auth");
        localStorage.removeItem("kite_user");
      }
    } finally {
      setLoading(false);
    }
  }, [expiry, strikeRange, authenticated]);

  useEffect(() => {
    if (expiry && (isDemoMode || authenticated)) refresh();
  }, [expiry, refresh, authenticated]);

  useEffect(() => {
    const interval = isDemoMode ? 2000 : 500;
    if (live) tickRef.current = setInterval(refresh, interval);
    else clearInterval(tickRef.current);
    return () => clearInterval(tickRef.current);
  }, [live, refresh]);

  // ── SMC alerts fetch + manual trigger ─────────────────────────────────────
  async function handleCopyToken() {
    try {
      const API = process.env.NEXT_PUBLIC_API_URL!;
      const res = await fetch(`${API}/api/auth/token-value`);
      const data = await res.json();
      if (!data.access_token) return;

      // Modern clipboard API works only on HTTPS / localhost.
      // Fall back to execCommand for mobile browsers on plain HTTP.
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(data.access_token);
      } else {
        const ta = document.createElement("textarea");
        ta.value = data.access_token;
        ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }

      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    } catch {}
  }

  async function handleLogout() {
    try {
      await authApi.logout();
    } catch {}
    localStorage.removeItem("kite_auth");
    localStorage.removeItem("kite_user");
    setAuthenticated(false);
    setLiveUser("");
  }

  async function fetchSMCAlerts() {
    const e = niftyExpiry || expiry;
    if (!e || isDemoMode || !authenticated) return;
    try {
      const r = (await smcApi.alerts(e)) as any;
      const alerts = r.alerts ?? [];
      setSmcAlerts(alerts);
      setSmcWinRate(r.winRate ?? null);
    } catch {}
  }

  async function triggerSMCScan() {
    const e = niftyExpiry || expiry;
    if (!e || isDemoMode || !authenticated) return;
    setSmcBusy(true);
    try {
      await smcApi.scan(e);
      setTimeout(fetchSMCAlerts, 2000);
    } catch {
    } finally {
      setSmcBusy(false);
    }
  }

  // Auto-load backtest from MongoDB when date changes
  useEffect(() => {
    if (!authenticated || isDemoMode) return;
    smcApi
      .loadBacktest(histDate)
      .then((data: any) => {
        if (data.results?.length) {
          setHistResults(data.results);
          if (data.winRate != null) setSmcWinRate(data.winRate);
        } else {
          setHistResults(null);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [histDate, authenticated]);

  async function runHistoricalSMC() {
    const e = niftyExpiry || expiry;
    if (!e || isDemoMode || !authenticated) return;
    setHistBusy(true);
    setHistErr("");
    setHistResults(null);
    try {
      const r = (await smcApi.historical(histDate, e)) as any;
      const results = r.results ?? [];
      setHistResults(results);
      // also update winRate display from historical result
      if (r.winRate !== null && r.winRate !== undefined)
        setSmcWinRate(r.winRate);
    } catch (e: any) {
      setHistErr(e.message || "Failed to fetch historical scan");
    } finally {
      setHistBusy(false);
    }
  }

  // Auto-refresh SMC alerts every 60 seconds when on SMC tab
  useEffect(() => {
    if (activeTab !== "smc" || !authenticated || isDemoMode) return;
    fetchSMCAlerts();
    const t = setInterval(fetchSMCAlerts, 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, niftyExpiry, expiry, authenticated]);

  // Fetch SMC status every 30s
  useEffect(() => {
    if (isDemoMode || !authenticated) return;
    const tick = () =>
      smcApi
        .status()
        .then((s: any) => setSmcStatus(s))
        .catch(() => {});
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [authenticated]);

  // Poll SMC alerts every 1s when on SMC tab — keeps CMP + Max Points live
  useEffect(() => {
    if (isDemoMode || !authenticated || activeTab !== "smc") return;
    const t = setInterval(fetchSMCAlerts, 1000);
    return () => clearInterval(t);
  }, [authenticated, activeTab, niftyExpiry, expiry]);

  // Poll auto-trade status every 10s when on SMC tab
  useEffect(() => {
    if (isDemoMode || !authenticated || activeTab !== "smc") return;
    const tick = () =>
      autoTradeApi
        .status()
        .then((s: any) => {
          setAutoTradeEnabled(s.enabled);
          setAutoPositions(s.positions ?? []);
        })
        .catch(() => {});
    tick();
    const t = setInterval(tick, 10_000);
    return () => clearInterval(t);
  }, [authenticated, activeTab]);

  async function toggleAutoTrade() {
    try {
      const r = autoTradeEnabled
        ? await autoTradeApi.disable()
        : await autoTradeApi.enable();
      setAutoTradeEnabled(r.enabled);
    } catch {}
  }

  // ── Fetch wallet balance when order panel opens ─────────────────────────────
  const panelOpen = !!(chainOrderPanel || basketLegs.length > 0);
  useEffect(() => {
    if (!panelOpen) return;
    if (isDemoMode || !authenticated) {
      setWalletAvailable(null); // demo: no real wallet
      return;
    }
    accountApi
      .get()
      .then((d) => setWalletAvailable(d.wallet.available))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, authenticated]);

  // ── Auto-scroll chain to ATM row on tab switch or expiry change ────────────
  useEffect(() => {
    if (activeTab !== "chain" || !chainScrollRef.current || !data) return;
    const container = chainScrollRef.current;
    const scroll = () => {
      const atmEl = container.querySelector<HTMLElement>("[data-atm='true']");
      if (!atmEl) return;
      const offset = atmEl.offsetTop - container.clientHeight / 3;
      container.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
    };
    const t = setTimeout(scroll, 80);
    return () => clearTimeout(t);
  }, [activeTab, data?.expiry]);

  // ── Place a market order from the chain panel ──────────────────────────────
  async function handlePlaceOrder(action: "BUY" | "SELL") {
    if (!chainOrderPanel) return;
    const tradingsymbol = chainOrderPanel.leg.tradingsymbol || "";
    if (!tradingsymbol) {
      setOrderState({ loading: false, result: "✗ Symbol not available" });
      setTimeout(() => setOrderState({ loading: false, result: null }), 3000);
      return;
    }
    const qty = orderLots * chainLotSize;
    setOrderState({ loading: true, result: null });
    try {
      const resp = await accountApi.placeOrder(tradingsymbol, action, qty, chainIndex === "SENSEX" ? "BFO" : "NFO");
      setOrderState({ loading: false, result: `✓ Order placed  #${resp.order_id}` });
      setTimeout(() => {
        setOrderState({ loading: false, result: null });
        setChainOrderPanel(null);
      }, 3000);
    } catch (err: any) {
      setOrderState({ loading: false, result: `✗ ${err.message}` });
      setTimeout(() => setOrderState({ loading: false, result: null }), 4000);
    }
  }

  const watchlistTokens = new Set(watchlist.map((w) => w.leg.token));

  // ── Fetch 3-min candles for a watchlist token ──────────────────────────────
  async function fetchCandles3m(token: number) {
    if (isDemoMode || !authenticated) return;
    try {
      const today = new Date().toISOString().split("T")[0];
      const { rows } = (await optionsApi.candles(
        token,
        today,
        "3minute",
      )) as any;
      setCandles3m((prev) => ({ ...prev, [token]: rows ?? [] }));
    } catch {
      setCandles3m((prev) => ({ ...prev, [token]: [] }));
    }
  }

  // ── Refresh live quotes for equity watchlist items ────────────────────────
  useEffect(() => {
    if (isDemoMode || !authenticated) return;
    const equityItems = wlistGroups.flatMap(g => g.items).filter(
      w => !w.expiry || w.leg.strike === 0 || !/\d/.test(w.leg.tradingsymbol ?? "")
    );
    if (!equityItems.length) return;

    async function fetchEquityQuotes() {
      const instruments = equityItems.map(w => `${w.exchange || "NSE"}:${w.leg.tradingsymbol}`);
      try {
        const { quotes } = await optionsApi.quotes(instruments);
        setWlistGroups(prev => prev.map(g => ({
          ...g,
          items: g.items.map(w => {
            const key = `${w.exchange || "NSE"}:${w.leg.tradingsymbol}`;
            const q = quotes[key];
            if (!q) return w;
            return { ...w, leg: { ...w.leg, ltp: q.ltp, prevLtp: q.prevClose, ltpChange: q.ltpChange } };
          }),
        })));
      } catch {}
    }

    fetchEquityQuotes();
    const timer = setInterval(fetchEquityQuotes, 5000);
    return () => clearInterval(timer);
  }, [
    wlistGroups.flatMap(g => g.items).filter(w => !w.expiry || w.leg.strike === 0).map(w => w.leg.token).join(","),
    authenticated, isDemoMode,
  ]);

  // Refresh 3m candles for all watchlist items every 3 minutes
  useEffect(() => {
    const ids = watchlist.map((w) => w.leg.token);
    ids.forEach((t) => fetchCandles3m(t));
    const timer = setInterval(
      () => ids.forEach((t) => fetchCandles3m(t)),
      3 * 60 * 1000,
    );
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlist.map((w) => w.leg.token).join(","), authenticated]);

  function addToWatch(leg: OptionLeg) {
    if (watchlist.find((w) => w.leg.token === leg.token)) {
      setWatchlist((prev) => prev.filter((w) => w.leg.token !== leg.token));
      return;
    }
    const rr = calcRR(leg.ltp, data?.atmIV ?? 15);
    setWatchlist((prev) => [
      {
        leg,
        entryPrice: leg.ltp,
        rr,
        addedAt: new Date().toLocaleTimeString("en-IN", { hour12: false }),
        status: "ACTIVE",
        currentPnL: 0,
        pnlPct: 0,
        expiry,
      },
      ...prev,
    ]);
    fetchCandles3m(leg.token);
  }

  function removeWatch(token: number) {
    setWlistGroups(prev => {
      const updated = prev.map(g =>
        g.id === activeWlId ? { ...g, items: g.items.filter(w => w.leg.token !== token) } : g
      );
      if (!isDemoMode) {
        const g = updated.find(gr => gr.id === activeWlId);
        if (g) watchlistApi.saveGroup(g.id, g.name, g.items).catch(() => {});
      }
      return updated;
    });
    setCandles3m((prev) => {
      const n = { ...prev };
      delete n[token];
      return n;
    });
  }

  // ── Drag-and-drop handlers ─────────────────────────────────────────────────
  function handleDragStart(idx: number) {
    dragIdxRef.current = idx;
  }
  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    setDragOver(idx);
  }
  function handleDrop(idx: number) {
    const from = dragIdxRef.current;
    if (from === null || from === idx) {
      setDragOver(null);
      return;
    }
    setWatchlist((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(idx, 0, item);
      return next;
    });
    dragIdxRef.current = null;
    setDragOver(null);
  }

  // ── Redirect to login if not authenticated ──────────────────────────────────
  if (!isDemoMode && hydrated && !authenticated) {
    router.replace("/");
    return null;
  }

  // ── Derived values ─────────────────────────────────────────────────────────
  const { pcrVol, pcrOI, totalCEOI, totalPEOI } = data
    ? calcPCR(data.rows)
    : { pcrVol: 0, pcrOI: 0, totalCEOI: 0, totalPEOI: 0 };
  const maxPain = data ? calcMaxPain(data.rows) : 0;
  const atmStrike = data ? getATM(data.spot) : 0;
  const filteredRows = data
    ? data.rows.filter((r) => {
        const aidx = data.rows.findIndex((x) => x.isATM);
        const ridx = data.rows.findIndex((x) => x.strike === r.strike);
        return Math.abs(ridx - aidx) <= strikeRange;
      })
    : [];

  // ── Login loading overlay ───────────────────────────────────────────────────
  if (justLoggedIn) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center"
        style={{ background: "#050a0f" }}
      >
        {/* Grid bg */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(2,132,199,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(2,132,199,0.04) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div className="relative flex flex-col items-center gap-6">
          {/* Brand */}
          <div
            className="text-[48px] leading-none tracking-[2px]"
            style={BEBAS}
          >
            <span className="text-white">ALGO</span>
            <span style={{ color: "#0284c7" }}>.</span>
            <span style={{ color: "#ea580c" }}>BOT</span>
          </div>
          {/* Spinner */}
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 rounded-full border-2 border-[#0284c7]/20" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#0284c7] animate-spin" />
            <div
              className="absolute inset-[6px] rounded-full border-2 border-transparent border-t-[#ea580c] animate-spin"
              style={{
                animationDirection: "reverse",
                animationDuration: "0.6s",
              }}
            />
          </div>
          {/* Status */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="text-[10px] tracking-[3px] text-white" style={MONO}>
              AUTHENTICATING
            </div>
            <div
              className="text-[8px] tracking-[2px]"
              style={{ ...MONO, color: "#4a6080" }}
            >
              {liveUser
                ? `WELCOME, ${liveUser.toUpperCase()}`
                : "VERIFYING KITE SESSION…"}
            </div>
          </div>
          {/* Progress bar */}
          <div className="w-48 h-[2px] bg-[#0f1923] overflow-hidden rounded-full">
            <div
              className="h-full bg-gradient-to-r from-[#0284c7] to-[#ea580c] rounded-full animate-[progress_2.2s_ease-in-out_forwards]"
              style={{
                width: "0%",
                animation: "progress 2.2s ease-in-out forwards",
              }}
            />
          </div>
        </div>
        <style>{`@keyframes progress { from { width:0% } to { width:100% } }`}</style>
      </div>
    );
  }

  // ── Avatar helper (used in header + drawer) ───────────────────────────────
  const profileInitials = kiteProfile
    ? kiteProfile.user_name
        .trim()
        .split(/\s+/)
        .map((w) => w.charAt(0))
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : liveUser
      ? liveUser
          .trim()
          .split(/\s+/)
          .map((w: string) => w.charAt(0))
          .join("")
          .slice(0, 2)
          .toUpperCase()
      : "?";

  function ProfileAvatar({ size }: { size: number }) {
    const initialsNode = (
      <div
        className="rounded-full flex items-center justify-center font-black flex-shrink-0"
        style={{
          width: size,
          height: size,
          background: "#ea580c22",
          color: "#ea580c",
          fontSize: size * 0.35,
          lineHeight: 1,
        }}
      >
        {profileInitials}
      </div>
    );
    if (kiteProfile?.avatar_url) {
      return (
        <img
          src={kiteProfile.avatar_url}
          alt={kiteProfile.user_name}
          className="rounded-full object-cover flex-shrink-0 ring-2 ring-[#ea580c]/20"
          style={{ width: size, height: size }}
          onError={(e) => {
            // If the image fails to load, replace with initials div
            const el = e.currentTarget;
            el.style.display = "none";
            el.insertAdjacentHTML(
              "afterend",
              `<div style="width:${size}px;height:${size}px;background:#ea580c22;color:#ea580c;border-radius:9999px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:${Math.round(size * 0.35)}px;flex-shrink:0">${profileInitials}</div>`,
            );
          }}
        />
      );
    }
    return initialsNode;
  }

  return (
    <div
      className="flex flex-col h-screen bg-[#f0f4f8] overflow-hidden"
      style={{ fontFamily: "'DM Sans',sans-serif" }}
    >
      {/* ══ HEADER ══ */}
      <header
        className="flex items-center px-3 md:px-5 h-[52px] flex-shrink-0 gap-3"
        style={{
          background: isDark ? "#0f172a" : "#fff",
          borderBottom: `1px solid ${isDark ? "#1e293b" : "#cbd5e1"}`,
        }}
      >
        {/* Left: profile avatar (mobile, opens drawer) / logo (desktop) */}
        <button
          className="md:hidden flex items-center gap-2 cursor-pointer focus:outline-none min-w-0 flex-shrink-0"
          onClick={() => setDrawerOpen(true)}
        >
          <ProfileAvatar size={32} />
          {(kiteProfile?.user_name || liveUser) && (
            <div className="flex flex-col items-start min-w-0">
              <span
                className="text-[11px] font-bold truncate max-w-[150px] leading-tight"
                style={{ ...MONO, color: isDark ? "#e2e8f0" : "#1e293b" }}
              >
                {kiteProfile?.user_name || liveUser}
              </span>
              {kiteProfile?.user_id && (
                <span
                  className="text-[9px] leading-tight"
                  style={{ ...MONO, color: "#64748b" }}
                >
                  {kiteProfile.user_id}
                </span>
              )}
            </div>
          )}
        </button>
        {/* Desktop: profile details */}
        <div className="hidden md:flex items-center gap-2.5 flex-shrink-0">
          <ProfileAvatar size={34} />
          {kiteProfile?.user_name || liveUser ? (
            <div className="flex flex-col items-start min-w-0">
              <span
                className="text-[12px] font-bold leading-tight truncate max-w-[160px]"
                style={{ ...MONO, color: isDark ? "#e2e8f0" : "#1e293b" }}
              >
                {kiteProfile?.user_name || liveUser}
              </span>
              {kiteProfile?.user_id && (
                <span
                  className="text-[9px] leading-tight"
                  style={{ ...MONO, color: "#64748b" }}
                >
                  {kiteProfile.user_id}
                </span>
              )}
            </div>
          ) : (
            <img
              src="/logo.png"
              alt="ALGO.BOT"
              className="h-9 w-auto object-contain"
            />
          )}
        </div>
        <div className="flex-1" />

        {/* Right: controls */}
        <div className="flex items-center gap-1.5 md:gap-2.5 flex-shrink-0">
          {isDemoMode && <Pill label="DEMO" color="#ea580c" />}

          <div className="hidden md:block">
            <Select value={expiry} onValueChange={setExpiry}>
              <SelectTrigger
                className="h-7 px-2 text-[10px] rounded-sm border w-[130px]"
                style={{
                  ...MONO,
                  background: isDark ? "#1e293b" : "#f1f5f9",
                  borderColor: isDark ? "#334155" : "#cbd5e1",
                  color: isDark ? "#e2e8f0" : "#1e293b",
                }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {expiries.map((e) => (
                  <SelectItem key={e} value={e} style={MONO}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <span
            className="hidden sm:block text-[11px] text-[#ea580c] flex-shrink-0"
            style={MONO}
          >
            {data?.daysToExpiry.toFixed(1) ?? "—"}d
          </span>

          <button
            onClick={() => setLive((v) => !v)}
            className={`flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-[10px] rounded-sm border cursor-pointer transition-colors flex-shrink-0 ${live ? "bg-[#16a34a]/10 border-[#16a34a] text-[#16a34a]" : "bg-transparent text-[#64748b]"}`}
            style={{
              ...(live ? {} : { borderColor: isDark ? "#334155" : "#cbd5e1" }),
              ...MONO,
            }}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${live ? "bg-[#16a34a] live-pulse" : "bg-[#94a3b8]"}`}
            />
            <span className="hidden sm:inline">{live ? "LIVE" : "PAUSED"}</span>
          </button>

          {/* Today: day / date / market status — rightmost */}
          {(() => {
            const now = new Date();
            const todayStr = now.toISOString().split("T")[0];
            const dayIdx = now.getDay();
            const dayLabel = DAY_NAMES[dayIdx];
            const [, mm, dd] = todayStr.split("-");
            const monthAbbr = [
              "",
              "JAN",
              "FEB",
              "MAR",
              "APR",
              "MAY",
              "JUN",
              "JUL",
              "AUG",
              "SEP",
              "OCT",
              "NOV",
              "DEC",
            ][+mm];
            const isWeekend = dayIdx === 0 || dayIdx === 6;
            const holiday = MARKET_HOLIDAYS_2026.find(
              (h) => h.date === todayStr,
            );
            const status = holiday
              ? "HOLIDAY"
              : isWeekend
                ? "WEEKEND"
                : "WORKING";
            const statusClr = holiday || isWeekend ? "#e11d48" : "#16a34a";
            return (
              <div className="flex flex-col items-end flex-shrink-0 leading-none gap-0.5">
                <div className="flex items-baseline gap-1">
                  <span
                    className="text-[11px] font-black"
                    style={{ ...MONO, color: isDark ? "#e2e8f0" : "#1e293b" }}
                  >
                    {dayLabel}
                  </span>
                  <span
                    className="text-[10px] font-bold"
                    style={{ ...MONO, color: isDark ? "#94a3b8" : "#64748b" }}
                  >
                    {dd} {monthAbbr}
                  </span>
                </div>
                <span
                  className="text-[7.5px] font-bold tracking-[0.8px]"
                  style={{ ...MONO, color: statusClr }}
                >
                  {holiday ? holiday.name.toUpperCase().slice(0, 14) : status}
                </span>
              </div>
            );
          })()}
        </div>
      </header>

      {/* ══ BODY: sidebar + content + mobile bottom nav ══ */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Desktop left sidebar (hidden on mobile) ── */}
        <nav
          className="hidden md:flex flex-col items-center w-[60px] py-3 gap-1 flex-shrink-0"
          style={{
            background: isDark ? "#0f172a" : "#fff",
            borderRight: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`,
          }}
        >
          {(
            [
              {
                tab: "account",
                icon: <IconWallet size={20} />,
                label: "Account",
              },
              {
                tab: "chain",
                icon: <IconLayoutGrid size={20} />,
                label: "Chain",
              },
              {
                tab: "smc",
                icon: <IconScan size={20} />,
                label: "SMC",
                badge: smcAlerts.length || undefined,
              },
              {
                tab: "watchlist",
                icon: <IconBookmark size={20} />,
                label: "Watch",
                badge: watchlist.length || undefined,
              },
              { tab: "ohlc", icon: <IconChartLine size={20} />, label: "OHLC" },
              {
                tab: "results",
                icon: <IconFileAnalytics size={20} />,
                label: "Results",
              },
            ] as const
          ).map(({ tab, icon, label, badge }: any) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setChartTarget(null); }}
              title={label}
              className="relative flex flex-col items-center justify-center w-11 h-11 rounded-xl cursor-pointer transition-all"
              style={{
                background:
                  activeTab === tab ? "rgba(234,88,12,0.10)" : "transparent",
                color: activeTab === tab ? "#ea580c" : "#94a3b8",
              }}
            >
              {icon}
              {badge != null && badge > 0 && (
                <span
                  className="absolute top-1 right-1 min-w-[14px] h-[14px] px-0.5 flex items-center justify-center rounded-full text-[8px] font-bold text-white"
                  style={{
                    background: "#ea580c",
                    fontFamily: "'Space Mono',monospace",
                  }}
                >
                  {badge}
                </span>
              )}
              {smcStatus?.scanActive && tab === "smc" && (
                <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-[#7c3aed] live-pulse" />
              )}
            </button>
          ))}

          <div className="flex-1" />

          {/* Token copy */}
          {!isDemoMode && liveUser && (
            <button
              onClick={handleCopyToken}
              title={tokenCopied ? "Copied!" : `Copy token (${liveUser})`}
              className="flex flex-col items-center justify-center w-11 h-11 rounded-xl cursor-pointer transition-all"
              style={{ color: tokenCopied ? "#16a34a" : "#94a3b8" }}
            >
              {tokenCopied ? (
                <IconCopyCheck size={20} />
              ) : (
                <IconCopy size={20} />
              )}
            </button>
          )}

          {/* Dark theme toggle */}
          <ThemeToggle variant="icon" />

          {/* Logout */}
          {!isDemoMode && authenticated && (
            <button
              onClick={handleLogout}
              title="Logout"
              className="flex flex-col items-center justify-center w-11 h-11 rounded-xl cursor-pointer transition-all text-[#e11d48]/50 hover:text-[#e11d48]"
            >
              <IconPower size={20} />
            </button>
          )}
        </nav>

        {/* ══ CONTENT ══ */}
        <div className="flex-1 overflow-hidden relative">

          {/* ── Trading chart panel (replaces content when a chart icon is clicked) ── */}
          {chartTarget && (
            <TradingChartModal
              token={chartTarget.token}
              strike={chartTarget.strike}
              type={chartTarget.type}
              expiry={chartTarget.expiry}
              sym={chartTarget.sym}
              tradingsymbol={chartTarget.tradingsymbol}
              index={chartTarget.index}
              isEquity={chartTarget.isEquity}
              isIndex={chartTarget.isIndex}
              prevClose={chartTarget.prevClose}
              ltpChange={chartTarget.ltpChange}
              onClose={() => setChartTarget(null)}
            />
          )}

          {!data && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="w-6 h-6 border-2 border-[#0284c7]/30 border-t-[#00d4ff] rounded-full animate-spin" />
              <div className="text-[10px] text-[#64748b]" style={MONO}>
                {isDemoMode
                  ? "Loading demo data..."
                  : "Fetching live option chain from Kite..."}
              </div>
            </div>
          )}

          {/* ── OPTIONS CHAIN ── */}
          {activeTab === "chain" && data && (
            <div className="h-full flex flex-col overflow-hidden">
              {/* ── Desktop column headers (md+) */}
              <div className="hidden md:block flex-shrink-0 border-b border-[#cbd5e1] bg-white">
                {/* Desktop toolbar: Scalper/Strategy toggles + Index selector + stats */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#f1f5f9]">
                  <div className="flex items-center gap-3">
                    {/* Scalper toggle */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold" style={{ ...MONO, color: "#475569" }}>Scalper</span>
                      <button
                        onClick={() => setScalerOn((v) => !v)}
                        className="relative w-8 h-[18px] rounded-full transition-colors flex-shrink-0"
                        style={{ background: scalperOn ? "#0284c7" : "#cbd5e1" }}
                      >
                        <span className="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform"
                          style={{ left: scalperOn ? "18px" : "2px" }} />
                        {scalperOn && <span className="absolute inset-0 flex items-center justify-center text-[8px]">⚡</span>}
                      </button>
                    </div>
                    {/* Strategy toggle */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold" style={{ ...MONO, color: "#475569" }}>Strategy</span>
                      <button
                        onClick={() => { setStrategyOn((v) => !v); setBasketLegs([]); setChainOrderPanel(null); }}
                        className="relative w-8 h-[18px] rounded-full transition-colors flex-shrink-0"
                        style={{ background: strategyOn ? "#16a34a" : "#cbd5e1" }}
                      >
                        <span className="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform"
                          style={{ left: strategyOn ? "18px" : "2px" }} />
                        {strategyOn && <span className="absolute inset-0 flex items-center justify-center text-[8px]">🛒</span>}
                      </button>
                    </div>
                  </div>
                  {/* Index selector: NIFTY / SENSEX */}
                  <div className="flex items-center rounded-full overflow-hidden border text-[8px] font-black flex-shrink-0"
                    style={{ borderColor: "#cbd5e1", ...MONO }}>
                    {(["NIFTY", "SENSEX"] as const).map(idx => (
                      <button key={idx} onClick={() => { setChainIndex(idx); setExpiry(""); }}
                        className="px-2 py-0.5 transition-colors"
                        style={{ background: chainIndex === idx ? "#0284c7" : "transparent", color: chainIndex === idx ? "#fff" : "#64748b" }}>
                        {idx}
                      </button>
                    ))}
                  </div>
                  {/* PCR + ATM stats */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <span className="text-[7px] text-[#94a3b8] uppercase" style={MONO}>PCR</span>
                      <span className={`text-[10px] font-bold ${pcrOI >= 1 ? "text-[#16a34a]" : "text-[#e11d48]"}`} style={MONO}>{pcrOI.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[7px] text-[#94a3b8] uppercase" style={MONO}>ATM</span>
                      <span className="text-[10px] font-bold text-[#0284c7]" style={MONO}>{atmStrike}</span>
                    </div>
                  </div>
                </div>
                <div className="chain-grid">
                  <div className="py-2.5 bg-[#e8f4ff] border-r border-[#cbd5e1]" />
                  <div
                    className="chain-col-oi px-3 py-2.5 text-right text-[8px] font-bold tracking-[1.5px] text-[#0284c7] uppercase bg-[#e8f4ff]"
                    style={MONO}
                  >
                    <span className="text-[#0284c7]/50">CE </span>OI
                  </div>
                  <div
                    className="px-3 py-2.5 text-right text-[8px] font-bold tracking-[1.5px] text-[#0284c7] uppercase bg-[#e8f4ff] border-r border-[#cbd5e1]"
                    style={MONO}
                  >
                    <span className="text-[#0284c7]/50">CE </span>LTP
                  </div>
                  <div
                    className="px-2 py-2.5 text-center text-[8px] font-bold tracking-[1.5px] text-[#64748b] uppercase bg-[#e8eef5] border-x border-[#cbd5e1]"
                    style={MONO}
                  >
                    STRIKE
                  </div>
                  <div
                    className="px-3 py-2.5 text-left text-[8px] font-bold tracking-[1.5px] text-[#e11d48] uppercase bg-[#fff0f3] border-l border-[#cbd5e1]"
                    style={MONO}
                  >
                    <span className="text-[#e11d48]/50">PE </span>LTP
                  </div>
                  <div
                    className="chain-col-oi px-3 py-2.5 text-left text-[8px] font-bold tracking-[1.5px] text-[#e11d48] uppercase bg-[#fff0f3]"
                    style={MONO}
                  >
                    <span className="text-[#e11d48]/50">PE </span>OI
                  </div>
                  <div className="py-2.5 bg-[#fff0f3] border-l border-[#cbd5e1]" />
                </div>
              </div>
              {/* ── Mobile: Scalper/Strategy toolbar + column headers */}
              <div className="md:hidden flex-shrink-0 bg-white border-b border-[#cbd5e1]">
                {/* Row 1: Scalper + Strategy toggles + stats */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#f1f5f9]">
                  <div className="flex items-center gap-3">
                    {/* Scalper toggle */}
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-[9px] font-bold"
                        style={{ ...MONO, color: "#475569" }}
                      >
                        Scalper
                      </span>
                      <button
                        onClick={() => setScalerOn((v) => !v)}
                        className="relative w-8 h-[18px] rounded-full transition-colors flex-shrink-0"
                        style={{
                          background: scalperOn ? "#0284c7" : "#cbd5e1",
                        }}
                      >
                        <span
                          className="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform"
                          style={{
                            left: scalperOn ? "18px" : "2px",
                            transform: "translateX(0)",
                          }}
                        />
                        {scalperOn && (
                          <span className="absolute inset-0 flex items-center justify-center text-[8px]">
                            ⚡
                          </span>
                        )}
                      </button>
                    </div>

                    {/* Strategy toggle */}
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-[9px] font-bold"
                        style={{ ...MONO, color: "#475569" }}
                      >
                        Strategy
                      </span>
                      <button
                        onClick={() => {
                          setStrategyOn((v) => !v);
                          setBasketLegs([]);
                          setChainOrderPanel(null);
                        }}
                        className="relative w-8 h-[18px] rounded-full transition-colors flex-shrink-0"
                        style={{
                          background: strategyOn ? "#16a34a" : "#cbd5e1",
                        }}
                      >
                        <span
                          className="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform"
                          style={{ left: strategyOn ? "18px" : "2px" }}
                        />
                        {strategyOn && (
                          <span className="absolute inset-0 flex items-center justify-center text-[8px]">
                            🛒
                          </span>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Index selector: NIFTY / SENSEX */}
                  <div className="flex items-center rounded-full overflow-hidden border text-[8px] font-black flex-shrink-0"
                    style={{ borderColor: "#cbd5e1", ...MONO }}>
                    {(["NIFTY", "SENSEX"] as const).map(idx => (
                      <button key={idx} onClick={() => { setChainIndex(idx); setExpiry(""); }}
                        className="px-2 py-0.5 transition-colors"
                        style={{ background: chainIndex === idx ? "#0284c7" : "transparent", color: chainIndex === idx ? "#fff" : "#64748b" }}>
                        {idx}
                      </button>
                    ))}
                  </div>

                  {/* PCR + ATM quick stats */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <span
                        className="text-[7px] text-[#94a3b8] uppercase"
                        style={MONO}
                      >
                        PCR
                      </span>
                      <span
                        className={`text-[10px] font-bold ${pcrOI >= 1 ? "text-[#16a34a]" : "text-[#e11d48]"}`}
                        style={MONO}
                      >
                        {pcrOI.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span
                        className="text-[7px] text-[#94a3b8] uppercase"
                        style={MONO}
                      >
                        ATM
                      </span>
                      <span
                        className="text-[10px] font-bold text-[#0284c7]"
                        style={MONO}
                      >
                        {atmStrike}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Row 2: hidden expiry selector (kept for state, not rendered) */}
                <div className="hidden">
                  <Select value={expiry} onValueChange={setExpiry}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {expiries.map((e) => (
                        <SelectItem key={e} value={e} style={MONO}>
                          {e}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Row 3: Column headers */}
                <div
                  className="grid grid-cols-[1fr_72px_1fr] text-[8px] font-bold tracking-[0.5px]"
                  style={MONO}
                >
                  <div className="px-3 py-1.5 text-center text-[#0284c7] bg-[#e8f4ff]">
                    Call (₹)
                  </div>
                  <div className="py-1.5 text-center text-[#475569] bg-[#e8eef5] flex items-center justify-center text-[7px]">
                    {data.spot.toLocaleString("en-IN", {
                      maximumFractionDigits: 0,
                    })}
                  </div>
                  <div className="px-3 py-1.5 text-center text-[#e11d48] bg-[#fff0f3]">
                    Put (₹)
                  </div>
                </div>
              </div>
              <div
                ref={chainScrollRef}
                className="flex-1 overflow-y-auto"
              >
                {filteredRows.map((row) => (
                  <div key={row.strike} data-atm={row.isATM ? "true" : undefined}>
                    {row.isATM && (
                      <div
                        ref={atmRowRef}
                        className="flex items-center gap-2 px-3 py-1.5 sticky top-0 z-10"
                        style={{
                          background: "#1e293b",
                          borderTop: "1px solid #0284c7",
                          borderBottom: "1px solid #0284c7",
                        }}
                      >
                        <div className="flex-1 h-[1px] bg-[#0284c7]/30" />
                        <span
                          className="text-[10px] font-bold text-white whitespace-nowrap px-2 py-0.5 rounded-full"
                          style={{
                            ...MONO,
                            background: "#1e293b",
                            border: "1px solid #0284c7",
                          }}
                        >
                          {chainIndex}{" "}
                          {data.spot.toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                        <div className="flex-1 h-[1px] bg-[#0284c7]/30" />
                      </div>
                    )}
                    <ChainRow
                      row={row}
                      atmStrike={atmStrike}
                      onAddWatch={addToWatch}
                      addedTokens={watchlistTokens}
                      expiry={expiry}
                      scalperOn={scalperOn}
                      strategyOn={strategyOn}
                      onOrder={(leg, action) => {
                        if (strategyOn) {
                          // Add/remove leg from basket
                          setBasketLegs((prev) => {
                            const key = `${leg.strike}-${leg.type}-${action}`;
                            const exists = prev.find(
                              (l) =>
                                `${l.strike}-${l.type}-${l.action}` === key,
                            );
                            if (exists)
                              return prev.filter(
                                (l) =>
                                  `${l.strike}-${l.type}-${l.action}` !== key,
                              );
                            return [
                              ...prev,
                              {
                                strike: leg.strike,
                                type: leg.type,
                                action,
                                ltp: leg.ltp,
                                token: leg.token,
                                leg,
                              },
                            ];
                          });
                        } else {
                          setChainOrderPanel({
                            strike: leg.strike,
                            type: leg.type,
                            action,
                            ltp: leg.ltp,
                            token: leg.token,
                            leg,
                          });
                          setOrderLots(1);
                        }
                      }}
                      onOpenChart={(token, strike, type, sym, tradingsymbol) => {
                        setChartTarget({ token, strike, type: type as "CE" | "PE", expiry, sym, tradingsymbol, index: chainIndex });
                      }}
                    />
                  </div>
                ))}
              </div>

              {/* ── Bottom order panel (scalper mode) ── */}
              {!strategyOn &&
                chainOrderPanel &&
                (() => {
                  // Resolve live price from current chain data
                  const liveRow = data?.rows.find(r => r.ce.token === chainOrderPanel.token || r.pe.token === chainOrderPanel.token);
                  const liveLeg = liveRow
                    ? (liveRow.ce.token === chainOrderPanel.token ? liveRow.ce : liveRow.pe)
                    : null;
                  const liveLtp = liveLeg?.ltp ?? chainOrderPanel.ltp;
                  const approxBuy = liveLtp * orderLots * chainLotSize;
                  // BUY: need approx premium. SELL (writing): margin ~18–20× premium — show warning only.
                  const canBuy =
                    walletAvailable === null || walletAvailable >= approxBuy;
                  const fmtWallet =
                    walletAvailable !== null
                      ? `₹${walletAvailable.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                      : isDemoMode
                        ? "Demo"
                        : "—";
                  const panelBg     = isDark ? "#0f172a" : "#ffffff";
                  const panelBorder = isDark ? "#1e293b" : "#e2e8f0";
                  const rowDivider  = isDark ? "#1e293b" : "#f1f5f9";
                  const btnBg       = isDark ? "#1e293b" : "#f1f5f9";
                  const btnColor    = isDark ? "#94a3b8" : "#475569";
                  const textPrimary = isDark ? "#e2e8f0" : "#1e293b";
                  const textMuted   = isDark ? "#64748b" : "#94a3b8";
                  const approxColor = !canBuy ? "#e11d48" : (isDark ? "#94a3b8" : "#1e293b");
                  return (
                    <div className="flex-shrink-0 shadow-2xl z-20"
                      style={{ background: panelBg, borderTop: `1px solid ${panelBorder}` }}>

                      {/* Header: contract + close */}
                      <div className="flex items-center justify-between px-4 py-2"
                        style={{ borderBottom: `1px solid ${rowDivider}` }}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] font-bold truncate" style={{ ...MONO, color: textPrimary }}>
                            {(() => {
                              const sym = chainOrderPanel.leg.tradingsymbol || "";
                              // e.g. NIFTY26APR2624450CE → "NIFTY"
                              const m = sym.match(/^([A-Z]+)\d/);
                              const underlying = m ? m[1] : chainIndex;
                              return `${underlying} ${chainOrderPanel.strike} ${chainOrderPanel.type}`;
                            })()}
                          </span>
                          <span className="text-[8px] px-1.5 py-0.5 rounded font-bold flex-shrink-0"
                            style={{ background: chainOrderPanel.action === "BUY" ? "#16a34a20" : "#e11d4820",
                                     color: chainOrderPanel.action === "BUY" ? "#16a34a" : "#e11d48", ...MONO }}>
                            {chainOrderPanel.action}
                          </span>
                          {/* Live price */}
                          <span className="text-[13px] font-black flex-shrink-0" style={{ ...MONO, color: textPrimary }}>
                            ₹{liveLtp.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {/* Watchlist toggle */}
                          {(() => {
                            const isWatched = watchlistTokens.has(chainOrderPanel.token);
                            return (
                              <button onClick={() => addToWatch(chainOrderPanel.leg)}
                                className="w-6 h-6 flex items-center justify-center rounded-full flex-shrink-0"
                                style={{ background: isWatched ? "#fbbf2425" : btnBg, color: isWatched ? "#fbbf24" : textMuted }}>
                                {isWatched ? <IconBookmarkFilled size={13} /> : <IconBookmark size={13} />}
                              </button>
                            );
                          })()}
                          <button onClick={() => { setChainOrderPanel(null); setOrderState({ loading: false, result: null }); }}
                            className="w-6 h-6 flex items-center justify-center rounded-full flex-shrink-0"
                            style={{ background: btnBg, color: textMuted }}>
                            <IconX size={13} />
                          </button>
                        </div>
                      </div>

                      {/* Wallet + Approx row */}
                      <div className="flex items-center justify-between px-4 py-2"
                        style={{ borderBottom: `1px solid ${rowDivider}` }}>
                        <div className="flex flex-col items-start gap-0.5">
                          <span className="text-[8px] uppercase" style={{ ...MONO, color: textMuted }}>Available</span>
                          <span className="text-[12px] font-bold"
                            style={{ ...MONO, color: walletAvailable !== null && !canBuy ? "#e11d48" : "#16a34a" }}>
                            {fmtWallet}
                          </span>
                        </div>
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-[8px] uppercase" style={{ ...MONO, color: textMuted }}>Approx Req</span>
                          <span className="text-[12px] font-bold" style={{ ...MONO, color: approxColor }}>
                            ₹{approxBuy.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                      </div>

                      {/* Lots row */}
                      <div className="px-4 py-2.5 flex items-center gap-3">
                        <span className="text-[9px] uppercase" style={{ ...MONO, color: textMuted }}>Lots</span>
                        <button onClick={() => setOrderLots(v => Math.max(1, v - 1))}
                          className="w-7 h-7 rounded-full flex items-center justify-center text-[14px] font-bold"
                          style={{ background: btnBg, color: btnColor }}>−</button>
                        <span className="text-[14px] font-bold w-6 text-center" style={{ ...MONO, color: textPrimary }}>
                          {orderLots}
                        </span>
                        <button onClick={() => setOrderLots(v => v + 1)}
                          className="w-7 h-7 rounded-full flex items-center justify-center text-[14px] font-bold"
                          style={{ background: btnBg, color: btnColor }}>+</button>
                        <span className="text-[9px] ml-auto" style={{ ...MONO, color: textMuted }}>
                          {orderLots} × {chainLotSize} = {orderLots * chainLotSize} qty
                        </span>
                      </div>

                      {/* Order result / status */}
                      {orderState.result && (
                        <div className="mx-4 mb-2 px-3 py-2 rounded-lg text-[9px] text-center font-bold"
                          style={{ ...MONO,
                            background: orderState.result.startsWith("✓") ? "#16a34a15" : "#e11d4815",
                            color:      orderState.result.startsWith("✓") ? "#16a34a"   : "#e11d48",
                            border:     `1px solid ${orderState.result.startsWith("✓") ? "#16a34a30" : "#e11d4830"}`,
                          }}>
                          {orderState.result}
                        </div>
                      )}

                      {/* Buy / Sell buttons */}
                      <div className="grid grid-cols-2 gap-2 px-4 pb-3">
                        <button
                          disabled={!canBuy || orderState.loading}
                          onClick={() => handlePlaceOrder("SELL")}
                          className="py-1.5 rounded-lg text-[10px] font-black tracking-[0.5px] transition-opacity"
                          style={{ background: canBuy ? "#e11d48" : "#e11d4840", color: "#fff", opacity: (canBuy && !orderState.loading) ? 1 : 0.45, ...MONO }}>
                          {orderState.loading ? "..." : "↙ Sell @ Mkt"}
                        </button>
                        <button
                          disabled={!canBuy || orderState.loading}
                          onClick={() => handlePlaceOrder("BUY")}
                          className="py-1.5 rounded-lg text-[10px] font-black tracking-[0.5px] transition-opacity"
                          style={{ background: canBuy ? "#16a34a" : "#16a34a40", color: "#fff", opacity: (canBuy && !orderState.loading) ? 1 : 0.45, ...MONO }}>
                          {orderState.loading ? "..." : "↗ Buy @ Mkt"}
                        </button>
                      </div>

                      {/* Insufficient funds warning */}
                      {!canBuy && walletAvailable !== null && (
                        <div className="mx-4 mb-3 px-3 py-2 rounded-lg text-[9px] text-center font-bold"
                          style={{ ...MONO, background: "#e11d4815", color: "#e11d48", border: "1px solid #e11d4830" }}>
                          Insufficient funds · Need ₹
                          {(approxBuy - walletAvailable).toLocaleString(
                            "en-IN",
                            { maximumFractionDigits: 0 },
                          )}{" "}
                          more
                        </div>
                      )}
                    </div>
                  );
                })()}

              {/* ── Bottom basket panel (strategy mode) ── */}
              {strategyOn &&
                basketLegs.length > 0 &&
                (() => {
                  const netDebit = basketLegs.reduce(
                    (s, l) => s + (l.action === "BUY" ? l.ltp : 0),
                    0,
                  );
                  const netCredit = basketLegs.reduce(
                    (s, l) => s + (l.action === "SELL" ? l.ltp : 0),
                    0,
                  );
                  const approxReq = netDebit * orderLots * chainLotSize;
                  const canExecute =
                    walletAvailable === null || walletAvailable >= approxReq;
                  const firstLeg = basketLegs[0];
                  const breakeven =
                    firstLeg.action === "BUY"
                      ? firstLeg.type === "CE"
                        ? firstLeg.strike + firstLeg.ltp
                        : firstLeg.strike - firstLeg.ltp
                      : null;
                  const maxLoss =
                    netDebit > 0 ? -(netDebit * orderLots * chainLotSize) : null;
                  const fmtWallet =
                    walletAvailable !== null
                      ? `₹${walletAvailable.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                      : isDemoMode
                        ? "Demo"
                        : "—";
                  const panelBg     = isDark ? "#0f172a" : "#ffffff";
                  const panelBorder = isDark ? "#1e293b" : "#e2e8f0";
                  const rowDivider  = isDark ? "#1e293b" : "#f1f5f9";
                  const btnBg       = isDark ? "#1e293b" : "#f1f5f9";
                  const btnColor    = isDark ? "#94a3b8" : "#475569";
                  const textPrimary = isDark ? "#e2e8f0" : "#1e293b";
                  const textMuted   = isDark ? "#64748b" : "#94a3b8";
                  const approxColor = !canExecute ? "#e11d48" : (isDark ? "#94a3b8" : "#1e293b");
                  return (
                    <div className="flex-shrink-0 shadow-2xl z-20"
                      style={{ background: panelBg, borderTop: `1px solid ${panelBorder}` }}>

                      {/* Legs list */}
                      <div className="px-3 pt-2 pb-1 flex items-center gap-2 overflow-x-auto"
                        style={{ borderBottom: `1px solid ${rowDivider}`, scrollbarWidth: "none" }}>
                        {basketLegs.map((l, i) => (
                          <div key={i}
                            className="flex items-center gap-1 flex-shrink-0 px-2 py-1 rounded-lg border text-[9px] font-bold"
                            style={{ borderColor: l.action === "BUY" ? "#16a34a60" : "#e11d4860",
                                     background: l.action === "BUY" ? "#16a34a12" : "#e11d4812",
                                     color: l.action === "BUY" ? "#16a34a" : "#e11d48", ...MONO }}>
                            {l.action === "BUY" ? "B" : "S"} {l.strike} {l.type}
                            <button onClick={() => setBasketLegs(prev => prev.filter((_, j) => j !== i))}
                              className="ml-1 text-[10px] opacity-60">×</button>
                          </div>
                        ))}
                        <button onClick={() => setBasketLegs([])}
                          className="flex-shrink-0 px-2 py-1 rounded-lg text-[8px] font-bold ml-auto"
                          style={{ ...MONO, color: "#e11d48", background: "#e11d4815" }}>
                          Clear All
                        </button>
                      </div>

                      {/* Wallet + Approx row */}
                      <div className="flex items-center justify-between px-4 py-2"
                        style={{ borderBottom: `1px solid ${rowDivider}` }}>
                        <div className="flex flex-col items-start gap-0.5">
                          <span className="text-[8px] uppercase" style={{ ...MONO, color: textMuted }}>Available</span>
                          <span className="text-[12px] font-bold"
                            style={{ ...MONO, color: walletAvailable !== null && !canExecute ? "#e11d48" : "#16a34a" }}>
                            {fmtWallet}
                          </span>
                        </div>
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-[8px] uppercase" style={{ ...MONO, color: textMuted }}>Approx Req</span>
                          <span className="text-[12px] font-bold" style={{ ...MONO, color: approxColor }}>
                            ₹{approxReq.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                      </div>

                      {/* Metrics */}
                      <div className="grid grid-cols-3 px-3 py-2" style={{ borderBottom: `1px solid ${rowDivider}` }}>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[7px] uppercase" style={{ ...MONO, color: textMuted }}>Max Profit</span>
                          <span className="text-[11px] font-black text-[#16a34a]" style={MONO}>
                            {netCredit > netDebit
                              ? `₹${((netCredit - netDebit) * orderLots * chainLotSize).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                              : "Unlimited"}
                          </span>
                        </div>
                        <div className="flex flex-col gap-0.5 items-center">
                          <span className="text-[7px] uppercase" style={{ ...MONO, color: textMuted }}>Breakeven</span>
                          <span className="text-[11px] font-black" style={{ ...MONO, color: textPrimary }}>
                            {breakeven != null ? breakeven.toFixed(0) : "—"}
                          </span>
                        </div>
                        <div className="flex flex-col gap-0.5 items-end">
                          <span className="text-[7px] uppercase" style={{ ...MONO, color: textMuted }}>Max Loss</span>
                          <span className="text-[11px] font-black text-[#e11d48]" style={MONO}>
                            {maxLoss != null
                              ? `-₹${Math.abs(maxLoss).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                              : "Limited"}
                          </span>
                        </div>
                      </div>

                      {/* Lot + Execute */}
                      <div className="flex items-center gap-3 px-4 py-2">
                        <button onClick={() => setOrderLots(v => Math.max(1, v - 1))}
                          className="w-7 h-7 rounded-full flex items-center justify-center font-bold"
                          style={{ background: btnBg, color: btnColor }}>−</button>
                        <span className="text-[12px] font-bold w-5 text-center" style={{ ...MONO, color: textPrimary }}>{orderLots}</span>
                        <span className="text-[9px]" style={{ ...MONO, color: textMuted }}>lot{orderLots > 1 ? "s" : ""}</span>
                        <button onClick={() => setOrderLots(v => v + 1)}
                          className="w-7 h-7 rounded-full flex items-center justify-center font-bold"
                          style={{ background: btnBg, color: btnColor }}>+</button>
                      </div>
                      <div className="px-4 pb-3">
                        <button disabled={!canExecute}
                          className="w-full py-2.5 rounded-xl text-[12px] font-black tracking-[1px] transition-opacity"
                          style={{ background: canExecute ? "#16a34a" : "#16a34a40", color: "#fff", opacity: canExecute ? 1 : 0.5, ...MONO }}>
                          Execute Basket ({basketLegs.length} leg{basketLegs.length > 1 ? "s" : ""})
                        </button>
                      </div>
                      {!canExecute && walletAvailable !== null && (
                        <div className="mx-4 mb-3 px-3 py-2 rounded-lg text-[9px] text-center font-bold"
                          style={{ ...MONO, background: "#e11d4815", color: "#e11d48", border: "1px solid #e11d4830" }}>
                          Insufficient funds · Need ₹
                          {(approxReq - walletAvailable).toLocaleString(
                            "en-IN",
                            { maximumFractionDigits: 0 },
                          )}{" "}
                          more
                        </div>
                      )}
                    </div>
                  );
                })()}
            </div>
          )}

          {/* ── SMC ALERTS ── */}
          {activeTab === "smc" && (
            <SMCTableView
              alerts={smcAlerts}
              winRate={smcWinRate}
              smcStatus={smcStatus}
              busy={smcBusy}
              authenticated={authenticated}
              expiry={niftyExpiry || expiry}
              onTrigger={triggerSMCScan}
              onClear={async () => {
                await smcApi.clear();
                setSmcAlerts([]);
                setSmcWinRate(null);
              }}
              onAddWatch={addToWatch}
              histDate={histDate}
              onHistDateChange={setHistDate}
              histBusy={histBusy}
              histErr={histErr}
              histResults={histResults}
              onHistScan={runHistoricalSMC}
              onHistClear={() => {
                setHistResults(null);
                setHistErr("");
              }}
              autoTradeEnabled={autoTradeEnabled}
              autoPositions={autoPositions}
              onToggleAutoTrade={toggleAutoTrade}
              onOpenChart={(token, strike, type) =>
                setChartTarget({ token, strike, type, expiry: niftyExpiry || expiry, sym: "", index: "NIFTY" })
              }
              chainRows={data?.rows ?? []}
            />
          )}

          {/* ── WATCHLIST ── */}
          {activeTab === "watchlist" && (() => {
            const activeGroup = wlistGroups.find(g => g.id === activeWlId);

            return (
              <div className="h-full flex flex-col overflow-hidden">
                
                {/* ── Index swiper ── */}
                <IndexSwiper onOpenChart={(token, tradingsymbol, exchange, prevClose, ltpChange) =>
                  setChartTarget({ token, strike: 0, type: "CE", expiry: "", sym: tradingsymbol, tradingsymbol, index: exchange === "BSE" ? "SENSEX" : "NIFTY", isEquity: true, isIndex: true, prevClose, ltpChange })
                } />
                
                {/* ── Header: watchlist tabs + create + search ── */}
                <div className="flex-shrink-0 px-3 pt-3 pb-2 flex flex-col gap-2"
                  style={{ borderBottom: "1px solid #e2e8f0" }}>
                  {/* Row 1: watchlist tabs + create */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {wlistGroups.map(g => (
                      <button key={g.id} onClick={() => setActiveWlId(g.id)}
                        className="px-2.5 py-1 rounded-full text-[10px] font-bold transition-all flex items-center gap-1"
                        style={{ ...MONO,
                          background: activeWlId === g.id ? "#0284c7" : "#f1f5f9",
                          color: activeWlId === g.id ? "#fff" : "#475569",
                          border: `1px solid ${activeWlId === g.id ? "#0284c7" : "#e2e8f0"}` }}>
                        {g.name}
                        <span className="text-[8px] opacity-70">{g.items.length}</span>
                      </button>
                    ))}
                    {/* Create new watchlist */}
                    {!showCreateWlist ? (
                      <button onClick={() => { setShowCreateWlist(true); setNewWlistName(""); }}
                        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                        style={{ background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" }}
                        title="Create new watchlist">
                        <IconPlus size={12} />
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          value={newWlistName}
                          onChange={e => setNewWlistName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter" && newWlistName.trim()) {
                              const id = `wl_${Date.now()}`;
                              setWlistGroups(prev => [...prev, { id, name: newWlistName.trim(), items: [] }]);
                              setActiveWlId(id);
                              setShowCreateWlist(false);
                              setNewWlistName("");
                            }
                            if (e.key === "Escape") { setShowCreateWlist(false); setNewWlistName(""); }
                          }}
                          placeholder="Watchlist name…"
                          className="text-[10px] px-2 py-1 rounded-lg outline-none"
                          style={{ ...MONO, border: "1px solid #0284c7", width: 130, color: "#1e293b" }}
                        />
                        <button
                          onClick={() => {
                            if (!newWlistName.trim()) return;
                            const id = `wl_${Date.now()}`;
                            setWlistGroups(prev => [...prev, { id, name: newWlistName.trim(), items: [] }]);
                            setActiveWlId(id);
                            setShowCreateWlist(false);
                            setNewWlistName("");
                          }}
                          className="w-6 h-6 rounded-full flex items-center justify-center"
                          style={{ background: "#16a34a", color: "#fff" }}>
                          <IconCheck size={11} />
                        </button>
                        <button onClick={() => { setShowCreateWlist(false); setNewWlistName(""); }}
                          className="w-6 h-6 rounded-full flex items-center justify-center"
                          style={{ background: "#f1f5f9", color: "#94a3b8" }}>
                          <IconX size={11} />
                        </button>
                      </div>
                    )}
                    {/* Delete current watchlist (not default) */}
                    {activeWlId !== "wl_default" && !showCreateWlist && (
                      <button
                        onClick={() => {
                          const idToDelete = activeWlId;
                          setWlistGroups(prev => prev.filter(g => g.id !== idToDelete));
                          setActiveWlId("wl_default");
                          if (!isDemoMode) watchlistApi.deleteGroup(idToDelete).catch(() => {});
                        }}
                        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ml-auto"
                        style={{ background: "#fff0f3", color: "#e11d48", border: "1px solid #fecdd3" }}
                        title="Delete this watchlist">
                        <IconTrash size={11} />
                      </button>
                    )}
                  </div>

                  {/* Row 2: Search & Add combobox */}
                  <WatchlistCombobox
                    chainRows={data?.rows ?? []}
                    chainIndex={chainIndex}
                    expiry={expiry}
                    watchedTokens={watchlistTokens}
                    isDemoMode={isDemoMode}
                    onAdd={(result: SearchResult) => {
                      if (result.isOption) {
                        // Find the matching OptionLeg from chain data
                        const row = data?.rows.find(r => r.ce.token === result.token || r.pe.token === result.token);
                        const leg = row ? (row.ce.token === result.token ? row.ce : row.pe) : null;
                        if (leg) {
                          // Auto-create "FNO" watchlist group if it doesn't exist
                          const FNO_ID = "wl_fno";
                          setWlistGroups(prev => {
                            const exists = prev.find(g => g.id === FNO_ID);
                            const rr = calcRR(leg.ltp, data?.atmIV ?? 15);
                            const newItem: WatchedOption = {
                              leg, entryPrice: leg.ltp, rr,
                              addedAt: new Date().toLocaleTimeString("en-IN", { hour12: false }),
                              status: "ACTIVE", currentPnL: 0, pnlPct: 0, expiry,
                            };
                            if (exists) {
                              if (exists.items.find(w => w.leg.token === leg.token)) return prev;
                              return prev.map(g => g.id === FNO_ID ? { ...g, items: [newItem, ...g.items] } : g);
                            }
                            // Insert FNO as 2nd tab (right after wl_default)
                            const next = [...prev];
                            const defaultIdx = next.findIndex(g => g.id === "wl_default");
                            next.splice(defaultIdx >= 0 ? defaultIdx + 1 : 1, 0, { id: FNO_ID, name: "FNO", items: [newItem] });
                            return next;
                          });
                          setActiveWlId(FNO_ID);
                          setActiveTab("watchlist");
                          fetchCandles3m(leg.token);
                        }
                      } else {
                        // Equity stock — add to current tab (redirect to wl_default only if in FNO tab)
                        const targetId = activeWlId === "wl_fno" ? "wl_default" : activeWlId;
                        const syntheticLeg: OptionLeg = {
                          token: result.token, strike: 0, type: "CE",
                          tradingsymbol: result.tradingsymbol,
                          ltp: result.ltp, prevLtp: result.prevClose || result.ltp, ltpChange: result.ltpChange ?? 0,
                          oi: 0, oiChange: 0, volume: 0, iv: 0,
                          delta: 0, gamma: 0, theta: 0, vega: 0,
                          bid: 0, ask: 0, oiVolRatio: 0, moveScore: 0,
                        };
                        const rr = calcRR(result.ltp || 1, data?.atmIV ?? 15);
                        const newItem: WatchedOption = {
                          leg: syntheticLeg, entryPrice: result.ltp || 0, rr,
                          addedAt: new Date().toLocaleTimeString("en-IN", { hour12: false }),
                          status: "ACTIVE", currentPnL: 0, pnlPct: 0,
                          expiry: "", exchange: result.exchange,
                        };
                        setWlistGroups(prev => prev.map(g =>
                          g.id === targetId ? { ...g, items: [newItem, ...g.items] } : g
                        ));
                        setActiveWlId(targetId);
                        setActiveTab("watchlist");
                      }
                    }}
                    onRemove={removeWatch}
                  />
                </div>

                {/* ── Watchlist items ── */}
                <div className="flex-1 overflow-y-auto px-3 py-3">
                  {watchlist.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-[50vh] gap-3">
                      <div className="text-[40px] text-[#cbd5e1]">◈</div>
                      <p className="text-[11px] text-[#64748b] text-center" style={MONO}>
                        {activeGroup?.name ?? "Watchlist"} is empty
                      </p>
                      <p className="text-[10px] text-[#94a3b8] text-center" style={MONO}>
                        Search above or use + on chain rows
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-2 pb-4">
                      {watchlist.map((w) => {
                        const wExpiry = w.expiry ?? expiry;
                        const sym = w.leg.tradingsymbol ?? "";
                        const wIndex: "NIFTY" | "SENSEX" = sym.startsWith("SENSEX") || sym.startsWith("BSX") ? "SENSEX" : "NIFTY";
                        const wIsEquity = !wExpiry || w.leg.strike === 0 || !/\d/.test(sym);
                        return (
                          <WatchlistRow
                            key={w.leg.token}
                            watched={w}
                            candles3m={candles3m[w.leg.token] ?? []}
                            expiry={wExpiry}
                            isDragOver={wlDragOverToken === w.leg.token}
                            onRemove={() => removeWatch(w.leg.token)}
                            onOpenChart={(token, strike, type) =>
                              setChartTarget({ token, strike, type, expiry: wExpiry, sym, tradingsymbol: sym, index: wIndex, isEquity: wIsEquity })
                            }
                            onDragStart={() => setWlDragToken(w.leg.token)}
                            onDragOver={(e) => { e.preventDefault(); setWlDragOverToken(w.leg.token); }}
                            onDrop={() => {
                              if (wlDragToken == null || wlDragToken === w.leg.token) return;
                              setWlistGroups(prev => prev.map(g => {
                                if (g.id !== activeWlId) return g;
                                const items = [...g.items];
                                const from = items.findIndex(i => i.leg.token === wlDragToken);
                                const to   = items.findIndex(i => i.leg.token === w.leg.token);
                                if (from < 0 || to < 0) return g;
                                const [moved] = items.splice(from, 1);
                                items.splice(to, 0, moved);
                                return { ...g, items };
                              }));
                              setWlDragToken(null); setWlDragOverToken(null);
                            }}
                            onDragEnd={() => { setWlDragToken(null); setWlDragOverToken(null); }}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── OHLC CSV ── */}
          {activeTab === "ohlc" && (
            <OhlcTab
              expiry={expiry}
              rows={data?.rows ?? []}
              ohlcDate={ohlcDate}
              setOhlcDate={setOhlcDate}
              ohlcCE={ohlcCE}
              setOhlcCE={setOhlcCE}
              ohlcPE={ohlcPE}
              setOhlcPE={setOhlcPE}
              busy={ohlcBusy}
              setBusy={setOhlcBusy}
            />
          )}

          {/* ── RESULTS (embedded component) ── */}
          {activeTab === "results" && <ResultsContent />}

          {/* ── ACCOUNT ── */}
          {activeTab === "account" && <AccountTab />}
        </div>
      </div>

      {/* ── Mobile bottom nav (hidden on md+) ── */}
      <nav
        className="md:hidden flex items-center justify-around h-14 flex-shrink-0"
        style={{
          background: isDark ? "#0f172a" : "#fff",
          borderTop: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`,
        }}
      >
        <button
          onClick={() => setActiveTab("account")}
          className="flex flex-col items-center justify-center flex-1 h-full gap-0.5 cursor-pointer border-0 bg-transparent"
          style={{ color: activeTab === "account" ? "#ea580c" : "#94a3b8" }}
        >
          <IconWallet size={22} />
          <span className="text-[8px]" style={MONO}>
            Account
          </span>
        </button>
        <button
          onClick={() => setActiveTab("chain")}
          className="relative flex flex-col items-center justify-center flex-1 h-full gap-0.5 cursor-pointer border-0 bg-transparent"
          style={{ color: activeTab === "chain" ? "#ea580c" : "#94a3b8" }}
        >
          <IconLayoutGrid size={22} />
          <span className="text-[8px]" style={MONO}>
            Chain
          </span>
        </button>
        <button
          onClick={() => setActiveTab("smc")}
          className="relative flex flex-col items-center justify-center flex-1 h-full gap-0.5 cursor-pointer border-0 bg-transparent"
          style={{ color: activeTab === "smc" ? "#ea580c" : "#94a3b8" }}
        >
          <IconScan size={22} />
          <span className="text-[8px]" style={MONO}>
            SMC
          </span>
          {smcAlerts.length > 0 && (
            <span
              className="absolute top-1.5 right-[calc(50%-18px)] min-w-[14px] h-[14px] px-0.5 flex items-center justify-center rounded-full text-[8px] font-bold text-white"
              style={{ background: "#ea580c" }}
            >
              {smcAlerts.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("watchlist")}
          className="relative flex flex-col items-center justify-center flex-1 h-full gap-0.5 cursor-pointer border-0 bg-transparent"
          style={{ color: activeTab === "watchlist" ? "#ea580c" : "#94a3b8" }}
        >
          {activeTab === "watchlist" ? (
            <IconBookmarkFilled size={22} />
          ) : (
            <IconBookmark size={22} />
          )}
          <span className="text-[8px]" style={MONO}>
            Watch
          </span>
          {watchlist.length > 0 && (
            <span
              className="absolute top-1.5 right-[calc(50%-18px)] min-w-[14px] h-[14px] px-0.5 flex items-center justify-center rounded-full text-[8px] font-bold text-white"
              style={{ background: "#ea580c" }}
            >
              {watchlist.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("ohlc")}
          className="relative flex flex-col items-center justify-center flex-1 h-full gap-0.5 cursor-pointer border-0 bg-transparent"
          style={{ color: activeTab === "ohlc" ? "#ea580c" : "#94a3b8" }}
        >
          <IconChartLine size={22} />
          <span className="text-[8px]" style={MONO}>
            OHLC
          </span>
        </button>
        <button
          onClick={() => setActiveTab("results")}
          className="flex flex-col items-center justify-center flex-1 h-full gap-0.5 cursor-pointer border-0 bg-transparent"
          style={{ color: activeTab === "results" ? "#ea580c" : "#94a3b8" }}
        >
          <IconFileAnalytics size={22} />
          <span className="text-[8px]" style={MONO}>
            Results
          </span>
        </button>
      </nav>

      {/* ── Mobile drawer (left-to-right, 75% width) ── */}
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 md:hidden transition-opacity duration-300"
        style={{
          background: "rgba(0,0,0,0.45)",
          opacity: drawerOpen ? 1 : 0,
          pointerEvents: drawerOpen ? "auto" : "none",
        }}
        onClick={() => setDrawerOpen(false)}
      />
      {/* Panel */}
      <div
        className="fixed inset-y-0 left-0 z-[100] flex flex-col md:hidden shadow-2xl transition-transform duration-300 ease-out"
        style={{
          width: "75vw",
          maxWidth: "320px",
          background: isDark ? "#0f172a" : "#fff",
          borderRight: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`,
          transform: drawerOpen ? "translateX(0)" : "translateX(-100%)",
        }}
      >
        {/* User details + close button — merged into one row */}
        <div
          className="px-4 py-4 border-b flex-shrink-0"
          style={{ borderColor: isDark ? "#1e293b" : "#f1f5f9" }}
        >
          <div className="flex items-start gap-3">
            <ProfileAvatar size={44} />
            <div className="min-w-0 flex-1">
              <div
                className="text-[13px] font-bold truncate"
                style={{ ...MONO, color: isDark ? "#e2e8f0" : "#1e293b" }}
              >
                {kiteProfile?.user_name || liveUser || "Demo Mode"}
              </div>
              {kiteProfile?.user_id && (
                <div
                  className="text-[10px] mt-0.5"
                  style={{ ...MONO, color: isDark ? "#64748b" : "#94a3b8" }}
                >
                  {kiteProfile.user_id}
                </div>
              )}
              {kiteProfile?.email && (
                <div
                  className="text-[9px] mt-0.5 truncate"
                  style={{ ...MONO, color: isDark ? "#475569" : "#94a3b8" }}
                >
                  {kiteProfile.email}
                </div>
              )}
              <div className="flex items-center gap-1.5 mt-1.5">
                <span
                  className="text-[7px] font-black px-1.5 py-0.5 rounded"
                  style={{ background: "#387ed115", color: "#387ed1", ...MONO }}
                >
                  {isDemoMode ? "DEMO" : kiteProfile?.broker || "ZERODHA"}
                </span>
                <span
                  className="text-[9px]"
                  style={{ ...MONO, color: isDark ? "#64748b" : "#94a3b8" }}
                >
                  {isDemoMode ? "Paper Trading" : "Connected"}
                </span>
              </div>
            </div>
            {/* Close button — top right */}
            <button
              onClick={() => setDrawerOpen(false)}
              className="w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer flex-shrink-0"
              style={{
                background: isDark ? "#1e293b" : "#f1f5f9",
                color: isDark ? "#94a3b8" : "#64748b",
              }}
            >
              <IconX size={15} />
            </button>
          </div>
        </div>

        {/* Expiry — only when on chain tab */}
        {activeTab === "chain" && (
          <div
            className="px-4 py-3 border-b flex-shrink-0"
            style={{ borderColor: isDark ? "#1e293b" : "#f1f5f9" }}
          >
            <div
              className="text-[9px] font-bold tracking-[1.5px] uppercase mb-2"
              style={{ ...MONO, color: isDark ? "#64748b" : "#94a3b8" }}
            >
              Option Expiry
            </div>
            <Select
              value={expiry}
              onValueChange={(v) => {
                setExpiry(v);
                setDrawerOpen(false);
              }}
            >
              <SelectTrigger
                className="w-full h-9 px-3 text-[11px] rounded-xl border"
                style={{
                  ...MONO,
                  background: isDark ? "#1e293b" : "#f8fafc",
                  borderColor: isDark ? "#334155" : "#e2e8f0",
                  color: isDark ? "#e2e8f0" : "#1e293b",
                }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {expiries.map((e) => (
                  <SelectItem key={e} value={e} style={MONO}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Copy Token */}
        {!isDemoMode && liveUser && (
          <div
            className="px-4 py-3 border-b flex-shrink-0 flex items-center justify-between"
            style={{ borderColor: isDark ? "#1e293b" : "#f1f5f9" }}
          >
            <div className="flex flex-col gap-0.5">
              <span
                className="text-[11px] font-medium"
                style={{ color: isDark ? "#94a3b8" : "#475569" }}
              >
                Copy Access Token
              </span>
              <span
                className="text-[9px]"
                style={{ ...MONO, color: isDark ? "#475569" : "#94a3b8" }}
              >
                {tokenCopied ? "Copied to clipboard!" : "For manual use"}
              </span>
            </div>
            <button
              onClick={handleCopyToken}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl cursor-pointer transition-all"
              style={{
                background: tokenCopied
                  ? "#16a34a15"
                  : isDark
                    ? "#1e293b"
                    : "#f1f5f9",
                color: tokenCopied ? "#16a34a" : isDark ? "#94a3b8" : "#64748b",
                border: `1px solid ${tokenCopied ? "#16a34a30" : isDark ? "#334155" : "#e2e8f0"}`,
              }}
            >
              {tokenCopied ? (
                <IconCopyCheck size={15} />
              ) : (
                <IconCopy size={15} />
              )}
              <span className="text-[10px] font-bold" style={MONO}>
                {tokenCopied ? "Copied" : "Copy"}
              </span>
            </button>
          </div>
        )}

        {/* Theme */}
        <div
          className="px-4 py-3 border-b flex-shrink-0 flex items-center justify-between"
          style={{ borderColor: isDark ? "#1e293b" : "#f1f5f9" }}
        >
          <span
            className="text-[11px] font-medium"
            style={{ color: isDark ? "#94a3b8" : "#475569" }}
          >
            Theme
          </span>
          <ThemeToggle />
        </div>

        {/* Market Holidays 2026 — Accordion */}
        <div
          className="flex-shrink-0 border-b"
          style={{ borderColor: isDark ? "#1e293b" : "#f1f5f9" }}
        >
          {/* Accordion header — tap to toggle */}
          <button
            onClick={() => setHolidaysOpen((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between cursor-pointer"
            style={{ background: "transparent" }}
          >
            <div className="flex items-center gap-2">
              <span
                className="text-[9px] font-bold tracking-[1.5px] uppercase"
                style={{ ...MONO, color: isDark ? "#64748b" : "#94a3b8" }}
              >
                NSE Holidays 2026
              </span>
              <span
                className="text-[8px] px-1.5 py-0.5 rounded-sm"
                style={{ ...MONO, background: "#ea580c15", color: "#ea580c" }}
              >
                {
                  MARKET_HOLIDAYS_2026.filter(
                    (h) => h.date >= new Date().toISOString().split("T")[0],
                  ).length
                }{" "}
                upcoming
              </span>
            </div>
            <span
              className="text-[10px] transition-transform duration-200 flex-shrink-0"
              style={{
                color: isDark ? "#64748b" : "#94a3b8",
                transform: holidaysOpen ? "rotate(180deg)" : "rotate(0deg)",
              }}
            >
              ▼
            </span>
          </button>
          {/* Accordion body */}
          {holidaysOpen && (
            <div
              className="overflow-y-auto px-3 pb-3"
              style={{ maxHeight: "240px", scrollbarWidth: "none" }}
            >
              {MARKET_HOLIDAYS_2026.map((h) => {
                const today = new Date().toISOString().split("T")[0];
                const isPast = h.date < today;
                const day = holidayDayName(h.date);
                const [, mm, dd] = h.date.split("-");
                return (
                  <div
                    key={h.date}
                    className="flex items-center gap-2 py-1.5 border-b last:border-0"
                    style={{
                      borderColor: isDark ? "#1e293b" : "#f8fafc",
                      opacity: isPast ? 0.35 : 1,
                    }}
                  >
                    <div className="w-8 text-center flex-shrink-0">
                      <div
                        className="text-[11px] font-black leading-none"
                        style={{
                          ...MONO,
                          color: isPast ? "#94a3b8" : "#ea580c",
                        }}
                      >
                        {dd}
                      </div>
                      <div
                        className="text-[7px] leading-none mt-0.5"
                        style={{ ...MONO, color: "#94a3b8" }}
                      >
                        {
                          [
                            "",
                            "JAN",
                            "FEB",
                            "MAR",
                            "APR",
                            "MAY",
                            "JUN",
                            "JUL",
                            "AUG",
                            "SEP",
                            "OCT",
                            "NOV",
                            "DEC",
                          ][+mm]
                        }
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-[10px] font-medium truncate"
                        style={{ color: isDark ? "#e2e8f0" : "#1e293b" }}
                      >
                        {h.name}
                      </div>
                      <div
                        className="text-[8px]"
                        style={{ ...MONO, color: "#94a3b8" }}
                      >
                        {day}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Logout */}
        {!isDemoMode && authenticated && (
          <div
            className="px-4 py-4 border-t flex-shrink-0"
            style={{ borderColor: isDark ? "#1e293b" : "#f1f5f9" }}
          >
            <button
              onClick={() => {
                setDrawerOpen(false);
                handleLogout();
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[11px] font-bold tracking-[0.5px] cursor-pointer"
              style={{
                ...MONO,
                color: "#e11d48",
                border: "1px solid #e11d4830",
                background: "#e11d4808",
              }}
            >
              <IconPower size={14} />
              Logout
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page export ──────────────────────────────────────────────────────────────
export default function OptionsPage() {
  return (
    <Suspense>
      <OptionsPageInner />
    </Suspense>
  );
}

// ─── STAT BADGE ──────────────────────────────────────────────────────────────
function StatBadge({
  label,
  val,
  color,
  big,
}: {
  label: string;
  val: string;
  color: string;
  big?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[9px] tracking-[2px] text-[#64748b]" style={MONO}>
        {label}
      </span>
      <span
        className={`font-bold ${big ? "text-[20px]" : "text-[14px]"}`}
        style={{ ...MONO, color }}
      >
        {val}
      </span>
    </div>
  );
}

// ─── TV SYMBOL HELPER ─────────────────────────────────────────────────────────
// TradingView NSE option symbol: NSE:NIFTY + YY + DD + MON + STRIKE + TYPE
// e.g. expiry 2026-03-24, strike 23100 CE → NSE:NIFTY2624MAR23100CE
function tvSymbol(expiry: string, strike: number, type: "CE" | "PE") {
  const exp = new Date(expiry);
  const MONTHS = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  const yy = String(exp.getUTCFullYear()).slice(-2);
  const dd = String(exp.getUTCDate()).padStart(2, "0");
  const mon = MONTHS[exp.getUTCMonth()];
  return `NSE:NIFTY${yy}${dd}${mon}${strike}${type}`;
}

function tvSymbolSensex(expiry: string, strike: number, type: "CE" | "PE") {
  const exp = new Date(expiry);
  const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const yy  = String(exp.getUTCFullYear()).slice(-2);
  const dd  = String(exp.getUTCDate()).padStart(2, "0");
  const mon = MONTHS[exp.getUTCMonth()];
  return `BSE:SENSEX${yy}${dd}${mon}${strike}${type}`;
}

// Sensibull format: NIFTY + YY + M (no leading zero) + DD + STRIKE + TYPE
// e.g. expiry=2026-03-24, strike=23100, type=PE → NIFTY2632423100PE
function sensibullSym(expiry: string, strike: number, type: "CE" | "PE") {
  const exp = new Date(expiry);
  const yy = String(exp.getUTCFullYear()).slice(-2);
  const m = String(exp.getUTCMonth() + 1); // 3 for March (no padding)
  const dd = String(exp.getUTCDate()).padStart(2, "0");
  return `NIFTY${yy}${m}${dd}${strike}${type}`;
}

function CandleIcon({ color }: { color: string }) {
  return <IconChartCandle size={14} color={color} />;
}

// ─── CHAIN ROW ────────────────────────────────────────────────────────────────
function ChainRow({
  row,
  atmStrike,
  onAddWatch,
  addedTokens,
  expiry,
  scalperOn,
  strategyOn,
  onOrder,
  onOpenChart,
}: {
  row: OptionsRow;
  atmStrike: number;
  onAddWatch: (l: OptionLeg) => void;
  addedTokens: Set<number>;
  expiry: string;
  scalperOn: boolean;
  strategyOn: boolean;
  onOrder: (leg: OptionLeg, action: "BUY" | "SELL") => void;
  onOpenChart: (
    token: number,
    strike: number,
    type: "CE" | "PE",
    sym: string,
    tradingsymbol?: string,
  ) => void;
}) {
  const { ce, pe, strike, isATM } = row;
  const rowBg = isATM ? "bg-[#eff6ff]" : "bg-white hover:bg-[#f8fafc]";
  const ceAdded = addedTokens.has(ce.token);
  const peAdded = addedTokens.has(pe.token);

  // Per-row PCR (Put OI / Call OI)
  const rowPCR = ce.oi > 0 ? +(pe.oi / ce.oi).toFixed(2) : 0;
  // % change from prevLtp
  const cePct = ce.prevLtp > 0 ? (ce.ltpChange / ce.prevLtp) * 100 : 0;
  const pePct = pe.prevLtp > 0 ? (pe.ltpChange / pe.prevLtp) * 100 : 0;

  // Small S/B button helper
  function OrderBtn({
    color,
    label,
    onClick,
  }: {
    color: string;
    label: string;
    onClick: () => void;
  }) {
    return (
      <button
        onClick={onClick}
        className="flex-shrink-0 w-[22px] h-[22px] flex items-center justify-center rounded font-black text-[9px] cursor-pointer transition-all active:scale-90"
        style={{
          ...MONO,
          background: `${color}22`,
          color,
          border: `1px solid ${color}55`,
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <>
      {/* ── MOBILE CARD (hidden md+) ── */}
      <div
        className={`md:hidden border-b ${isATM ? "bg-[#f0f7ff] border-b-[#bfdbfe]" : "border-b-[#f1f5f9]"}`}
      >
        <div className="grid grid-cols-[1fr_72px_1fr]">
          {/* CE side */}
          <div
            className={`px-1.5 py-2 flex flex-col gap-1 ${isATM ? "bg-[#e8f4ff]" : "bg-[#f8fbff]"}`}
          >
            {scalperOn ? (
              /* Scalper mode: tappable price block */
              <button onClick={() => onOrder(ce, "BUY")} className="flex flex-col items-end w-full">
                <span className="text-[13px] font-bold tabular-nums" style={MONO}>₹{ce.ltp.toFixed(2)}</span>
                <span className={`text-[9px] font-bold ${cePct >= 0 ? "text-[#16a34a]" : "text-[#e11d48]"}`} style={MONO}>
                  {cePct >= 0 ? "+" : ""}{cePct.toFixed(2)}%
                </span>
              </button>
            ) : strategyOn ? (
              /* Strategy mode: S B buttons + price */
              <div className="flex items-center gap-1">
                <div className="flex flex-col gap-0.5">
                  <OrderBtn color="#e11d48" label="S" onClick={() => onOrder(ce, "SELL")} />
                  <OrderBtn color="#16a34a" label="B" onClick={() => onOrder(ce, "BUY")} />
                </div>
                <div className="flex flex-col items-end flex-1 min-w-0">
                  <span className="text-[13px] font-bold tabular-nums leading-none" style={MONO}>₹{ce.ltp.toFixed(2)}</span>
                  <span className={`text-[9px] font-bold mt-0.5 ${cePct >= 0 ? "text-[#16a34a]" : "text-[#e11d48]"}`} style={MONO}>
                    {cePct >= 0 ? "+" : ""}{cePct.toFixed(2)}%
                  </span>
                </div>
              </div>
            ) : (
              /* Both OFF: Sensibull-style card — bookmark top-left, price, symbol, OI, chart bottom-right */
              <div className="flex flex-col w-full gap-0.5">
                <div className="flex items-start justify-between">
                  <button onClick={() => onAddWatch(ce)}
                    className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: addedTokens.has(ce.token) ? "#fbbf2420" : "transparent", color: addedTokens.has(ce.token) ? "#f59e0b" : "#94a3b8" }}>
                    {addedTokens.has(ce.token) ? <IconBookmarkFilled size={11} /> : <IconBookmark size={11} />}
                  </button>
                  <div className="flex flex-col items-end flex-1 ml-0.5">
                    <span className="text-[13px] font-bold tabular-nums leading-tight" style={MONO}>
                      {ce.ltp.toFixed(2)}
                    </span>
                    <span className="text-[8px] font-bold" style={{ ...MONO, color: "#0284c7" }}>
                      {strike} CE
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[8px]" style={{ ...MONO, color: "#94a3b8" }}>{fmtOI(ce.oi)}</span>
                  <button onClick={() => onOpenChart(ce.token, strike, "CE", "", ce.tradingsymbol)}
                    className="w-5 h-5 rounded flex items-center justify-center"
                    style={{ background: "#e8f4ff", color: "#0284c7" }}>
                    <IconChartLine size={10} />
                  </button>
                </div>
              </div>
            )}
            {/* OI bar */}
            <div
              className="h-[3px] rounded-full overflow-hidden"
              style={{ background: "rgba(2,132,199,0.12)" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${row.ceOIBar}%`,
                  background: "rgba(2,132,199,0.55)",
                }}
              />
            </div>
          </div>

          {/* Strike center */}
          <div
            className={`flex flex-col items-center justify-center border-x border-[#e2e8f0] py-2 gap-0.5 ${isATM ? "bg-[#dbeafe]" : "bg-[#f8fafc]"}`}
          >
            <span
              className={`text-[12px] font-bold tabular-nums leading-none ${isATM ? "text-[#0284c7]" : "text-[#1e293b]"}`}
              style={MONO}
            >
              {strike}
            </span>
            <span
              className={`text-[8px] font-bold tabular-nums ${rowPCR >= 1 ? "text-[#16a34a]" : "text-[#e11d48]"}`}
              style={MONO}
            >
              PCR {rowPCR.toFixed(2)}
            </span>
          </div>

          {/* PE side */}
          <div
            className={`px-1.5 py-2 flex flex-col gap-1 ${isATM ? "bg-[#fff0ef]" : "bg-[#fff8fa]"}`}
          >
            {scalperOn ? (
              /* Scalper mode: tappable price block */
              <button onClick={() => onOrder(pe, "BUY")} className="flex flex-col items-start w-full">
                <span className="text-[13px] font-bold tabular-nums" style={MONO}>₹{pe.ltp.toFixed(2)}</span>
                <span className={`text-[9px] font-bold ${pePct >= 0 ? "text-[#16a34a]" : "text-[#e11d48]"}`} style={MONO}>
                  {pePct >= 0 ? "+" : ""}{pePct.toFixed(2)}%
                </span>
              </button>
            ) : strategyOn ? (
              /* Strategy mode: price + B S buttons */
              <div className="flex items-center gap-1">
                <div className="flex flex-col items-start flex-1 min-w-0">
                  <span className="text-[13px] font-bold tabular-nums leading-none" style={MONO}>₹{pe.ltp.toFixed(2)}</span>
                  <span className={`text-[9px] font-bold mt-0.5 ${pePct >= 0 ? "text-[#16a34a]" : "text-[#e11d48]"}`} style={MONO}>
                    {pePct >= 0 ? "+" : ""}{pePct.toFixed(2)}%
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <OrderBtn color="#16a34a" label="B" onClick={() => onOrder(pe, "BUY")} />
                  <OrderBtn color="#e11d48" label="S" onClick={() => onOrder(pe, "SELL")} />
                </div>
              </div>
            ) : (
              /* Both OFF: Sensibull-style card — price, symbol, OI, bookmark top-right, chart bottom-left */
              <div className="flex flex-col w-full gap-0.5">
                <div className="flex items-start justify-between">
                  <div className="flex flex-col items-start flex-1 mr-0.5">
                    <span className="text-[13px] font-bold tabular-nums leading-tight" style={MONO}>
                      {pe.ltp.toFixed(2)}
                    </span>
                    <span className="text-[8px] font-bold" style={{ ...MONO, color: "#e11d48" }}>
                      {strike} PE
                    </span>
                  </div>
                  <button onClick={() => onAddWatch(pe)}
                    className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: addedTokens.has(pe.token) ? "#fbbf2420" : "transparent", color: addedTokens.has(pe.token) ? "#f59e0b" : "#94a3b8" }}>
                    {addedTokens.has(pe.token) ? <IconBookmarkFilled size={11} /> : <IconBookmark size={11} />}
                  </button>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <button onClick={() => onOpenChart(pe.token, strike, "PE", "", pe.tradingsymbol)}
                    className="w-5 h-5 rounded flex items-center justify-center"
                    style={{ background: "#fff0f3", color: "#e11d48" }}>
                    <IconChartLine size={10} />
                  </button>
                  <span className="text-[8px]" style={{ ...MONO, color: "#94a3b8" }}>{fmtOI(pe.oi)}</span>
                </div>
              </div>
            )}
            {/* OI bar */}
            <div
              className="h-[3px] rounded-full overflow-hidden"
              style={{ background: "rgba(225,29,72,0.12)" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${row.peOIBar}%`,
                  background: "rgba(225,29,72,0.55)",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── DESKTOP TABLE ROW (hidden on mobile) ── */}
      <div className="hidden md:block">
        <div
          className={`chain-grid border-b border-[#f1f5f9] transition-colors ${rowBg}`}
        >
          {/* + CE */}
          <div className="flex items-center justify-center bg-[#f8fbff]">
            <button
              onClick={() => onAddWatch(ce)}
              title={
                ceAdded
                  ? `Remove CE ${strike}`
                  : `Add CE ${strike} to watchlist`
              }
              className={`w-6 h-6 rounded flex items-center justify-center border cursor-pointer transition-all
              ${ceAdded ? "bg-[#fbbf24]/15 border-[#fbbf24]/60 text-[#fbbf24]" : "bg-[#0284c7]/10 text-[#0284c7] border-[#0284c7]/30 hover:bg-[#0284c7]/20"}`}
            >
              {ceAdded ? (
                <IconBookmarkFilled size={11} />
              ) : (
                <IconBookmark size={11} />
              )}
            </button>
          </div>

          {/* CE OI */}
          <div className="chain-col-oi px-3 py-2 text-right relative overflow-hidden bg-[#f8fbff]">
            <div
              className="absolute right-0 top-0 bottom-0"
              style={{
                width: `${row.ceOIBar}%`,
                background: "rgba(2,132,199,0.10)",
              }}
            />
            <span
              className="text-[11px] tabular-nums relative z-10 text-[#475569]"
              style={MONO}
            >
              {fmtOI(ce.oi)}
            </span>
          </div>

          {/* CE LTP + chart icon */}
          <div className="px-2 py-2 text-right border-r border-[#e2e8f0] group">
            {scalperOn ? (
              <button onClick={() => onOrder(ce, "BUY")} className="flex flex-col items-end w-full">
                <span className={`text-[13px] font-bold tabular-nums leading-tight ${ce.ltp >= 200 && ce.ltp <= 300 ? "text-[#16a34a]" : "text-[#1e293b]"}`} style={MONO}>₹{ce.ltp.toFixed(2)}</span>
                <span className={`text-[9px] font-bold ${cePct >= 0 ? "text-[#16a34a]" : "text-[#e11d48]"}`} style={MONO}>{cePct >= 0 ? "+" : ""}{cePct.toFixed(2)}%</span>
              </button>
            ) : strategyOn ? (
              <div className="flex items-center justify-end gap-1.5">
                <div>
                  <div className={`text-[13px] font-bold tabular-nums leading-tight ${ce.ltp >= 200 && ce.ltp <= 300 ? "text-[#16a34a]" : "text-[#1e293b]"}`} style={MONO}>₹{ce.ltp.toFixed(2)}</div>
                  <div className={`text-[8px] ${cePct >= 0 ? "text-[#16a34a]" : "text-[#e11d48]"}`} style={MONO}>{cePct >= 0 ? "+" : ""}{cePct.toFixed(2)}%</div>
                </div>
                <div className="flex flex-col gap-0.5">
                  <OrderBtn color="#e11d48" label="S" onClick={() => onOrder(ce, "SELL")} />
                  <OrderBtn color="#16a34a" label="B" onClick={() => onOrder(ce, "BUY")} />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-end gap-1.5">
                <button
                  onClick={() => onOpenChart(ce.token, strike, "CE", tvSymbol(expiry, strike, "CE"), ce.tradingsymbol)}
                  title={`Chart ${strike} CE`}
                  className="opacity-30 group-hover:opacity-100 transition-opacity flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-[#0284c7]/15 text-[#0284c7] cursor-pointer"
                >
                  <CandleIcon color="#0284c7" />
                </button>
                <div>
                  <div className={`text-[13px] font-bold tabular-nums leading-tight ${ce.ltp >= 200 && ce.ltp <= 300 ? "text-[#16a34a]" : "text-[#1e293b]"}`} style={MONO}>₹{ce.ltp.toFixed(2)}</div>
                  <div className={`text-[8px] ${ce.ltpChange >= 0 ? "text-[#16a34a]" : "text-[#e11d48]"}`} style={MONO}>{ce.ltpChange >= 0 ? "▲" : "▼"}{Math.abs(ce.ltpChange).toFixed(2)}</div>
                </div>
              </div>
            )}
          </div>

          {/* STRIKE */}
          <div
            className={`py-2 text-center border-x border-[#e2e8f0] flex flex-col items-center justify-center
          ${isATM ? "bg-[#dbeafe]" : "bg-[#f8fafc]"}`}
          >
            <div
              className={`text-[12px] font-bold tabular-nums leading-none
            ${isATM ? "text-[#0284c7]" : "text-[#1e293b]"}`}
              style={MONO}
            >
              {strike}
            </div>
            {isATM && (
              <div
                className="text-[6px] text-[#0284c7]/60 tracking-[1px] mt-0.5 font-bold"
                style={MONO}
              >
                ATM
              </div>
            )}
          </div>

          {/* PE LTP + chart icon */}
          <div className="px-2 py-2 text-left border-l border-[#e2e8f0] group">
            {scalperOn ? (
              <button onClick={() => onOrder(pe, "BUY")} className="flex flex-col items-start w-full">
                <span className={`text-[13px] font-bold tabular-nums leading-tight ${pe.ltp >= 200 && pe.ltp <= 300 ? "text-[#16a34a]" : "text-[#1e293b]"}`} style={MONO}>₹{pe.ltp.toFixed(2)}</span>
                <span className={`text-[9px] font-bold ${pePct >= 0 ? "text-[#16a34a]" : "text-[#e11d48]"}`} style={MONO}>{pePct >= 0 ? "+" : ""}{pePct.toFixed(2)}%</span>
              </button>
            ) : strategyOn ? (
              <div className="flex items-center gap-1.5">
                <div className="flex flex-col gap-0.5">
                  <OrderBtn color="#16a34a" label="B" onClick={() => onOrder(pe, "BUY")} />
                  <OrderBtn color="#e11d48" label="S" onClick={() => onOrder(pe, "SELL")} />
                </div>
                <div>
                  <div className={`text-[13px] font-bold tabular-nums leading-tight ${pe.ltp >= 200 && pe.ltp <= 300 ? "text-[#16a34a]" : "text-[#1e293b]"}`} style={MONO}>₹{pe.ltp.toFixed(2)}</div>
                  <div className={`text-[8px] ${pePct >= 0 ? "text-[#16a34a]" : "text-[#e11d48]"}`} style={MONO}>{pePct >= 0 ? "+" : ""}{pePct.toFixed(2)}%</div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <div>
                  <div className={`text-[13px] font-bold tabular-nums leading-tight ${pe.ltp >= 200 && pe.ltp <= 300 ? "text-[#16a34a]" : "text-[#1e293b]"}`} style={MONO}>₹{pe.ltp.toFixed(2)}</div>
                  <div className={`text-[8px] ${pe.ltpChange >= 0 ? "text-[#16a34a]" : "text-[#e11d48]"}`} style={MONO}>{pe.ltpChange >= 0 ? "▲" : "▼"}{Math.abs(pe.ltpChange).toFixed(2)}</div>
                </div>
                <button
                  onClick={() => onOpenChart(pe.token, strike, "PE", tvSymbol(expiry, strike, "PE"), pe.tradingsymbol)}
                  title={`Chart ${strike} PE`}
                  className="opacity-30 group-hover:opacity-100 transition-opacity flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-[#e11d48]/15 text-[#e11d48] cursor-pointer"
                >
                  <CandleIcon color="#e11d48" />
                </button>
              </div>
            )}
          </div>

          {/* PE OI */}
          <div className="chain-col-oi px-3 py-2 text-left relative overflow-hidden bg-[#fff8fa]">
            <div
              className="absolute left-0 top-0 bottom-0"
              style={{
                width: `${row.peOIBar}%`,
                background: "rgba(225,29,72,0.08)",
              }}
            />
            <span
              className="text-[11px] tabular-nums relative z-10 text-[#475569]"
              style={MONO}
            >
              {fmtOI(pe.oi)}
            </span>
          </div>

          {/* + PE */}
          <div className="flex items-center justify-center bg-[#fff8fa]">
            <button
              onClick={() => onAddWatch(pe)}
              title={
                peAdded
                  ? `Remove PE ${strike}`
                  : `Add PE ${strike} to watchlist`
              }
              className={`w-6 h-6 rounded flex items-center justify-center border cursor-pointer transition-all
              ${peAdded ? "bg-[#fbbf24]/15 border-[#fbbf24]/60 text-[#fbbf24]" : "bg-[#e11d48]/10 text-[#e11d48] border-[#e11d48]/30 hover:bg-[#e11d48]/20"}`}
            >
              {peAdded ? (
                <IconBookmarkFilled size={11} />
              ) : (
                <IconBookmark size={11} />
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── SENSIBULL IFRAME PANEL ───────────────────────────────────────────────────
function SensibullPanel({ sym }: { sym: string }) {
  const url = `https://web.sensibull.com/chart?tradingSymbol=${sym}`;
  return (
    <div className="absolute inset-0 flex flex-col bg-white">
      <iframe
        key={sym}
        src={url}
        className="flex-1 border-0 w-full"
        title={`${sym} Sensibull chart`}
        allow="fullscreen"
        referrerPolicy="no-referrer"
        onError={() => {
          /* silently handle */
        }}
      />
      {/* Fallback bar — visible below if iframe is blocked */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-[#f8fafc] border-t border-[#e2e8f0]">
        <span className="text-[9px] text-[#94a3b8]" style={MONO}>
          If chart is blank, Sensibull may block iframe embedding.
        </span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[9px] px-3 py-1 bg-[#0284c7] text-white rounded-sm font-bold hover:bg-[#0369a1] transition-colors cursor-pointer"
          style={MONO}
        >
          ↗ Open in new tab
        </a>
      </div>
    </div>
  );
}

// ─── LONG / SHORT POSITION PRIMITIVE ─────────────────────────────────────────
class PositionPrimitive {
  private _chart: any = null;
  private _series: any = null;
  private _isLong: boolean;
  private _entry: { time: number; price: number };
  private _diff: number; // abs price distance (entry → target = entry → stop)
  private _views: any[];

  constructor(
    isLong: boolean,
    entry: { time: number; price: number },
    second: { time: number; price: number },
  ) {
    this._isLong = isLong;
    this._entry = entry;
    this._diff = Math.abs(second.price - entry.price) || entry.price * 0.005;
    const self = this;
    this._views = [
      {
        zOrder: () => "bottom" as const,
        renderer: () => ({
          draw(target: any) {
            if (!self._chart || !self._series) return;
            target.useMediaCoordinateSpace((scope: any) => {
              const ctx = scope.context;
              const W = scope.mediaSize.width;
              const xE = self._chart
                .timeScale()
                .timeToCoordinate(self._entry.time as any);
              if (xE == null) return;

              const E = self._entry.price;
              const diff = self._diff;
              const tp = self._isLong ? E + diff : E - diff;
              const sl = self._isLong ? E - diff : E + diff;
              const yE = self._series.priceToCoordinate(E);
              const yTP = self._series.priceToCoordinate(tp);
              const ySL = self._series.priceToCoordinate(sl);
              if (yE == null || yTP == null || ySL == null) return;

              const x1 = Math.max(0, xE);
              const pct = ((diff / E) * 100).toFixed(2);

              ctx.save();
              // Profit zone (green)
              ctx.fillStyle = "rgba(22,163,74,0.18)";
              ctx.fillRect(x1, Math.min(yE, yTP), W - x1, Math.abs(yTP - yE));
              // Loss zone (red)
              ctx.fillStyle = "rgba(220,38,38,0.18)";
              ctx.fillRect(x1, Math.min(yE, ySL), W - x1, Math.abs(ySL - yE));

              // TP line
              ctx.strokeStyle = "#16a34a";
              ctx.lineWidth = 1.5;
              ctx.setLineDash([4, 2]);
              ctx.beginPath();
              ctx.moveTo(x1, yTP);
              ctx.lineTo(W, yTP);
              ctx.stroke();
              // Entry line
              ctx.strokeStyle = "#64748b";
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(x1, yE);
              ctx.lineTo(W, yE);
              ctx.stroke();
              // SL line
              ctx.strokeStyle = "#dc2626";
              ctx.beginPath();
              ctx.moveTo(x1, ySL);
              ctx.lineTo(W, ySL);
              ctx.stroke();
              ctx.setLineDash([]);

              // Labels (right side)
              const lx = x1 + 8;
              ctx.font = "bold 9px 'Space Mono', monospace";
              ctx.fillStyle = "#16a34a";
              ctx.fillText(
                `TP  ${tp.toFixed(2)}  (+${pct}%)`,
                lx,
                yTP < yE ? yTP - 4 : yTP + 11,
              );
              ctx.fillStyle = "#1e293b";
              ctx.fillText(`Entry  ${E.toFixed(2)}`, lx, yE - 4);
              ctx.fillStyle = "#dc2626";
              ctx.fillText(
                `SL  ${sl.toFixed(2)}  (-${pct}%)`,
                lx,
                ySL > yE ? ySL + 11 : ySL - 4,
              );

              // Entry dot
              ctx.fillStyle = self._isLong ? "#16a34a" : "#dc2626";
              ctx.beginPath();
              ctx.arc(xE, yE, 4, 0, Math.PI * 2);
              ctx.fill();
              ctx.strokeStyle = "#fff";
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.arc(xE, yE, 4, 0, Math.PI * 2);
              ctx.stroke();
              ctx.restore();
            });
          },
        }),
      },
    ];
  }
  attached(params: any) {
    this._chart = params.chart;
    this._series = params.series;
  }
  detached() {
    this._chart = null;
    this._series = null;
  }
  updateAllViews() {}
  paneViews() {
    return this._views;
  }
}

// ─── KITE CHART PANEL ─────────────────────────────────────────────────────────
const IV_LIST = [
  { label: "1m", iv: "minute", days: 3 },
  { label: "5m", iv: "5minute", days: 7 },
  { label: "15m", iv: "15minute", days: 14 },
  { label: "1H", iv: "60minute", days: 30 },
  { label: "D", iv: "day", days: 60 },
] as const;
type IvKey = (typeof IV_LIST)[number]["iv"];
type IndKey = "EMA9" | "EMA21" | "BB" | "VOL" | "RSI" | "MACD";
type CandleRow = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
  rsi14: number | null;
  ema9: number | null;
  ema21: number | null;
  bbMid: number | null;
  bbUp: number | null;
  bbDn: number | null;
  macd: number | null;
  macdSig: number | null;
  macdHist: number | null;
};

function istToUnix(s: string): number {
  // Backend returns "DD-MM-YYYY HH:mm" in IST.
  // Pass as UTC so lightweight-charts (which shows UTC) displays the correct IST time.
  const [dp, tp] = s.split(" ");
  const [dd, mm, yyyy] = dp.split("-");
  const [hh, mi] = (tp ?? "00:00").split(":");
  return Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi) / 1000;
}

const IND_COLORS: Record<IndKey, string> = {
  EMA9: "#f97316",
  EMA21: "#3b82f6",
  BB: "#a855f7",
  VOL: "#64748b",
  RSI: "#a855f7",
  MACD: "#3b82f6",
};
const DEFAULT_IND = new Set<IndKey>(["EMA9", "VOL"]);

type DrawMode = "cursor" | "hline" | "long" | "short";

function KiteChartPanel({
  target,
}: {
  target: {
    token: number;
    strike: number;
    type: "CE" | "PE";
    expiry: string;
    sym: string;
  };
}) {
  const chartDiv = useRef<HTMLDivElement>(null);
  const chartApi = useRef<ReturnType<typeof createChart> | null>(null);
  const sm = useRef<Record<string, any>>({});
  const indRef = useRef(new Set<IndKey>(DEFAULT_IND));
  // Drawing state
  const drawModeRef = useRef<DrawMode>("cursor");
  const hlinesData = useRef<number[]>([]);
  const trendData = useRef<
    Array<{
      isLong: boolean;
      entry: { time: number; price: number };
      second: { time: number; price: number };
    }>
  >([]);
  const hlinesRef = useRef<Array<{ price: number; pl: any }>>([]);
  const trendRef = useRef<Array<{ prim: PositionPrimitive }>>([]);
  const trendStepRef = useRef(0);
  const trendP1Ref = useRef<{ time: number; price: number } | null>(null);

  const [tf, setTf] = useState<IvKey>("minute");
  const [indicators, setIndicators] = useState<Set<IndKey>>(
    new Set(DEFAULT_IND),
  );
  const [rows, setRows] = useState<CandleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ohlc, setOhlc] = useState<{
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
  } | null>(null);
  const [drawMode, setDrawMode] = useState<DrawMode>("cursor");
  const [trendStep, setTrendStep] = useState(0);
  const [drawnCount, setDrawnCount] = useState(0);

  // ── Fetch candles ──────────────────────────────────────────────────────────
  useEffect(() => {
    const conf = IV_LIST.find((x) => x.iv === tf)!;
    const today = new Date();
    const to = today.toISOString().split("T")[0];
    const fromD = new Date(today);
    fromD.setDate(fromD.getDate() - conf.days);
    const from = fromD.toISOString().split("T")[0];
    setLoading(true);
    setError(null);
    setRows([]);
    optionsApi
      .candleRange(target.token, from, to, tf)
      .then((d: { rows: CandleRow[] }) => setRows(d.rows ?? []))
      .catch((e: any) => setError(e.message ?? "Failed to load chart data"))
      .finally(() => setLoading(false));
  }, [target.token, tf]);

  // ── Build / rebuild chart when data changes ────────────────────────────────
  useEffect(() => {
    if (!chartDiv.current || rows.length === 0) return;
    if (chartApi.current) {
      chartApi.current.remove();
      chartApi.current = null;
    }

    const chart = createChart(chartDiv.current, {
      layout: {
        background: { color: "#ffffff" },
        textColor: "#64748b",
        fontFamily: "'Space Mono', monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "#f1f5f9" },
        horzLines: { color: "#f1f5f9" },
      },
      crosshair: { mode: 1 },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#e2e8f0",
      },
      rightPriceScale: {
        borderColor: "#e2e8f0",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      autoSize: true,
    } as any);
    chartApi.current = chart;
    const s = sm.current;
    const ind = indRef.current;

    // Pane 0: candles + overlays
    s.candle = chart.addSeries(
      CandlestickSeries,
      {
        upColor: "#16a34a",
        downColor: "#dc2626",
        borderUpColor: "#16a34a",
        borderDownColor: "#dc2626",
        wickUpColor: "#16a34a",
        wickDownColor: "#dc2626",
      } as any,
      0,
    );
    s.ema9 = chart.addSeries(
      LineSeries,
      {
        color: "#f97316",
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        visible: ind.has("EMA9"),
      } as any,
      0,
    );
    s.ema21 = chart.addSeries(
      LineSeries,
      {
        color: "#3b82f6",
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        visible: ind.has("EMA21"),
      } as any,
      0,
    );
    s.bbUp = chart.addSeries(
      LineSeries,
      {
        color: "#a855f7",
        lineWidth: 1,
        lineStyle: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        visible: ind.has("BB"),
      } as any,
      0,
    );
    s.bbMid = chart.addSeries(
      LineSeries,
      {
        color: "#a855f7",
        lineWidth: 1,
        lineStyle: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        visible: ind.has("BB"),
      } as any,
      0,
    );
    s.bbDn = chart.addSeries(
      LineSeries,
      {
        color: "#a855f7",
        lineWidth: 1,
        lineStyle: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        visible: ind.has("BB"),
      } as any,
      0,
    );

    // Pane 1: volume
    s.vol = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "volume" },
        lastValueVisible: false,
        priceLineVisible: false,
        visible: ind.has("VOL"),
      } as any,
      1,
    );

    // Pane 2: RSI
    s.rsi = chart.addSeries(
      LineSeries,
      {
        color: "#a855f7",
        lineWidth: 1.5,
        lastValueVisible: true,
        priceLineVisible: false,
        visible: ind.has("RSI"),
      } as any,
      2,
    );
    try {
      s.rsi.createPriceLine({
        price: 70,
        color: "rgba(220,38,38,0.5)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
        title: "70",
      });
      s.rsi.createPriceLine({
        price: 30,
        color: "rgba(22,163,74,0.5)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
        title: "30",
      });
    } catch {}

    // Pane 3: MACD
    s.macd = chart.addSeries(
      LineSeries,
      {
        color: "#3b82f6",
        lineWidth: 1.5,
        lastValueVisible: false,
        priceLineVisible: false,
        visible: ind.has("MACD"),
      } as any,
      3,
    );
    s.macdSig = chart.addSeries(
      LineSeries,
      {
        color: "#f97316",
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        visible: ind.has("MACD"),
      } as any,
      3,
    );
    s.macdHist = chart.addSeries(
      HistogramSeries,
      {
        lastValueVisible: false,
        priceLineVisible: false,
        visible: ind.has("MACD"),
      } as any,
      3,
    );

    // Pane heights
    try {
      const panes = (chart as any).panes?.();
      panes?.[1]?.setHeight(60);
      panes?.[2]?.setHeight(80);
      panes?.[3]?.setHeight(80);
    } catch {}

    // Set data
    const t = (r: CandleRow) => istToUnix(r.date) as any;
    s.candle.setData(
      rows.map((r) => ({
        time: t(r),
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
      })),
    );
    s.ema9.setData(
      rows
        .filter((r) => r.ema9 != null)
        .map((r) => ({ time: t(r), value: r.ema9! })),
    );
    s.ema21.setData(
      rows
        .filter((r) => r.ema21 != null)
        .map((r) => ({ time: t(r), value: r.ema21! })),
    );
    s.bbUp.setData(
      rows
        .filter((r) => r.bbUp != null)
        .map((r) => ({ time: t(r), value: r.bbUp! })),
    );
    s.bbMid.setData(
      rows
        .filter((r) => r.bbMid != null)
        .map((r) => ({ time: t(r), value: r.bbMid! })),
    );
    s.bbDn.setData(
      rows
        .filter((r) => r.bbDn != null)
        .map((r) => ({ time: t(r), value: r.bbDn! })),
    );
    s.vol.setData(
      rows.map((r) => ({
        time: t(r),
        value: r.volume,
        color:
          r.close >= r.open ? "rgba(22,163,74,0.35)" : "rgba(220,38,38,0.35)",
      })),
    );
    s.rsi.setData(
      rows
        .filter((r) => r.rsi14 != null)
        .map((r) => ({ time: t(r), value: r.rsi14! })),
    );
    s.macd.setData(
      rows
        .filter((r) => r.macd != null)
        .map((r) => ({ time: t(r), value: r.macd! })),
    );
    s.macdSig.setData(
      rows
        .filter((r) => r.macdSig != null)
        .map((r) => ({ time: t(r), value: r.macdSig! })),
    );
    s.macdHist.setData(
      rows
        .filter((r) => r.macdHist != null)
        .map((r) => ({
          time: t(r),
          value: r.macdHist!,
          color:
            (r.macdHist ?? 0) >= 0
              ? "rgba(22,163,74,0.55)"
              : "rgba(220,38,38,0.55)",
        })),
    );

    chart.timeScale().fitContent();

    // Re-apply stored drawings after rebuild
    hlinesRef.current = hlinesData.current.map((price) => ({
      price,
      pl: s.candle.createPriceLine({
        price,
        color: "#f97316",
        lineWidth: 1.5,
        lineStyle: 2,
        axisLabelVisible: true,
        title: price.toFixed(2),
      }),
    }));
    trendRef.current = trendData.current.map(({ isLong, entry, second }) => {
      const prim = new PositionPrimitive(isLong, entry, second);
      s.candle.attachPrimitive(prim);
      return { prim };
    });

    // Click → drawing handler
    chart.subscribeClick((param: any) => {
      if (!param.point || drawModeRef.current === "cursor") return;
      const price = s.candle.coordinateToPrice?.(param.point.y);
      if (price == null || !param.time) return;
      const time = param.time as number;

      if (drawModeRef.current === "hline") {
        const pl = s.candle.createPriceLine({
          price,
          color: "#f97316",
          lineWidth: 1.5,
          lineStyle: 2,
          axisLabelVisible: true,
          title: price.toFixed(2),
        });
        hlinesData.current.push(price);
        hlinesRef.current.push({ price, pl });
        setDrawnCount((c) => c + 1);
      }
      if (drawModeRef.current === "long" || drawModeRef.current === "short") {
        const isLong = drawModeRef.current === "long";
        if (trendStepRef.current === 0) {
          trendP1Ref.current = { time, price };
          trendStepRef.current = 1;
          setTrendStep(1);
        } else {
          const entry = trendP1Ref.current!;
          const second = { time, price };
          const prim = new PositionPrimitive(isLong, entry, second);
          s.candle.attachPrimitive(prim);
          trendData.current.push({ isLong, entry, second });
          trendRef.current.push({ prim });
          trendStepRef.current = 0;
          trendP1Ref.current = null;
          setTrendStep(0);
          setDrawnCount((c) => c + 1);
        }
      }
    });

    // Crosshair OHLC
    chart.subscribeCrosshairMove((param: any) => {
      if (!param.time || !param.seriesData?.size) {
        setOhlc(null);
        return;
      }
      const cd = param.seriesData.get(s.candle);
      const vd = param.seriesData.get(s.vol);
      if (cd)
        setOhlc({
          o: cd.open,
          h: cd.high,
          l: cd.low,
          c: cd.close,
          v: vd?.value ?? 0,
        });
      else setOhlc(null);
    });

    return () => {
      chart.remove();
      chartApi.current = null;
    };
  }, [rows]);

  // ── Indicator toggle ───────────────────────────────────────────────────────
  function toggleInd(ind: IndKey) {
    const next = new Set(indRef.current);
    if (next.has(ind)) next.delete(ind);
    else next.add(ind);
    indRef.current = next;
    setIndicators(new Set(next));
    const on = next.has(ind);
    const s = sm.current;
    switch (ind) {
      case "EMA9":
        s.ema9?.applyOptions({ visible: on });
        break;
      case "EMA21":
        s.ema21?.applyOptions({ visible: on });
        break;
      case "BB":
        s.bbUp?.applyOptions({ visible: on });
        s.bbMid?.applyOptions({ visible: on });
        s.bbDn?.applyOptions({ visible: on });
        break;
      case "VOL":
        s.vol?.applyOptions({ visible: on });
        break;
      case "RSI":
        s.rsi?.applyOptions({ visible: on });
        break;
      case "MACD":
        s.macd?.applyOptions({ visible: on });
        s.macdSig?.applyOptions({ visible: on });
        s.macdHist?.applyOptions({ visible: on });
        break;
    }
  }

  // ── Drawing mode ───────────────────────────────────────────────────────────
  function setDraw(mode: DrawMode) {
    drawModeRef.current = mode;
    setDrawMode(mode);
    if (mode !== "long" && mode !== "short") {
      trendStepRef.current = 0;
      trendP1Ref.current = null;
      setTrendStep(0);
    }
  }

  function clearDrawings() {
    const s = sm.current;
    hlinesRef.current.forEach(({ pl }) => {
      try {
        s.candle?.removePriceLine(pl);
      } catch {}
    });
    trendRef.current.forEach(({ prim }) => {
      try {
        s.candle?.detachPrimitive(prim);
      } catch {}
    });
    hlinesRef.current = [];
    trendRef.current = [];
    hlinesData.current = [];
    trendData.current = [];
    trendStepRef.current = 0;
    trendP1Ref.current = null;
    setTrendStep(0);
    setDrawnCount(0);
  }

  const tc = target.type === "CE" ? "#0284c7" : "#dc2626";

  // Drawing tool button helper
  function DrawBtn({
    mode,
    title,
    children,
  }: {
    mode: DrawMode;
    title: string;
    children: React.ReactNode;
  }) {
    const active = drawMode === mode;
    return (
      <button
        title={title}
        onClick={() => setDraw(mode)}
        className="w-7 h-7 flex items-center justify-center rounded cursor-pointer transition-colors"
        style={{
          background: active ? "#0284c7" : "transparent",
          color: active ? "#fff" : "#64748b",
        }}
      >
        {children}
      </button>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-white">
      {/* ── Top toolbar: intervals + indicators + OHLC ── */}
      <div className="flex-shrink-0 flex items-center flex-wrap gap-2 px-3 py-1.5 border-b border-[#e2e8f0] bg-[#f8fafc]">
        {/* Interval selector */}
        <div className="flex rounded-sm overflow-hidden border border-[#cbd5e1]">
          {IV_LIST.map(({ label, iv }) => (
            <button
              key={iv}
              onClick={() => setTf(iv as IvKey)}
              className={`px-2.5 py-1 text-[9px] cursor-pointer transition-colors ${tf === iv ? "bg-[#0284c7] text-white font-bold" : "text-[#64748b] hover:bg-[#f1f5f9]"}`}
              style={MONO}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="w-px h-3.5 bg-[#e2e8f0]" />

        {/* Indicator toggles */}
        {(["EMA9", "EMA21", "BB", "VOL", "RSI", "MACD"] as IndKey[]).map(
          (ind) => (
            <button
              key={ind}
              onClick={() => toggleInd(ind)}
              className="px-2 py-0.5 text-[8px] rounded-sm cursor-pointer border transition-colors font-bold"
              style={{
                ...MONO,
                background: indicators.has(ind)
                  ? IND_COLORS[ind]
                  : "transparent",
                borderColor: indicators.has(ind) ? IND_COLORS[ind] : "#e2e8f0",
                color: indicators.has(ind) ? "#fff" : "#94a3b8",
              }}
            >
              {ind}
            </button>
          ),
        )}

        {loading && (
          <div className="w-3.5 h-3.5 border-2 border-[#0284c7]/20 border-t-[#0284c7] rounded-full animate-spin" />
        )}
        {error && (
          <span className="text-[8px] text-[#dc2626]" style={MONO}>
            ⚠ {error}
          </span>
        )}

        {/* OHLC display */}
        {(ohlc ??
          (rows.length > 0
            ? {
                o: rows[rows.length - 1].open,
                h: rows[rows.length - 1].high,
                l: rows[rows.length - 1].low,
                c: rows[rows.length - 1].close,
                v: rows[rows.length - 1].volume,
              }
            : null)) &&
          !loading &&
          (() => {
            const d = ohlc ?? {
              o: rows[rows.length - 1].open,
              h: rows[rows.length - 1].high,
              l: rows[rows.length - 1].low,
              c: rows[rows.length - 1].close,
              v: rows[rows.length - 1].volume,
            };
            return (
              <div
                className="ml-auto flex items-center gap-2 text-[8px]"
                style={MONO}
              >
                <span className="text-[#64748b]">
                  O <span style={{ color: tc }}>{d.o.toFixed(2)}</span>
                </span>
                <span className="text-[#64748b]">
                  H <span style={{ color: "#16a34a" }}>{d.h.toFixed(2)}</span>
                </span>
                <span className="text-[#64748b]">
                  L <span style={{ color: "#dc2626" }}>{d.l.toFixed(2)}</span>
                </span>
                <span className="text-[#64748b]">
                  C{" "}
                  <span style={{ color: d.c >= d.o ? "#16a34a" : "#dc2626" }}>
                    {d.c.toFixed(2)}
                  </span>
                </span>
                <span className="text-[#94a3b8]">
                  V {(d.v / 1000).toFixed(0)}K
                </span>
              </div>
            );
          })()}
      </div>

      {/* ── Main area: left drawing panel + chart ── */}
      <div className="flex-1 flex min-h-0">
        {/* Left drawing tools panel */}
        <div className="flex-shrink-0 w-8 flex flex-col items-center pt-2 pb-2 gap-0.5 border-r border-[#e2e8f0] bg-[#f8fafc]">
          {/* Cursor */}
          <DrawBtn mode="cursor" title="Cursor (select)">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M2 1L8 11L9.5 8L13 7L2 1Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </DrawBtn>

          {/* H-Line */}
          <DrawBtn mode="hline" title="Horizontal Line — click to place">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <line
                x1="1"
                y1="6.5"
                x2="12"
                y2="6.5"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <circle cx="1.5" cy="6.5" r="1.5" fill="currentColor" />
              <circle cx="11.5" cy="6.5" r="1.5" fill="currentColor" />
            </svg>
          </DrawBtn>

          {/* Long Position */}
          <DrawBtn
            mode="long"
            title={
              drawMode === "long" && trendStep === 1
                ? "Click 2nd point to set size…"
                : "Long Position (2 clicks: entry → size)"
            }
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <rect
                x="1"
                y="1"
                width="11"
                height="5"
                rx="1"
                fill="rgba(22,163,74,0.25)"
                stroke="#16a34a"
                strokeWidth="1"
              />
              <rect
                x="1"
                y="7"
                width="11"
                height="5"
                rx="1"
                fill="rgba(220,38,38,0.2)"
                stroke="#dc2626"
                strokeWidth="1"
              />
              <line
                x1="1"
                y1="6.5"
                x2="12"
                y2="6.5"
                stroke="#64748b"
                strokeWidth="1.5"
              />
            </svg>
          </DrawBtn>

          {/* Short Position */}
          <DrawBtn
            mode="short"
            title={
              drawMode === "short" && trendStep === 1
                ? "Click 2nd point to set size…"
                : "Short Position (2 clicks: entry → size)"
            }
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <rect
                x="1"
                y="1"
                width="11"
                height="5"
                rx="1"
                fill="rgba(220,38,38,0.2)"
                stroke="#dc2626"
                strokeWidth="1"
              />
              <rect
                x="1"
                y="7"
                width="11"
                height="5"
                rx="1"
                fill="rgba(22,163,74,0.25)"
                stroke="#16a34a"
                strokeWidth="1"
              />
              <line
                x1="1"
                y1="6.5"
                x2="12"
                y2="6.5"
                stroke="#64748b"
                strokeWidth="1.5"
              />
            </svg>
          </DrawBtn>

          {/* Step indicator for position tools */}
          {(drawMode === "long" || drawMode === "short") && (
            <div
              className="text-[7px] text-center leading-none px-0.5 font-bold"
              style={{
                ...MONO,
                color: drawMode === "long" ? "#16a34a" : "#dc2626",
              }}
            >
              {trendStep === 0 ? "E?" : "T?"}
            </div>
          )}

          <div className="flex-1" />

          {/* Clear */}
          <button
            title="Clear all drawings"
            onClick={clearDrawings}
            className="w-7 h-7 flex items-center justify-center rounded cursor-pointer transition-colors"
            style={{ color: drawnCount > 0 ? "#e11d48" : "#cbd5e1" }}
            disabled={drawnCount === 0}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M1 1L12 12M12 1L1 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Chart area */}
        <div
          className="flex-1 min-h-0 relative"
          style={{ cursor: drawMode === "cursor" ? "default" : "crosshair" }}
        >
          {loading && rows.length === 0 && (
            <div
              className="absolute inset-0 flex items-center justify-center gap-2 text-[10px] text-[#94a3b8]"
              style={MONO}
            >
              <div className="w-4 h-4 border-2 border-[#0284c7]/20 border-t-[#0284c7] rounded-full animate-spin" />
              Loading chart data…
            </div>
          )}
          {!loading && rows.length === 0 && !error && (
            <div
              className="absolute inset-0 flex items-center justify-center text-[10px] text-[#94a3b8]"
              style={MONO}
            >
              No data for selected interval
            </div>
          )}
          <div
            ref={chartDiv}
            className="absolute inset-0"
            style={{ visibility: rows.length > 0 ? "visible" : "hidden" }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── SENSIBULL-STYLE PAYOFF CHART ────────────────────────────────────────────
const NIFTY_LOT = 75;

function drawPayoffChart(
  canvas: HTMLCanvasElement,
  strike: number,
  type: "CE" | "PE",
  spot: number,
  entry: number,
) {
  const ctx = canvas.getContext("2d")!;
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (W < 20 || H < 20) return;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const P = { t: 44, r: 76, b: 56, l: 76 };
  const cw = W - P.l - P.r;
  const ch = H - P.t - P.b;

  // Price range centred on spot ±10%
  const halfRange = Math.max(spot * 0.105, 1500);
  const minP = spot - halfRange;
  const maxP = spot + halfRange;

  // Generate at-expiry payoff
  const N = 500;
  const pts: { px: number; pnl: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const price = minP + (i / N) * (maxP - minP);
    const intr =
      type === "CE" ? Math.max(0, price - strike) : Math.max(0, strike - price);
    pts.push({ px: price, pnl: (intr - entry) * NIFTY_LOT });
  }

  const maxPnL = Math.max(...pts.map((d) => d.pnl));
  const minPnL = Math.min(...pts.map((d) => d.pnl));
  const pnlSpan = maxPnL - minPnL || 1;
  const yLo = minPnL - pnlSpan * 0.15;
  const yHi = maxPnL + pnlSpan * 0.15;

  const toX = (p: number) => P.l + ((p - minP) / (maxP - minP)) * cw;
  const toY = (pnl: number) => P.t + (1 - (pnl - yLo) / (yHi - yLo)) * ch;
  const zeroY = toY(0);

  // ── Background ──
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  // Zone tints
  const zClip = Math.max(P.t, Math.min(P.t + ch, zeroY));
  ctx.fillStyle = "rgba(22,163,74,0.04)";
  ctx.fillRect(P.l, P.t, cw, zClip - P.t);
  ctx.fillStyle = "rgba(225,29,72,0.04)";
  ctx.fillRect(P.l, zClip, cw, P.t + ch - zClip);

  // ── Grid ──
  ctx.strokeStyle = "#f1f5f9";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const x = P.l + (i / 8) * cw;
    ctx.beginPath();
    ctx.moveTo(x, P.t);
    ctx.lineTo(x, P.t + ch);
    ctx.stroke();
  }
  for (let i = 0; i <= 5; i++) {
    const y = P.t + (i / 5) * ch;
    ctx.beginPath();
    ctx.moveTo(P.l, y);
    ctx.lineTo(P.l + cw, y);
    ctx.stroke();
  }

  // ── X-axis labels (price) ──
  ctx.fillStyle = "#94a3b8";
  ctx.font = "9px 'Space Mono', monospace";
  ctx.textAlign = "center";
  for (let i = 0; i <= 8; i++) {
    const p = minP + (i / 8) * (maxP - minP);
    ctx.fillText(
      Math.round(p).toLocaleString("en-IN"),
      P.l + (i / 8) * cw,
      P.t + ch + 20,
    );
  }

  // ── Y-axis labels (P&L) ──
  ctx.textAlign = "right";
  for (let i = 0; i <= 5; i++) {
    const pnl = yLo + (i / 5) * (yHi - yLo);
    const y = toY(pnl);
    const abs = Math.abs(pnl);
    const lbl =
      abs >= 100000
        ? `${(pnl / 1000).toFixed(0)}k`
        : abs >= 1000
          ? `${(pnl / 1000).toFixed(1)}k`
          : pnl.toFixed(0);
    ctx.fillStyle = pnl > 50 ? "#16a34a" : pnl < -50 ? "#e11d48" : "#94a3b8";
    ctx.fillText(lbl, P.l - 8, y + 3.5);
  }

  // ── Zero line ──
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(P.l, zeroY);
  ctx.lineTo(P.l + cw, zeroY);
  ctx.stroke();

  // ── Profit fill ──
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(toX(pts[0].px), zeroY);
  pts.forEach((d) => ctx.lineTo(toX(d.px), d.pnl > 0 ? toY(d.pnl) : zeroY));
  ctx.lineTo(toX(pts[pts.length - 1].px), zeroY);
  ctx.closePath();
  ctx.fillStyle = "rgba(22,163,74,0.20)";
  ctx.fill();
  ctx.restore();

  // ── Loss fill ──
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(toX(pts[0].px), zeroY);
  pts.forEach((d) => ctx.lineTo(toX(d.px), d.pnl < 0 ? toY(d.pnl) : zeroY));
  ctx.lineTo(toX(pts[pts.length - 1].px), zeroY);
  ctx.closePath();
  ctx.fillStyle = "rgba(225,29,72,0.15)";
  ctx.fill();
  ctx.restore();

  // ── Payoff curve ──
  ctx.strokeStyle = type === "CE" ? "#0284c7" : "#dc2626";
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  pts.forEach((d, i) => {
    if (i === 0) ctx.moveTo(toX(d.px), toY(d.pnl));
    else ctx.lineTo(toX(d.px), toY(d.pnl));
  });
  ctx.stroke();

  // ── Vertical marker helper ──
  function vline(
    px: number,
    color: string,
    dash: number[],
    lw: number,
    topTag: string,
    val: string,
  ) {
    const x = toX(px);
    if (x < P.l - 1 || x > P.l + cw + 1) return;
    ctx.save();
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x, P.t);
    ctx.lineTo(x, P.t + ch);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.font = "bold 7px 'Space Mono', monospace";
    ctx.fillText(topTag, x, P.t - 22);
    ctx.font = "8px 'Space Mono', monospace";
    ctx.fillText(val, x, P.t - 11);
  }
  vline(strike, "#94a3b8", [3, 3], 1, "STRIKE", strike.toLocaleString("en-IN"));
  if (entry > 0) {
    const be = type === "CE" ? strike + entry : strike - entry;
    vline(
      be,
      "#16a34a",
      [6, 3],
      1.5,
      "BREAKEVEN",
      Math.round(be).toLocaleString("en-IN"),
    );
  }
  vline(
    spot,
    "#f97316",
    [6, 3],
    2,
    "SPOT",
    Math.round(spot).toLocaleString("en-IN"),
  );

  // ── Dot at current spot on payoff curve ──
  const sX = toX(spot);
  if (sX >= P.l && sX <= P.l + cw) {
    const intr =
      type === "CE" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
    const curPnL = (intr - entry) * NIFTY_LOT;
    const dotY = toY(curPnL);
    ctx.beginPath();
    ctx.arc(sX, dotY, 6, 0, Math.PI * 2);
    ctx.fillStyle = curPnL >= 0 ? "#16a34a" : "#e11d48";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    const lbl = `${curPnL >= 0 ? "+" : ""}₹${Math.abs(Math.round(curPnL)).toLocaleString("en-IN")}`;
    ctx.fillStyle = curPnL >= 0 ? "#16a34a" : "#e11d48";
    ctx.font = "bold 11px 'Space Mono', monospace";
    ctx.textAlign = sX > W * 0.6 ? "right" : "left";
    ctx.fillText(lbl, sX + (sX > W * 0.6 ? -12 : 12), dotY - 10);
  }

  // ── Chart border ──
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.strokeRect(P.l, P.t, cw, ch);

  // ── Axis titles ──
  ctx.save();
  ctx.translate(13, P.t + ch / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "8px 'Space Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText("P&L AT EXPIRY  (₹)", 0, 0);
  ctx.restore();
  ctx.fillStyle = "#94a3b8";
  ctx.font = "8px 'Space Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText("NIFTY 50 AT EXPIRY", P.l + cw / 2, H - 10);
}

function PayoffPanel({
  target,
  spot,
  entryPrice,
}: {
  target: { strike: number; type: "CE" | "PE"; expiry: string };
  spot: number;
  entryPrice: number | null;
}) {
  const canvasRef = useRef<HTMLDivElement>(null); // use div as measurement anchor
  const cvRef = useRef<HTMLCanvasElement>(null);
  const entry = entryPrice ?? 0;
  const tc = target.type === "CE" ? "#0284c7" : "#e11d48";

  useEffect(() => {
    const canvas = cvRef.current;
    if (!canvas) return;
    const redraw = () =>
      drawPayoffChart(canvas, target.strike, target.type, spot, entry);
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    redraw();
    return () => ro.disconnect();
  }, [target.strike, target.type, spot, entry]);

  // Derived stats
  const be =
    target.type === "CE" ? target.strike + entry : target.strike - entry;
  const maxLoss = entry * NIFTY_LOT;
  const intr =
    target.type === "CE"
      ? Math.max(0, spot - target.strike)
      : Math.max(0, target.strike - spot);
  const curPnL = (intr - entry) * NIFTY_LOT;

  return (
    <div className="absolute inset-0 flex flex-col bg-white">
      {/* Canvas */}
      <div ref={canvasRef} className="flex-1 min-h-0 relative">
        <canvas ref={cvRef} className="absolute inset-0 w-full h-full" />
      </div>

      {/* Stats bar */}
      <div className="flex-shrink-0 border-t border-[#e2e8f0] bg-[#f8fafc] grid grid-cols-6 divide-x divide-[#e2e8f0]">
        {[
          {
            label: "STRIKE",
            val: target.strike.toLocaleString("en-IN"),
            color: "#64748b",
          },
          {
            label: "PREMIUM",
            val: entry > 0 ? `₹${entry.toFixed(2)}` : "—",
            color: tc,
          },
          {
            label: "BREAKEVEN",
            val: entry > 0 ? Math.round(be).toLocaleString("en-IN") : "—",
            color: "#16a34a",
          },
          {
            label: "MAX LOSS",
            val:
              entry > 0
                ? `₹${maxLoss.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                : "—",
            color: "#e11d48",
          },
          {
            label: "MAX PROFIT",
            val:
              target.type === "CE"
                ? "Unlimited"
                : `₹${(target.strike * NIFTY_LOT).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
            color: "#16a34a",
          },
          {
            label: "CUR P&L",
            val:
              entry > 0
                ? `${curPnL >= 0 ? "+" : ""}₹${Math.abs(Math.round(curPnL)).toLocaleString("en-IN")}`
                : "—",
            color: curPnL >= 0 ? "#16a34a" : "#e11d48",
          },
        ].map(({ label, val, color }) => (
          <div key={label} className="px-3 py-2.5 text-center">
            <div
              className="text-[7px] text-[#94a3b8] tracking-[1.5px] uppercase mb-1"
              style={MONO}
            >
              {label}
            </div>
            <div
              className="text-[12px] font-bold leading-tight"
              style={{ ...MONO, color }}
            >
              {val}
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex-shrink-0 flex items-center justify-center gap-5 py-1.5 border-t border-[#f1f5f9] bg-white">
        {[
          { color: "#f97316", dash: false, label: "Current Spot" },
          { color: "#16a34a", dash: true, label: "Breakeven" },
          { color: "#94a3b8", dash: true, label: "Strike" },
          { color: "rgba(22,163,74,0.5)", dash: false, label: "Profit Zone" },
          { color: "rgba(225,29,72,0.5)", dash: false, label: "Loss Zone" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div
              className="w-5 h-[2px] rounded-full"
              style={{ background: color }}
            />
            <span className="text-[8px] text-[#94a3b8]" style={MONO}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtTime(t: string) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// ─── SMC TABLE VIEW ────────────────────────────────────────────────────────────
function SMCTableView({
  alerts,
  winRate,
  smcStatus,
  busy,
  authenticated,
  expiry,
  onTrigger,
  onClear,
  onAddWatch,
  histDate,
  onHistDateChange,
  histBusy,
  histErr,
  histResults,
  onHistScan,
  onHistClear,
  autoTradeEnabled,
  autoPositions,
  onToggleAutoTrade,
  onOpenChart,
  chainRows,
}: {
  alerts: any[];
  winRate: number | null;
  smcStatus: {
    scanActive: boolean;
    lastScanAt: string | null;
    wins: number;
    losses: number;
  } | null;
  busy: boolean;
  authenticated: boolean;
  expiry: string;
  onTrigger: () => void;
  onClear: () => void;
  onAddWatch: (leg: OptionLeg) => void;
  histDate: string;
  onHistDateChange: (d: string) => void;
  histBusy: boolean;
  histErr: string;
  histResults: any[] | null;
  onHistScan: () => void;
  onHistClear: () => void;
  autoTradeEnabled: boolean;
  autoPositions: any[];
  onToggleAutoTrade: () => void;
  onOpenChart: (token: number, strike: number, type: "CE" | "PE") => void;
  chainRows: any[];
}) {
  const [mode, setMode] = useState<"live" | "backtest">("live");
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const resolveToken = (strike: number, direction: string): number | undefined => {
    const row = chainRows.find((r: any) => r.strike === strike);
    return direction === "CE" ? row?.ce?.token : row?.pe?.token;
  };

  // Which alerts to show in table
  const tableAlerts =
    mode === "backtest" && histResults !== null ? histResults : alerts;

  const wins = tableAlerts.filter(
    (a) => a.status === "TARGET" || a.status === "TIME_PROFIT",
  ).length;
  const losses = tableAlerts.filter(
    (a) => a.status === "SL" || a.status === "TIME_EXIT",
  ).length;
  const eod = tableAlerts.filter((a) => a.status === "EOD").length;
  const active = tableAlerts.filter((a) => a.status === "ACTIVE").length;
  const total = wins + losses;
  const wr = total > 0 ? ((wins / total) * 100).toFixed(1) : null;

  const LOT_QTY = LOT_SIZE;

  // concept pill color map
  const conceptColor: Record<string, string> = {
    LiqGrab: "#7c3aed",
    FVG: "#0284c7",
    OrdBlock: "#b45309",
    Breaker: "#ea580c",
    SMTrap: "#e11d48",
  };

  const fmtLotPnl = (n: number) => {
    const abs = Math.abs(n);
    const s = n >= 0 ? "+" : "−";
    return abs >= 100000
      ? `${s}₹${(abs / 100000).toFixed(2)}L`
      : abs >= 1000
        ? `${s}₹${(abs / 1000).toFixed(1)}K`
        : `${s}₹${abs.toFixed(0)}`;
  };

  // Overall lot P&L — sum of every trade in the table (realized + unrealized)
  const totalLotPnl = tableAlerts.reduce(
    (s, a) => s + (a.currentPnL ?? 0) * LOT_QTY,
    0,
  );
  const realizedLotPnl = tableAlerts
    .filter((a) => a.status !== "ACTIVE")
    .reduce((s, a) => s + (a.currentPnL ?? 0) * LOT_QTY, 0);

  const COLS =
    "40px 60px 1fr 80px 70px 70px 72px 72px 72px 90px 130px 65px 80px";

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Mode switcher + action bar ── */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-2.5 bg-white border-b border-[#cbd5e1] flex-shrink-0 overflow-x-auto">
        {/* LIVE / BACKTEST toggle */}
        <div className="flex border border-[#cbd5e1] rounded-sm overflow-hidden flex-shrink-0">
          {(["live", "backtest"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2 sm:px-3 py-1.5 text-[9px] font-bold tracking-[1px] cursor-pointer transition-colors whitespace-nowrap ${mode === m ? "text-white" : "text-[#64748b] hover:bg-[#f1f5f9]"}`}
              style={{
                ...MONO,
                background:
                  mode === m
                    ? m === "live"
                      ? "#7c3aed"
                      : "#ea580c"
                    : "transparent",
              }}
            >
              {m === "live" ? "▶ LIVE" : "◉ TEST"}
            </button>
          ))}
        </div>

        {mode === "live" ? (
          <>
            {/* Live scan status — dot only on mobile */}
            <div
              className="flex items-center gap-1.5 px-2 py-1 border rounded-sm flex-shrink-0"
              style={{
                background: smcStatus?.scanActive
                  ? "rgba(124,58,237,0.05)"
                  : "#f1f5f9",
                borderColor: smcStatus?.scanActive
                  ? "rgba(124,58,237,0.4)"
                  : "#cbd5e1",
              }}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${smcStatus?.scanActive ? "bg-[#7c3aed] live-pulse" : "bg-[#94a3b8]"}`}
              />
              <span
                className="hidden sm:block text-[9px] font-bold whitespace-nowrap"
                style={{
                  ...MONO,
                  color: smcStatus?.scanActive ? "#7c3aed" : "#64748b",
                }}
              >
                {smcStatus?.scanActive
                  ? "SCANNING"
                  : authenticated
                    ? "CLOSED"
                    : "NOT AUTH"}
              </span>
            </div>
            {wr !== null && (
              <div
                className="hidden md:flex items-center gap-1.5 px-2 py-1 border rounded-sm flex-shrink-0"
                style={{
                  background:
                    Number(wr) >= 70
                      ? isDark
                        ? "#052e16"
                        : "#f0fdf4"
                      : isDark
                        ? "#2d0505"
                        : "#fef2f2",
                  borderColor:
                    Number(wr) >= 70
                      ? isDark
                        ? "#166534"
                        : "#bbf7d0"
                      : isDark
                        ? "#991b1b"
                        : "#fecaca",
                }}
              >
                <span
                  className="text-[9px] font-bold whitespace-nowrap"
                  style={{
                    ...MONO,
                    color: Number(wr) >= 70 ? "#16a34a" : "#e11d48",
                  }}
                >
                  {wr}% · {wins}W/{losses}L
                </span>
              </div>
            )}
            <div
              className="hidden sm:block text-[9px] text-[#64748b] whitespace-nowrap flex-shrink-0"
              style={MONO}
            >
              <span className="text-[#0284c7] font-bold">{active}</span> active
              · {alerts.length} total
            </div>
            <div className="ml-auto flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              {/* AUTO TRADE START / STOP */}
              {authenticated && !isDemoMode && (
                <button
                  onClick={onToggleAutoTrade}
                  className="px-2 sm:px-3 py-1.5 text-[9px] font-bold rounded-sm border cursor-pointer transition-all whitespace-nowrap"
                  style={{
                    ...MONO,
                    background: autoTradeEnabled
                      ? "#16a34a"
                      : isDark
                        ? "#0a0f16"
                        : "#f8fafc",
                    borderColor: autoTradeEnabled ? "#16a34a" : "#e11d48",
                    color: autoTradeEnabled ? "#fff" : "#e11d48",
                  }}
                >
                  {autoTradeEnabled ? "⏹ STOP" : "▶ AUTO"}
                </button>
              )}
              <button
                onClick={onTrigger}
                disabled={busy || !authenticated || isDemoMode}
                className="px-2 sm:px-3 py-1.5 text-[9px] font-bold rounded-sm border cursor-pointer disabled:opacity-40 whitespace-nowrap"
                style={{
                  ...MONO,
                  background: "#7c3aed18",
                  borderColor: "#7c3aed",
                  color: "#7c3aed",
                }}
              >
                {busy ? "…" : "▶ SCAN"}
              </button>
              {alerts.length > 0 && (
                <button
                  onClick={onClear}
                  className="px-2 sm:px-3 py-1.5 text-[9px] text-[#94a3b8] border border-[#cbd5e1] rounded-sm cursor-pointer hover:border-[#94a3b8] whitespace-nowrap"
                  style={MONO}
                >
                  CLR
                </button>
              )}
            </div>
          </>
        ) : (
          /* Backtest date picker */
          <>
            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              <span
                className="hidden sm:block text-[9px] text-[#64748b] tracking-[1px]"
                style={MONO}
              >
                DATE
              </span>
              <input
                type="date"
                value={histDate}
                max={(() => {
                  const d = new Date();
                  d.setDate(d.getDate() - 1);
                  return d.toISOString().split("T")[0];
                })()}
                onChange={(e) => onHistDateChange(e.target.value)}
                className="border border-[#cbd5e1] rounded-sm px-2 py-1 text-[10px] sm:text-[11px] bg-white cursor-pointer outline-none"
                style={MONO}
              />
              <button
                onClick={onHistScan}
                disabled={histBusy || !authenticated || isDemoMode || !expiry}
                className="px-2 sm:px-3 py-1.5 text-[9px] font-bold rounded-sm border cursor-pointer disabled:opacity-40 transition-colors whitespace-nowrap"
                style={{
                  ...MONO,
                  background: "#ea580c18",
                  borderColor: "#ea580c",
                  color: "#ea580c",
                }}
              >
                {histBusy ? "…" : "◉ RUN"}
              </button>
              {histErr && (
                <span
                  className="text-[9px] text-[#e11d48] whitespace-nowrap"
                  style={MONO}
                >
                  {histErr}
                </span>
              )}
            </div>
            {histResults !== null && wr !== null && (
              <div
                className="hidden md:flex items-center gap-1.5 px-2 py-1 border rounded-sm flex-shrink-0"
                style={{
                  background:
                    Number(wr) >= 70
                      ? isDark
                        ? "#052e16"
                        : "#f0fdf4"
                      : isDark
                        ? "#2d0505"
                        : "#fef2f2",
                  borderColor:
                    Number(wr) >= 70
                      ? isDark
                        ? "#166534"
                        : "#bbf7d0"
                      : isDark
                        ? "#991b1b"
                        : "#fecaca",
                }}
              >
                <span
                  className="text-[9px] font-bold whitespace-nowrap"
                  style={{
                    ...MONO,
                    color: Number(wr) >= 70 ? "#16a34a" : "#e11d48",
                  }}
                >
                  {wr}% · {wins}W/{losses}L{eod > 0 ? ` · ${eod}E` : ""}
                </span>
              </div>
            )}
            <div className="ml-auto flex items-center gap-2 flex-shrink-0">
              {histResults !== null && (
                <button
                  onClick={onHistClear}
                  className="px-2 sm:px-3 py-1.5 text-[9px] text-[#94a3b8] border border-[#cbd5e1] rounded-sm cursor-pointer hover:border-[#94a3b8] whitespace-nowrap"
                  style={MONO}
                >
                  CLR
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Auto Trade Positions Panel ── */}
      {autoPositions.length > 0 && (
        <div className="flex-shrink-0 px-5 py-2 bg-[#f0fdf4] border-b border-[#bbf7d0]">
          <div
            className="text-[8px] font-bold tracking-[1.5px] text-[#16a34a] mb-1.5"
            style={MONO}
          >
            AUTO TRADE POSITIONS ({autoPositions.length})
          </div>
          <div className="flex flex-col gap-1">
            {autoPositions.map((p: any, i: number) => (
              <div
                key={i}
                className="flex items-center gap-3 text-[9px]"
                style={MONO}
              >
                <span className="font-bold text-[#1e293b]">
                  {p.tradingsymbol}
                </span>
                <span
                  className="px-1.5 py-0.5 rounded-sm text-[8px] font-bold"
                  style={{
                    background:
                      p.status?.startsWith("EXITED") || p.status === "ACTIVE"
                        ? "#16a34a22"
                        : p.status === "ERROR"
                          ? "#ef444422"
                          : "#f59e0b22",
                    color:
                      p.status?.startsWith("EXITED") || p.status === "ACTIVE"
                        ? "#16a34a"
                        : p.status === "ERROR"
                          ? "#ef4444"
                          : "#b45309",
                  }}
                >
                  {p.status}
                </span>
                {p.entryOrderId && (
                  <span className="text-[#64748b]">
                    Entry: {p.entryOrderId}
                  </span>
                )}
                {p.slOrderId && (
                  <span className="text-[#ef4444]">SL: {p.slOrderId}</span>
                )}
                {p.logs?.[p.logs.length - 1] && (
                  <span className="text-[#94a3b8] truncate max-w-[300px]">
                    {p.logs[p.logs.length - 1]}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Concept legend ── */}
      <div className="hidden md:flex items-center gap-2 px-5 py-1.5 bg-[#fafbfc] border-b border-[#e2e8f0] flex-shrink-0 flex-wrap">
        <span className="text-[7px] text-[#94a3b8] tracking-[1px]" style={MONO}>
          SMC CONCEPTS:
        </span>
        {Object.entries(conceptColor).map(([k, c]) => (
          <span
            key={k}
            className="text-[8px] px-1.5 py-0.5 rounded-sm font-bold"
            style={{
              ...MONO,
              background: `${c}18`,
              color: c,
              border: `1px solid ${c}33`,
            }}
          >
            {k}
          </span>
        ))}
        <span className="text-[7px] text-[#94a3b8] ml-2" style={MONO}>
          · min 2 concepts · LTP ₹200–₹300 · SL −12% · Target +24% · entry ≥
          09:21
        </span>
      </div>

      {/* ── Empty state (outside scroll container so it centers correctly) ── */}
      {tableAlerts.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
          <IconScan size={48} className="text-[#e2e8f0]" />
          <p className="text-[11px] text-[#94a3b8] text-center" style={MONO}>
            {mode === "backtest"
              ? "Select a date and tap RUN to analyse a past day"
              : !authenticated
                ? "Connect Kite to start SMC scanning"
                : isDemoMode
                  ? "SMC scanner requires live data"
                  : "No alerts yet · Scanner runs every minute from 09:21 AM"}
          </p>
          {mode === "live" && authenticated && !isDemoMode && (
            <button
              onClick={onTrigger}
              disabled={busy}
              className="px-5 py-2.5 text-[10px] font-bold tracking-[2px] rounded-sm border cursor-pointer disabled:opacity-40"
              style={{
                ...MONO,
                background: "#7c3aed18",
                borderColor: "#7c3aed",
                color: "#7c3aed",
              }}
            >
              {busy ? "SCANNING…" : "▶ RUN SMC SCAN NOW"}
            </button>
          )}
          {mode === "backtest" && authenticated && !isDemoMode && (
            <button
              onClick={onHistScan}
              disabled={histBusy}
              className="px-5 py-2.5 text-[10px] font-bold tracking-[2px] rounded-sm border cursor-pointer disabled:opacity-40"
              style={{
                ...MONO,
                background: "#ea580c18",
                borderColor: "#ea580c",
                color: "#ea580c",
              }}
            >
              {histBusy ? "SCANNING…" : "◉ RUN BACKTEST NOW"}
            </button>
          )}
        </div>
      )}

      {/* ── Table header + body ── */}
      {tableAlerts.length > 0 && (
        <>
          {/* ── MOBILE CARDS (md+ hidden) ── */}
          <div className="md:hidden flex-1 overflow-auto px-3 py-3 space-y-3">
            {tableAlerts.map((a, idx) => {
              const misCE = a.direction === "CE";
              const misWin =
                a.status === "TARGET" || a.status === "TIME_PROFIT";
              const misLoss = a.status === "SL" || a.status === "TIME_EXIT";
              const mdirClr = misCE ? "#0284c7" : "#e11d48";
              const mstClr = misWin
                ? "#16a34a"
                : misLoss
                  ? "#e11d48"
                  : a.status === "EOD"
                    ? "#b45309"
                    : "#0284c7";
              const mpnlUp = (a.currentPnL ?? 0) >= 0;
              const mpnlClr = misWin
                ? "#16a34a"
                : misLoss
                  ? "#e11d48"
                  : mpnlUp
                    ? "#16a34a"
                    : "#e11d48";
              const mstIco =
                a.status === "TARGET"
                  ? "🎯"
                  : a.status === "SL"
                    ? "🛑"
                    : a.status === "EOD"
                      ? "🕐"
                      : "⏳";
              const mstLbl =
                a.status === "TIME_PROFIT"
                  ? "60M WIN"
                  : a.status === "TIME_EXIT"
                    ? "75M EXIT"
                    : a.status;
              const mSl = a.rr?.sl ?? 0;
              const mT2 = a.rr?.target2 ?? 0;
              const mLtp = a.leg?.ltp ?? a.rr?.entry ?? 0;
              const mFill =
                mT2 - mSl > 0
                  ? Math.min(
                      Math.max(((mLtp - mSl) / (mT2 - mSl)) * 100, 0),
                      100,
                    )
                  : 50;
              const mT1Pct =
                mT2 - mSl > 0
                  ? Math.min(
                      (((a.rr?.target1 ?? 0) - mSl) / (mT2 - mSl)) * 100,
                      100,
                    )
                  : 67;
              return (
                <div
                  key={a.id}
                  className="rounded-xl overflow-hidden"
                  style={{
                    background: isDark ? "#0d1420" : "#fff",
                    border: `1px solid ${misWin ? "#22c55e33" : misLoss ? "#ef444433" : isDark ? "#1e2a3a" : "#e2e8f0"}`,
                    borderLeft: `3px solid ${misWin ? "#22c55e" : misLoss ? "#e11d48" : a.status === "ACTIVE" ? mdirClr : "#334155"}`,
                  }}
                >
                  {/* Top section */}
                  <div className="px-3 py-3 flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5 flex-1 min-w-0">
                      {/* Direction badge */}
                      <div
                        className="w-10 h-10 rounded-xl flex flex-col items-center justify-center flex-shrink-0"
                        style={{
                          background: `${mdirClr}18`,
                          border: `1.5px solid ${mdirClr}40`,
                        }}
                      >
                        <span
                          className="text-[7px] font-bold"
                          style={{ ...MONO, color: "#64748b" }}
                        >
                          NI
                        </span>
                        <span
                          className="text-[12px] font-bold"
                          style={{ ...BEBAS, color: mdirClr }}
                        >
                          {a.direction}
                        </span>
                      </div>
                      {/* Instrument + time + concepts */}
                      <div className="flex-1 min-w-0">
                        <div
                          className="text-[15px] font-bold leading-tight"
                          style={{
                            ...BEBAS,
                            color: isDark ? "#e2e8f0" : "#1e293b",
                          }}
                        >
                          NIFTY {a.strike}{" "}
                          {a.direction === "CE" ? "Call" : "Put"}
                        </div>
                        <div
                          className="text-[8px] mt-0.5"
                          style={{ ...MONO, color: "#64748b" }}
                        >
                          {fmtTime(a.entryTime)}
                          {a.exitTime
                            ? ` → ${fmtTime(a.exitTime)}`
                            : " → ACTIVE"}
                          {a.spot ? `  ·  spot ${a.spot.toFixed(0)}` : ""}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          <span
                            className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm"
                            style={{
                              ...MONO,
                              background: `${mdirClr}18`,
                              color: mdirClr,
                              border: `1px solid ${mdirClr}30`,
                            }}
                          >
                            {a.direction} {a.score}/5
                          </span>
                          {(a.concepts ?? []).map((c: string) => (
                            <span
                              key={c}
                              className="text-[7px] px-1 py-0.5 rounded-sm font-bold"
                              style={{
                                ...MONO,
                                background: `${conceptColor[c] ?? "#64748b"}14`,
                                color: conceptColor[c] ?? "#64748b",
                              }}
                            >
                              {c}
                            </span>
                          ))}
                          {a.trendOk && (
                            <span
                              className="text-[7px] text-[#16a34a]"
                              style={MONO}
                            >
                              +EMA✓
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Right: status + T1/T2 + chart */}
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span
                        className="text-[8px] font-bold px-2 py-0.5 rounded-full"
                        style={{
                          ...MONO,
                          background: `${mstClr}18`,
                          color: mstClr,
                          border: `1px solid ${mstClr}40`,
                        }}
                      >
                        {mstIco} {mstLbl}
                      </span>
                      <div className="flex gap-1">
                        <span
                          className="text-[7px] px-1.5 py-0.5 rounded-sm font-bold"
                          style={{
                            ...MONO,
                            background:
                              a.t1Hit || a.status === "TARGET"
                                ? isDark
                                  ? "#052e16"
                                  : "#dcfce7"
                                : isDark
                                  ? "#0f1923"
                                  : "#f1f5f9",
                            color:
                              a.t1Hit || a.status === "TARGET"
                                ? "#15803d"
                                : isDark
                                  ? "#4a6080"
                                  : "#94a3b8",
                          }}
                        >
                          T1{a.t1Hit || a.status === "TARGET" ? "✓" : "✗"}
                        </span>
                        <span
                          className="text-[7px] px-1.5 py-0.5 rounded-sm font-bold"
                          style={{
                            ...MONO,
                            background:
                              a.status === "TARGET"
                                ? isDark
                                  ? "#052e16"
                                  : "#dcfce7"
                                : isDark
                                  ? "#0f1923"
                                  : "#f1f5f9",
                            color:
                              a.status === "TARGET"
                                ? "#15803d"
                                : isDark
                                  ? "#4a6080"
                                  : "#94a3b8",
                          }}
                        >
                          T2{a.status === "TARGET" ? "✓" : "✗"}
                        </span>
                      </div>
                      {a.strike && a.direction && (
                        <button
                          onClick={() => { const t = a.leg?.token ?? resolveToken(a.strike, a.direction); if (t) onOpenChart(t, a.strike, a.direction as "CE" | "PE"); }}
                          className="w-5 h-5 flex items-center justify-center cursor-pointer"
                          style={{ color: mdirClr, opacity: 0.7 }}
                          title="Open chart"
                        >
                          <CandleIcon color={mdirClr} />
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Progress bar for ACTIVE */}
                  {a.status === "ACTIVE" && (
                    <div className="px-3 pb-2">
                      <div className="h-1.5 bg-[#e2e8f0] rounded-full overflow-hidden w-full relative">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${mFill}%`,
                            background:
                              mFill >= 67
                                ? "#16a34a"
                                : mFill >= 33
                                  ? "#f59e0b"
                                  : "#e11d48",
                          }}
                        />
                        <div
                          className="absolute top-0 bottom-0 w-px bg-[#7c3aed] opacity-70"
                          style={{ left: `${mT1Pct}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {/* T1 / T2 single bold line above footer */}
                  <div
                    className="px-3 py-1.5 flex items-center gap-3 border-t"
                    style={{
                      background: isDark ? "#0d1420" : "#fff",
                      borderColor: isDark ? "#1e2a3a" : "#e2e8f0",
                    }}
                  >
                    <span
                      className="text-[9px] font-bold"
                      style={{ ...MONO, color: "#b45309" }}
                    >
                      T1 ₹{a.rr?.target1?.toFixed(2) ?? "—"}
                      {a.t1Hit || a.status === "TARGET" ? " ✓" : ""}
                    </span>
                    <span
                      className="text-[9px] font-bold"
                      style={{ ...MONO, color: "#16a34a" }}
                    >
                      T2 ₹{a.rr?.target2?.toFixed(2) ?? "—"}
                      {a.status === "TARGET" ? " ✓" : ""}
                    </span>
                    {(a.peakMove ?? 0) > 0 && (
                      <span
                        className="text-[9px] font-bold"
                        style={{ ...MONO, color: "#7c3aed" }}
                      >
                        MAX +{a.peakMove.toFixed(1)}
                      </span>
                    )}
                  </div>
                  {/* Footer: single row — ENTRY | CMP/SL | LOT P&L */}
                  <div
                    className="grid grid-cols-3 border-t"
                    style={{
                      gap: "1px",
                      background: isDark ? "#1e2a3a" : "#e2e8f0",
                    }}
                  >
                    {/* ENTRY */}
                    <div
                      className="px-3 py-2"
                      style={{ background: isDark ? "#0a0f16" : "#f8fafc" }}
                    >
                      <div
                        className="text-[7px] tracking-[1px] mb-0.5"
                        style={{ ...MONO, color: "#64748b" }}
                      >
                        ENTRY
                      </div>
                      <div
                        className="text-[12px] font-bold tabular-nums"
                        style={{ ...MONO, color: mdirClr }}
                      >
                        ₹{a.rr?.entry?.toFixed(2) ?? "—"}
                      </div>
                    </div>
                    {/* CMP (ACTIVE) or SL */}
                    <div
                      className="px-3 py-2"
                      style={{ background: isDark ? "#0a0f16" : "#f8fafc" }}
                    >
                      <div
                        className="text-[7px] tracking-[1px] mb-0.5"
                        style={{ ...MONO, color: "#64748b" }}
                      >
                        {a.status === "ACTIVE" ? "CMP" : "SL"}
                      </div>
                      <div
                        className="text-[12px] font-bold tabular-nums"
                        style={{
                          ...MONO,
                          color:
                            a.status === "ACTIVE"
                              ? (a.lastLtp ?? 0) >= (a.rr?.entry ?? 0)
                                ? "#16a34a"
                                : "#e11d48"
                              : "#e11d48",
                        }}
                      >
                        ₹
                        {(a.status === "ACTIVE"
                          ? a.lastLtp
                          : a.rr?.sl
                        )?.toFixed(2) ?? "—"}
                      </div>
                      {a.status === "ACTIVE" && (
                        <div
                          className="text-[7px] mt-0.5"
                          style={{ ...MONO, color: "#94a3b8" }}
                        >
                          SL ₹{a.rr?.sl?.toFixed(0)}
                        </div>
                      )}
                    </div>
                    {/* LOT P&L + MAX PTS small below */}
                    <div
                      className="px-3 py-2"
                      style={{ background: isDark ? "#0a0f16" : "#f8fafc" }}
                    >
                      <div
                        className="text-[7px] tracking-[1px] mb-0.5"
                        style={{ ...MONO, color: "#64748b" }}
                      >
                        LOT P&L
                      </div>
                      <div
                        className="text-[13px] font-bold tabular-nums"
                        style={{ ...MONO, color: mpnlClr }}
                      >
                        {fmtLotPnl((a.currentPnL ?? 0) * LOT_QTY)}
                      </div>
                      <div
                        className="text-[8px]"
                        style={{ ...MONO, color: mpnlClr }}
                      >
                        {mpnlUp ? "+" : ""}
                        {a.pnlPct?.toFixed(1) ?? "0.0"}%
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {/* Mobile totals row */}
            <div
              className="rounded-xl overflow-hidden"
              style={{
                background: isDark ? "#0d1420" : "#f8fafc",
                border: `1px solid ${isDark ? "#1e2a3a" : "#e2e8f0"}`,
              }}
            >
              <div
                className="grid grid-cols-3"
                style={{
                  gap: "1px",
                  background: isDark ? "#1e2a3a" : "#e2e8f0",
                }}
              >
                {[
                  {
                    label: "TRADES",
                    val: `${tableAlerts.length}`,
                    color: "#475569",
                  },
                  {
                    label: "WIN RATE",
                    val: wr ? `${wr}%` : "—",
                    color: wr && Number(wr) >= 70 ? "#16a34a" : "#e11d48",
                  },
                  {
                    label: "LOT P&L",
                    val: tableAlerts.length > 0 ? fmtLotPnl(totalLotPnl) : "—",
                    color: totalLotPnl >= 0 ? "#16a34a" : "#e11d48",
                  },
                ].map(({ label, val, color }) => (
                  <div
                    key={label}
                    className="px-3 py-2.5 text-center"
                    style={{ background: isDark ? "#0a0f16" : "#fff" }}
                  >
                    <div
                      className="text-[7px] tracking-[1.5px] mb-1"
                      style={{ ...MONO, color: "#64748b" }}
                    >
                      {label}
                    </div>
                    <div
                      className="text-[15px] font-bold"
                      style={{ ...MONO, color }}
                    >
                      {val}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* ── DESKTOP TABLE (hidden on mobile) ── */}
          <div className="hidden md:block flex-1 overflow-auto">
            <div style={{ minWidth: "900px" }}>
              <div
                className="grid flex-shrink-0 border-b-2 border-[#cbd5e1] bg-[#f8fafc]"
                style={{ gridTemplateColumns: COLS }}
              >
                {[
                  "#",
                  "TIME",
                  "SIGNALS",
                  "STRIKE",
                  "ENTRY",
                  "CMP",
                  "SL",
                  "T1",
                  "T2",
                  "STATUS",
                  `P&L · LOT (${LOT_SIZE})`,
                  "MAX PTS",
                  "",
                ].map((h) => (
                  <div
                    key={h}
                    className="px-2 py-2 text-[8px] font-bold tracking-[1.5px] text-[#64748b] uppercase"
                    style={MONO}
                  >
                    {h}
                  </div>
                ))}
              </div>

              {/* ── Table body ── */}
              <div>
                {tableAlerts.map((a, idx) => {
                  const isCE = a.direction === "CE";
                  const isTimedWin = a.status === "TIME_PROFIT";
                  const isTimedExit = a.status === "TIME_EXIT";
                  const rowBg =
                    a.status === "TARGET" || isTimedWin
                      ? isDark
                        ? "#052e16"
                        : "#f0fdf4"
                      : a.status === "SL" || isTimedExit
                        ? isDark
                          ? "#2d0505"
                          : "#fff5f5"
                        : a.status === "EOD"
                          ? isDark
                            ? "#1c1500"
                            : "#fefce8"
                          : idx % 2 === 0
                            ? isDark
                              ? "#0a0f16"
                              : "#fff"
                            : isDark
                              ? "#0d1420"
                              : "#fafafa";
                  const dirColor = isCE ? "#0284c7" : "#e11d48";
                  const stColor =
                    a.status === "TARGET" || isTimedWin
                      ? "#16a34a"
                      : a.status === "SL" || isTimedExit
                        ? "#e11d48"
                        : a.status === "EOD"
                          ? "#b45309"
                          : "#0284c7";
                  const pnlUp = a.currentPnL >= 0;
                  const pnlColor =
                    a.status === "TARGET" || isTimedWin
                      ? "#16a34a"
                      : a.status === "SL" || isTimedExit
                        ? "#e11d48"
                        : pnlUp
                          ? "#16a34a"
                          : "#e11d48";
                  const stIcon =
                    a.status === "TARGET"
                      ? "🎯"
                      : a.status === "SL"
                        ? "🛑"
                        : a.status === "EOD"
                          ? "🕐"
                          : isTimedWin
                            ? "⏱"
                            : isTimedExit
                              ? "⏱"
                              : "⏳";
                  const stLabel = isTimedWin
                    ? "60M PROFIT"
                    : isTimedExit
                      ? "75M EXIT"
                      : a.status;
                  // progress bar for ACTIVE
                  const sl = a.rr?.sl ?? 0;
                  const t2 = a.rr?.target2 ?? 0;
                  const ltp = a.leg?.ltp ?? a.rr?.entry ?? 0;
                  const fillPct =
                    t2 - sl > 0
                      ? Math.min(
                          Math.max(((ltp - sl) / (t2 - sl)) * 100, 0),
                          100,
                        )
                      : 50;

                  return (
                    <div
                      key={a.id}
                      className="grid border-b border-[#f1f5f9] hover:bg-[#f0f4ff] transition-colors items-center"
                      style={{ gridTemplateColumns: COLS, background: rowBg }}
                    >
                      {/* # */}
                      <div
                        className="px-2 py-2.5 text-[9px] text-[#94a3b8]"
                        style={MONO}
                      >
                        {idx + 1}
                      </div>

                      {/* TIME */}
                      <div className="px-2 py-2.5">
                        <div
                          className="text-[10px] font-bold text-[#1e293b]"
                          style={MONO}
                        >
                          {fmtTime(a.entryTime)}
                        </div>
                        {a.exitTime ? (
                          <div
                            className="text-[8px] text-[#94a3b8]"
                            style={MONO}
                          >
                            →{fmtTime(a.exitTime)}
                          </div>
                        ) : (
                          <div
                            className="text-[8px] text-[#94a3b8]"
                            style={MONO}
                          >
                            {a.strength}
                          </div>
                        )}
                      </div>

                      {/* SIGNALS */}
                      <div className="px-2 py-2.5 flex flex-wrap gap-1">
                        <span
                          className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm"
                          style={{
                            ...MONO,
                            background: `${dirColor}18`,
                            color: dirColor,
                            border: `1px solid ${dirColor}30`,
                          }}
                        >
                          {a.direction} {a.score}/5
                        </span>
                        {(a.concepts ?? []).map((c: string) => (
                          <span
                            key={c}
                            className="text-[7px] px-1 py-0.5 rounded-sm font-bold"
                            style={{
                              ...MONO,
                              background: `${conceptColor[c] ?? "#64748b"}14`,
                              color: conceptColor[c] ?? "#64748b",
                            }}
                          >
                            {c}
                          </span>
                        ))}
                        {a.trendOk && (
                          <span
                            className="text-[7px] text-[#16a34a]"
                            style={MONO}
                          >
                            +EMA✓
                          </span>
                        )}
                      </div>

                      {/* STRIKE */}
                      <div className="px-2 py-2.5">
                        <div
                          className="text-[11px] font-bold"
                          style={{ ...MONO, color: dirColor }}
                        >
                          {a.strike} {a.direction}
                        </div>
                        <div className="text-[8px] text-[#94a3b8]" style={MONO}>
                          spot {a.spot?.toFixed(0)}
                        </div>
                      </div>

                      {/* ENTRY */}
                      <div
                        className="px-2 py-2.5 text-[12px] font-bold tabular-nums"
                        style={{ ...MONO, color: dirColor }}
                      >
                        ₹{a.rr?.entry?.toFixed(2) ?? "—"}
                      </div>

                      {/* CMP */}
                      <div className="px-2 py-2.5">
                        <div
                          className="text-[11px] font-bold tabular-nums"
                          style={{
                            ...MONO,
                            color:
                              a.status === "ACTIVE"
                                ? a.lastLtp >= a.rr?.entry
                                  ? "#16a34a"
                                  : "#e11d48"
                                : "#64748b",
                          }}
                        >
                          ₹{(a.lastLtp ?? a.rr?.entry)?.toFixed(2) ?? "—"}
                        </div>
                        {a.status === "ACTIVE" && a.lastLtp && (
                          <div
                            className="text-[8px]"
                            style={{
                              ...MONO,
                              color:
                                a.lastLtp >= a.rr?.entry
                                  ? "#16a34a"
                                  : "#e11d48",
                            }}
                          >
                            {a.lastLtp >= a.rr?.entry ? "+" : ""}
                            {(a.lastLtp - a.rr?.entry).toFixed(2)}
                          </div>
                        )}
                      </div>

                      {/* SL */}
                      <div
                        className="px-2 py-2.5 text-[11px] font-bold tabular-nums text-[#e11d48]"
                        style={MONO}
                      >
                        ₹{a.rr?.sl?.toFixed(2) ?? "—"}
                      </div>

                      {/* T1 */}
                      <div
                        className="px-2 py-2.5 text-[11px] font-bold tabular-nums text-[#b45309]"
                        style={MONO}
                      >
                        ₹{a.rr?.target1?.toFixed(2) ?? "—"}
                      </div>

                      {/* T2 */}
                      <div
                        className="px-2 py-2.5 text-[11px] font-bold tabular-nums text-[#16a34a]"
                        style={MONO}
                      >
                        ₹{a.rr?.target2?.toFixed(2) ?? "—"}
                      </div>

                      {/* STATUS + T1/T2 badges + progress bar */}
                      <div className="px-2 py-2.5">
                        <div className="flex items-center gap-1 mb-0.5">
                          <span className="text-[9px]">{stIcon}</span>
                          <span
                            className="text-[8px] font-bold"
                            style={{ ...MONO, color: stColor }}
                          >
                            {stLabel}
                          </span>
                        </div>
                        {/* T1 / T2 hit indicators */}
                        <div className="flex gap-1 mb-0.5">
                          <span
                            className="text-[7px] px-1 py-0.5 rounded-sm font-bold"
                            style={{
                              ...MONO,
                              background:
                                a.t1Hit || a.status === "TARGET"
                                  ? isDark
                                    ? "#052e16"
                                    : "#dcfce7"
                                  : isDark
                                    ? "#0f1923"
                                    : "#f1f5f9",
                              color:
                                a.t1Hit || a.status === "TARGET"
                                  ? "#15803d"
                                  : isDark
                                    ? "#4a6080"
                                    : "#94a3b8",
                            }}
                          >
                            T1{a.t1Hit || a.status === "TARGET" ? "✓" : "✗"}
                          </span>
                          <span
                            className="text-[7px] px-1 py-0.5 rounded-sm font-bold"
                            style={{
                              ...MONO,
                              background:
                                a.status === "TARGET"
                                  ? isDark
                                    ? "#052e16"
                                    : "#dcfce7"
                                  : isDark
                                    ? "#0f1923"
                                    : "#f1f5f9",
                              color:
                                a.status === "TARGET"
                                  ? "#15803d"
                                  : isDark
                                    ? "#4a6080"
                                    : "#94a3b8",
                            }}
                          >
                            T2{a.status === "TARGET" ? "✓" : "✗"}
                          </span>
                        </div>
                        {a.status === "ACTIVE" &&
                          (() => {
                            // T1 is at 66.7% of SL→T2 range
                            const t1Pct =
                              a.rr?.target2 - a.rr?.sl > 0
                                ? Math.min(
                                    ((a.rr?.target1 - a.rr?.sl) /
                                      (a.rr?.target2 - a.rr?.sl)) *
                                      100,
                                    100,
                                  )
                                : 67;
                            return (
                              <div className="h-1.5 bg-[#e2e8f0] rounded-full overflow-hidden w-full relative">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${fillPct}%`,
                                    background:
                                      fillPct >= 67
                                        ? "#16a34a"
                                        : fillPct >= 33
                                          ? "#f59e0b"
                                          : "#e11d48",
                                  }}
                                />
                                {/* T1 tick mark */}
                                <div
                                  className="absolute top-0 bottom-0 w-px bg-[#7c3aed] opacity-70"
                                  style={{ left: `${t1Pct}%` }}
                                />
                              </div>
                            );
                          })()}
                        {a.status !== "ACTIVE" && (
                          <div
                            className="text-[8px] font-bold"
                            style={{ ...MONO, color: stColor }}
                          >
                            {fmtLotPnl((a.currentPnL ?? 0) * LOT_QTY)}
                          </div>
                        )}
                      </div>

                      {/* P&L per unit + lot */}
                      <div className="px-2 py-2.5">
                        {/* per-unit */}
                        <div className="flex items-baseline gap-1">
                          <span
                            className="text-[11px] font-bold tabular-nums"
                            style={{ ...MONO, color: pnlColor }}
                          >
                            {pnlUp ? "+" : ""}₹
                            {a.currentPnL?.toFixed(2) ?? "0.00"}
                          </span>
                          <span
                            className="text-[7px] text-[#94a3b8]"
                            style={MONO}
                          >
                            unit
                          </span>
                        </div>
                        {/* lot P&L = unit × LOT_SIZE */}
                        <div className="flex items-baseline gap-1 mt-0.5">
                          <span
                            className="text-[12px] font-bold tabular-nums"
                            style={{ ...MONO, color: pnlColor }}
                          >
                            {fmtLotPnl((a.currentPnL ?? 0) * LOT_QTY)}
                          </span>
                          <span
                            className="text-[7px] font-bold"
                            style={{ ...MONO, color: pnlColor }}
                          >
                            ×{LOT_SIZE}
                          </span>
                        </div>
                        <div
                          className="text-[8px]"
                          style={{ ...MONO, color: pnlColor }}
                        >
                          {pnlUp ? "+" : ""}
                          {a.pnlPct?.toFixed(2) ?? "0.00"}%
                        </div>
                      </div>

                      {/* MAX PTS */}
                      <div className="px-2 py-2.5">
                        {(a.peakMove ?? 0) > 0 ? (
                          <div
                            className="text-[11px] font-bold tabular-nums text-[#7c3aed]"
                            style={MONO}
                          >
                            +{a.peakMove.toFixed(2)}
                          </div>
                        ) : (
                          <div
                            className="text-[9px] text-[#94a3b8]"
                            style={MONO}
                          >
                            —
                          </div>
                        )}
                      </div>

                      {/* Chart + watchlist */}
                      <div className="px-2 py-2.5 flex items-center justify-center gap-1 group">
                        {a.strike && a.direction && (
                          <button
                            onClick={() => { const t = a.leg?.token ?? resolveToken(a.strike, a.direction); if (t) onOpenChart(t, a.strike, a.direction as "CE" | "PE"); }}
                            title="Open chart"
                            className="transition-opacity flex-shrink-0 w-5 h-5 flex items-center justify-center rounded cursor-pointer"
                            style={{ color: dirColor, opacity: 0.7 }}
                          >
                            <CandleIcon color={dirColor} />
                          </button>
                        )}
                        {a.leg && a.status === "ACTIVE" && (
                          <button
                            onClick={() => onAddWatch(a.leg)}
                            title="Add to watchlist"
                            className="w-6 h-6 flex items-center justify-center rounded text-[11px] font-bold border cursor-pointer transition-all"
                            style={{
                              background: `${dirColor}15`,
                              borderColor: `${dirColor}50`,
                              color: dirColor,
                            }}
                          >
                            +
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Footer stats ── */}
      {tableAlerts.length > 0 && (
        <div
          className="hidden md:block flex-shrink-0 border-t border-[#cbd5e1] bg-white"
          style={{ gap: "1px" }}
        >
          {mode === "backtest" && histResults !== null && (
            <div
              className="px-5 py-1.5 bg-[#fef9ec] border-b border-[#fde68a] text-[8px] text-[#b45309]"
              style={MONO}
            >
              ◉ BACKTEST {histDate} · expiry {expiry} · all prices from
              historical candles · EOD = position open at 15:30
            </div>
          )}
          <div
            className="grid grid-cols-4 sm:grid-cols-7"
            style={{ gap: "1px", background: isDark ? "#1e2a3a" : "#cbd5e1" }}
          >
            {[
              {
                label: "TOTAL SIGNALS",
                val: `${tableAlerts.length}`,
                color: "#475569",
              },
              { label: "ACTIVE", val: `${active}`, color: "#0284c7" },
              { label: "TARGET HIT", val: `${wins}`, color: "#16a34a" },
              { label: "SL HIT", val: `${losses}`, color: "#e11d48" },
              { label: "EOD / OPEN", val: `${eod}`, color: "#b45309" },
              {
                label: "WIN RATE",
                val: wr ? `${wr}%` : "—",
                color: wr && Number(wr) >= 70 ? "#16a34a" : "#e11d48",
              },
              {
                label: `LOT P&L (${LOT_SIZE}×)`,
                val: tableAlerts.length > 0 ? fmtLotPnl(totalLotPnl) : "—",
                color: totalLotPnl >= 0 ? "#16a34a" : "#e11d48",
                sub:
                  active > 0
                    ? `realized ${fmtLotPnl(realizedLotPnl)}`
                    : undefined,
              },
            ].map(({ label, val, color, sub }: any) => (
              <div key={label} className="bg-white px-3 py-2.5">
                <div
                  className="text-[7px] tracking-[1.5px] text-[#64748b] uppercase mb-1"
                  style={MONO}
                >
                  {label}
                </div>
                <div
                  className="text-[15px] font-bold leading-tight"
                  style={{ ...MONO, color }}
                >
                  {val}
                </div>
                {sub && (
                  <div
                    className="text-[7px] text-[#94a3b8] mt-0.5"
                    style={MONO}
                  >
                    {sub}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── WATCHLIST ROW ────────────────────────────────────────────────────────────
function WatchlistRow({
  watched,
  candles3m: _candles3m,
  expiry,
  onRemove,
  onOpenChart,
  isDragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  watched: WatchedOption;
  candles3m: any[];
  expiry: string;
  onRemove: () => void;
  onOpenChart: (token: number, strike: number, type: "CE" | "PE") => void;
  isDragOver?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { leg } = watched;
  const ltp    = leg.ltp;
  const change = leg.ltpChange ?? 0;
  const openRef = ltp - change;
  const pct    = openRef !== 0 ? (change / Math.abs(openRef)) * 100 : 0;
  const pctUp  = pct >= 0;
  const pctClr = pctUp ? "#16a34a" : "#e11d48";
  const [logoErr, setLogoErr] = useState(false);

  // Detect equity stock: no expiry, strike=0, or tradingsymbol has no digits
  const isEquity = !expiry || leg.strike === 0 || !/\d/.test(leg.tradingsymbol ?? "");

  // ── Equity stock card ──────────────────────────────────────────────────────
  if (isEquity) {
    const sym = leg.tradingsymbol ?? "STOCK";
    const letter = sym[0]?.toUpperCase() ?? "S";
    const avatarColors = ["#0284c7","#16a34a","#7c3aed","#ea580c","#db2777","#0891b2","#b45309"];
    const avatarColor = avatarColors[letter.charCodeAt(0) % avatarColors.length];

    return (
      <div
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        onClick={() => onOpenChart(leg.token, leg.strike, leg.type)}
        className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all hover:opacity-90 select-none"
        style={{ background: isDark ? "#0d1420" : "#fff", border: `1px solid ${isDragOver ? "#0284c7" : isDark ? "#1e2a3a" : "#e2e8f0"}`, opacity: isDragOver ? 0.6 : 1 }}>
        {/* Drag handle */}
        <span className="text-[14px] flex-shrink-0 cursor-grab" style={{ color: "#94a3b8", lineHeight: 1 }}>⠿</span>

        {/* Stock logo / avatar */}
        <div className="w-11 h-11 rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center"
          style={{ border: "2px solid #e2e8f0", background: logoErr ? avatarColor : "#fff" }}>
          {logoErr ? (
            <span className="text-[13px] font-black text-white">{sym.slice(0, 2)}</span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`https://images.smallcase.com/smallplug-v2/200/${sym}.png`} alt={sym}
              onError={() => setLogoErr(true)} className="w-full h-full object-contain p-1" />
          )}
        </div>

        {/* Name + price */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-bold truncate" style={{ ...MONO, color: isDark ? "#e2e8f0" : "#1e293b" }}>{sym}</span>
            <span className="text-[8px] px-1 py-0.5 rounded font-bold flex-shrink-0"
              style={{ background: "#f1f5f9", color: "#64748b" }}>{watched.exchange || "NSE"}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[12px] font-bold tabular-nums" style={{ ...MONO, color: isDark ? "#e2e8f0" : "#1e293b" }}>
              ₹{ltp.toFixed(2)}
            </span>
            <span className="text-[10px] font-bold" style={{ ...MONO, color: pctClr }}>
              {pctUp ? "▲" : "▼"}{change >= 0 ? "+" : ""}{change.toFixed(2)} ({Math.abs(pct).toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* Remove */}
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="w-6 h-6 flex items-center justify-center rounded-full cursor-pointer transition-colors hover:opacity-70 flex-shrink-0"
          style={{ background: isDark ? "#1e293b" : "#f1f5f9", color: "#94a3b8" }}>
          <IconX size={11} />
        </button>
      </div>
    );
  }

  // ── Options card ───────────────────────────────────────────────────────────
  const isCE    = leg.type === "CE";
  const dirClr  = isCE ? "#0284c7" : "#e11d48";
  const underlying = (leg.tradingsymbol ?? "").match(/^[A-Z&]+/)?.[0] ?? "NIFTY";
  const isSensex = underlying === "SENSEX" || underlying === "BSX";
  const logoSrc = isSensex ? "/sensex-logo.avif" : "/nifty-logo.png";
  const MNAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const expDate = new Date(expiry + "T00:00:00Z");
  const dateStr = `${expDate.getUTCDate()} ${MNAMES[expDate.getUTCMonth()]}`;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={() => onOpenChart(leg.token, leg.strike, leg.type)}
      className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all hover:opacity-90 select-none"
      style={{ background: isDark ? "#0d1420" : "#fff", border: `1px solid ${isDragOver ? "#0284c7" : isDark ? "#1e2a3a" : "#e2e8f0"}`, opacity: isDragOver ? 0.6 : 1 }}>
      {/* Drag handle */}
      <span className="text-[14px] flex-shrink-0 cursor-grab" style={{ color: "#94a3b8", lineHeight: 1 }}>⠿</span>

      {/* Index logo */}
      <div className="w-11 h-11 rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center"
        style={{ border: `2px solid ${dirClr}`, background: "#111" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} alt={isSensex ? "SENSEX" : "NIFTY 50"} className="w-full h-full object-cover" />
      </div>

      {/* Symbol + price */}
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-bold truncate" style={{ ...MONO, color: isDark ? "#e2e8f0" : "#1e293b" }}>
          {underlying} {dateStr} ₹{leg.strike} {isCE ? "Call" : "Put"}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[12px] font-bold tabular-nums" style={{ ...MONO, color: isDark ? "#e2e8f0" : "#1e293b" }}>
            ₹{ltp.toFixed(2)}
          </span>
          <span className="text-[10px] font-bold" style={{ ...MONO, color: pctClr }}>
            {pctUp ? "▲" : "▼"}{Math.abs(pct).toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Remove */}
      <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="w-6 h-6 flex items-center justify-center rounded-full cursor-pointer transition-colors hover:opacity-70 flex-shrink-0"
        style={{ background: isDark ? "#1e293b" : "#f1f5f9", color: "#94a3b8" }}>
        <IconX size={11} />
      </button>
    </div>
  );
}

// ─── OHLC helpers ─────────────────────────────────────────────────────────────
function getTradingDays(n: number): string[] {
  const days: string[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (days.length < n) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      days.push(`${y}-${m}-${dd}`);
    }
    d.setDate(d.getDate() - 1);
  }
  return days;
}

function fmtTradingDay(iso: string): string {
  const [y, mo, dd] = iso.split("-").map(Number);
  const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const MONTHS = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  const day = new Date(y, mo - 1, dd).getDay();
  return `${String(dd).padStart(2, "0")} ${MONTHS[mo - 1]} ${y}  ·  ${DAYS[day]}`;
}

// ─── OHLC CSV TAB ─────────────────────────────────────────────────────────────
function OhlcTab({
  expiry,
  rows,
  ohlcDate,
  setOhlcDate,
  ohlcCE,
  setOhlcCE,
  ohlcPE,
  setOhlcPE,
  busy,
  setBusy,
}: {
  expiry: string;
  rows: OptionsRow[];
  ohlcDate: string;
  setOhlcDate: (d: string) => void;
  ohlcCE: { token: number; strike: number } | null;
  setOhlcCE: (v: { token: number; strike: number } | null) => void;
  ohlcPE: { token: number; strike: number } | null;
  setOhlcPE: (v: { token: number; strike: number } | null) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
}) {
  type HistRow = {
    strike: number;
    isATM: boolean;
    ce: { token: number; open: number | null };
    pe: { token: number; open: number | null };
  };
  const [histData, setHistData] = useState<{
    spot: number;
    atm: number;
    rows: HistRow[];
  } | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);

  const tradingDays = useMemo(() => getTradingDays(30), []);

  const inRange = (p: number | null | undefined) =>
    p != null && p >= 200 && p <= 300;

  // Single fetch: historical NIFTY spot → historical ATM → ±15 strikes → 9:15 prices
  // All done server-side so the correct historical ATM is always used.
  useEffect(() => {
    if (!ohlcDate || !expiry) return;
    if (isDemoMode) {
      setHistData({
        spot: 0,
        atm: 0,
        rows: rows.map((r) => ({
          strike: r.strike,
          isATM: r.isATM,
          ce: { token: r.ce.token, open: null },
          pe: { token: r.pe.token, open: null },
        })),
      });
      return;
    }
    setHistData(null);
    setOhlcCE(null);
    setOhlcPE(null);
    setLoadingHist(true);
    optionsApi
      .historicalOpenPrices(ohlcDate, expiry)
      .then((d: any) => {
        setHistData(d);
        // Auto-select inside .then() — d is the fresh data, no stale-closure risk
        const bCE = d.rows
          .filter((r: HistRow) => inRange(r.ce.open))
          .sort(
            (a: HistRow, b: HistRow) => (b.ce.open ?? 0) - (a.ce.open ?? 0),
          )[0];
        const bPE = d.rows
          .filter((r: HistRow) => inRange(r.pe.open))
          .sort(
            (a: HistRow, b: HistRow) => (b.pe.open ?? 0) - (a.pe.open ?? 0),
          )[0];
        if (bCE) setOhlcCE({ token: bCE.ce.token, strike: bCE.strike });
        if (bPE) setOhlcPE({ token: bPE.pe.token, strike: bPE.strike });
      })
      .catch(() => {})
      .finally(() => setLoadingHist(false));
  }, [ohlcDate, expiry]);

  const displayRows = histData?.rows ?? [];

  // Derived best-range rows (for banner + ★ label in table)
  const bestCERow = displayRows
    .filter((r) => inRange(r.ce.open))
    .sort((a, b) => (b.ce.open ?? 0) - (a.ce.open ?? 0))[0];
  const bestPERow = displayRows
    .filter((r) => inRange(r.pe.open))
    .sort((a, b) => (b.pe.open ?? 0) - (a.pe.open ?? 0))[0];

  const hasPrices =
    displayRows.length > 0 &&
    displayRows.some((r) => r.ce.open != null || r.pe.open != null);

  function symbol(strike: number, type: "CE" | "PE") {
    const exp = new Date(expiry);
    const MONTHS = [
      "JAN",
      "FEB",
      "MAR",
      "APR",
      "MAY",
      "JUN",
      "JUL",
      "AUG",
      "SEP",
      "OCT",
      "NOV",
      "DEC",
    ];
    const ddmmmyy = `${String(exp.getUTCDate()).padStart(2, "0")}${MONTHS[exp.getUTCMonth()]}${String(exp.getUTCFullYear()).slice(-2)}`;
    return `NIFTY${ddmmmyy}${strike}${type}`;
  }

  async function downloadOne(token: number, strike: number, type: "CE" | "PE") {
    const d = (await optionsApi.candles(token, ohlcDate, "minute")) as {
      rows: any[];
    };
    const filename = `${ohlcDate}_${symbol(strike, type)}.csv`;
    const header = "Date,Open,High,Low,Close,Volume,OI,RSI(14)\n";
    const body = d.rows
      .map(
        (r) =>
          `${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume},${r.oi ?? ""},${r.rsi14 ?? ""}`,
      )
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownload() {
    if (!ohlcCE && !ohlcPE) {
      alert("Select at least one CE or PE");
      return;
    }
    setBusy(true);
    try {
      if (ohlcCE) await downloadOne(ohlcCE.token, ohlcCE.strike, "CE");
      if (ohlcPE) await downloadOne(ohlcPE.token, ohlcPE.strike, "PE");
    } catch (e: any) {
      alert("Download failed: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  // ── GRID COLUMNS: [TIME 44px | CE 1fr | STRIKE 68px | PE 1fr | TIME 44px]
  const GRID = "44px 1fr 68px 1fr 44px";

  // Small time-corner cell (appears on both far sides of every row)
  function TimeCorner({ side }: { side: "CE" | "PE" }) {
    return (
      <div
        className={`flex flex-col items-center justify-center py-2 gap-0.5
        ${side === "CE" ? "bg-[#f0f7ff]" : "bg-[#fff0f3]"}`}
      >
        <div
          className="text-[7px] font-bold tracking-[0.5px]"
          style={{ ...MONO, color: side === "CE" ? "#0284c7" : "#e11d48" }}
        >
          {side}
        </div>
        <div className="text-[8px] font-bold text-[#64748b]" style={MONO}>
          9:15
        </div>
        <div className="text-[6px] text-[#94a3b8]" style={MONO}>
          AM
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto flex items-start justify-center pt-6 px-4 pb-8">
      <div className="w-full max-w-[680px] space-y-4">
        {/* ── Header: title + 9:15 AM ──── 3:30 PM ── */}
        <div className="bg-white border border-[#cbd5e1] rounded-md shadow-sm overflow-hidden">
          <div
            className="px-4 sm:px-5 py-3 border-b border-[#cbd5e1]"
            style={{ background: "rgba(2,132,199,0.04)" }}
          >
            <div className="flex items-center justify-between gap-2">
              {/* Left corner: 9:15 AM */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div className="px-2 py-1.5 rounded bg-[#16a34a]/10 border border-[#16a34a]/30">
                  <div
                    className="text-[7px] text-[#16a34a]/70 tracking-[1px] uppercase leading-none mb-0.5"
                    style={MONO}
                  >
                    OPEN
                  </div>
                  <div
                    className="text-[12px] sm:text-[14px] font-bold text-[#16a34a] leading-none"
                    style={MONO}
                  >
                    9:15 AM
                  </div>
                </div>
                <div className="hidden sm:block text-[#cbd5e1]" style={MONO}>
                  ────
                </div>
              </div>

              {/* Center: title */}
              <div className="text-center min-w-0">
                <div
                  className="text-[13px] sm:text-[15px] tracking-[2px] text-[#0284c7]"
                  style={BEBAS}
                >
                  OHLC CSV DOWNLOAD
                </div>
                <div
                  className="text-[7px] sm:text-[8px] text-[#64748b] truncate"
                  style={MONO}
                >
                  {histData
                    ? `ATM ${histData.atm} · ${displayRows.length} strikes`
                    : `${displayRows.length} strikes`}{" "}
                  · OHLCV+OI+RSI
                </div>
              </div>

              {/* Right corner: 3:30 PM */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div className="hidden sm:block text-[#cbd5e1]" style={MONO}>
                  ────
                </div>
                <div className="px-2 py-1.5 rounded bg-[#e11d48]/10 border border-[#e11d48]/30">
                  <div
                    className="text-[7px] text-[#e11d48]/70 tracking-[1px] uppercase leading-none mb-0.5"
                    style={MONO}
                  >
                    CLOSE
                  </div>
                  <div
                    className="text-[12px] sm:text-[14px] font-bold text-[#e11d48] leading-none"
                    style={MONO}
                  >
                    3:30 PM
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Date dropdown */}
          <div className="px-5 py-3">
            <div
              className="text-[8px] text-[#64748b] tracking-[1.5px] uppercase mb-2"
              style={MONO}
            >
              Select Date — Last 30 Trading Days
            </div>
            <Select value={ohlcDate} onValueChange={setOhlcDate}>
              <SelectTrigger
                className="w-full border-[#cbd5e1] bg-[#f8fafc] text-[11px] h-9"
                style={MONO}
              >
                <SelectValue placeholder="Select date" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {tradingDays.map((d) => (
                  <SelectItem
                    key={d}
                    value={d}
                    className="text-[11px]"
                    style={MONO}
                  >
                    {fmtTradingDay(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Top opening price banner: selected day's best CE + PE ── */}
        {hasPrices && (
          <div className="bg-white border border-[#cbd5e1] rounded-md shadow-sm overflow-hidden">
            <div className="px-4 py-2 border-b border-[#cbd5e1] bg-[#f8fafc]">
              <div
                className="text-[8px] font-bold tracking-[1.5px] text-[#475569] uppercase"
                style={MONO}
              >
                ★ TOP OPENING PRICE · {fmtTradingDay(ohlcDate)} · ₹200–₹300 SCAN
                RANGE
              </div>
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr]">
              {/* CE best */}
              <div className={`px-5 py-3 ${bestCERow ? "" : "opacity-40"}`}>
                <div
                  className="text-[8px] text-[#94a3b8] tracking-[1px] uppercase mb-1"
                  style={MONO}
                >
                  CE · Best Opening
                </div>
                {bestCERow ? (
                  <>
                    <div
                      className="text-[17px] font-bold text-[#0284c7]"
                      style={MONO}
                    >
                      {bestCERow.strike} CE
                    </div>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-[9px] text-[#64748b]" style={MONO}>
                        9:15 AM
                      </span>
                      <span
                        className="text-[15px] font-bold text-[#16a34a]"
                        style={MONO}
                      >
                        ₹{bestCERow.ce.open}
                      </span>
                      <span
                        className="text-[8px] font-bold text-[#16a34a]"
                        style={MONO}
                      >
                        ★ BEST
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-[9px] text-[#94a3b8]" style={MONO}>
                    No CE in ₹200–₹300 range
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="w-px bg-[#f1f5f9] my-2" />

              {/* PE best */}
              <div
                className={`px-5 py-3 text-right ${bestPERow ? "" : "opacity-40"}`}
              >
                <div
                  className="text-[8px] text-[#94a3b8] tracking-[1px] uppercase mb-1"
                  style={MONO}
                >
                  PE · Best Opening
                </div>
                {bestPERow ? (
                  <>
                    <div
                      className="text-[17px] font-bold text-[#e11d48]"
                      style={MONO}
                    >
                      {bestPERow.strike} PE
                    </div>
                    <div className="flex items-baseline gap-2 justify-end mt-0.5">
                      <span
                        className="text-[8px] font-bold text-[#16a34a]"
                        style={MONO}
                      >
                        ★ BEST
                      </span>
                      <span
                        className="text-[15px] font-bold text-[#16a34a]"
                        style={MONO}
                      >
                        ₹{bestPERow.pe.open}
                      </span>
                      <span className="text-[9px] text-[#64748b]" style={MONO}>
                        9:15 AM
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-[9px] text-[#94a3b8]" style={MONO}>
                    No PE in ₹200–₹300 range
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Strike table: TIME | CE | STRIKE | PE | TIME ── */}
        <div className="bg-white border border-[#cbd5e1] rounded-md shadow-sm overflow-hidden">
          {/* Table header */}
          <div
            className="grid border-b border-[#cbd5e1] bg-[#f1f5f9]"
            style={{ gridTemplateColumns: GRID }}
          >
            <div
              className="py-2 text-center text-[7px] font-bold tracking-[1px] text-[#0284c7] uppercase bg-[#e8f4ff] border-r border-[#cbd5e1]"
              style={MONO}
            >
              TIME
            </div>
            <div
              className="px-3 py-2 text-right text-[8px] font-bold tracking-[1.5px] text-[#0284c7] uppercase"
              style={MONO}
            >
              CE · 9:15 AM OPENING
            </div>
            <div
              className="py-2 text-center text-[8px] tracking-[1.5px] text-[#64748b] uppercase border-x border-[#cbd5e1] bg-[#e8eef5]"
              style={MONO}
            >
              STRIKE
            </div>
            <div
              className="px-3 py-2 text-left text-[8px] font-bold tracking-[1.5px] text-[#e11d48] uppercase"
              style={MONO}
            >
              PE · 9:15 AM OPENING
            </div>
            <div
              className="py-2 text-center text-[7px] font-bold tracking-[1px] text-[#e11d48] uppercase bg-[#fff0f3] border-l border-[#cbd5e1]"
              style={MONO}
            >
              TIME
            </div>
          </div>

          {/* Loading state */}
          {loadingHist && (
            <div className="flex items-center justify-center gap-2 py-6 border-b border-[#f1f5f9]">
              <div className="w-4 h-4 border-2 border-[#0284c7]/20 border-t-[#0284c7] rounded-full animate-spin" />
              <span className="text-[9px] text-[#94a3b8]" style={MONO}>
                Loading {fmtTradingDay(ohlcDate)} historical strikes…
              </span>
            </div>
          )}

          {/* Strike rows */}
          <div className="max-h-[400px] overflow-y-auto divide-y divide-[#f8fafc]">
            {displayRows.map((r) => {
              const ceP = r.ce.open;
              const peP = r.pe.open;
              const ceOk = inRange(ceP);
              const peOk = inRange(peP);
              const ceSel = ohlcCE?.token === r.ce.token;
              const peSel = ohlcPE?.token === r.pe.token;
              const isBestCE = bestCERow?.strike === r.strike;
              const isBestPE = bestPERow?.strike === r.strike;
              const rowBg = r.isATM ? "bg-[#eff6ff]" : "bg-white";

              return (
                <div
                  key={r.strike}
                  className={`grid ${rowBg} transition-colors`}
                  style={{ gridTemplateColumns: GRID }}
                >
                  {/* Left TIME corner */}
                  <TimeCorner side="CE" />

                  {/* CE price — clickable */}
                  <button
                    onClick={() =>
                      setOhlcCE(
                        ceSel ? null : { token: r.ce.token, strike: r.strike },
                      )
                    }
                    className={`px-4 py-3 text-right cursor-pointer transition-colors border-r border-[#f1f5f9]
                      ${
                        ceSel
                          ? "bg-[#0284c7]/10 ring-1 ring-inset ring-[#0284c7]/40"
                          : ceOk
                            ? "hover:bg-[#f0fdf4]"
                            : "hover:bg-[#f8fafc]"
                      }`}
                  >
                    {ceP != null ? (
                      <div>
                        <div
                          className={`text-[13px] font-bold tabular-nums leading-tight
                          ${ceSel ? "text-[#0284c7]" : ceOk ? "text-[#16a34a]" : "text-[#334155]"}`}
                          style={MONO}
                        >
                          {ceSel ? "✓ " : ""}₹{ceP}
                        </div>
                        <div
                          className="text-[7px] mt-0.5 font-semibold"
                          style={MONO}
                        >
                          {ceSel ? (
                            <span className="text-[#0284c7]">SELECTED</span>
                          ) : isBestCE ? (
                            <span className="text-[#16a34a]">
                              ★ BEST ₹200–₹300
                            </span>
                          ) : ceOk ? (
                            <span className="text-[#16a34a]">✓ IN RANGE</span>
                          ) : (
                            <span className="text-[#94a3b8]">
                              {r.strike} CE
                            </span>
                          )}
                        </div>
                      </div>
                    ) : loadingHist ? (
                      <span className="text-[9px] text-[#e2e8f0]" style={MONO}>
                        …
                      </span>
                    ) : (
                      <span className="text-[9px] text-[#e2e8f0]" style={MONO}>
                        —
                      </span>
                    )}
                  </button>

                  {/* Strike — center */}
                  <div
                    className={`py-3 text-center border-x border-[#e2e8f0] flex flex-col items-center justify-center
                    ${r.isATM ? "bg-[#dbeafe]" : "bg-[#f8fafc]"}`}
                  >
                    <div
                      className={`text-[12px] font-bold tabular-nums leading-none
                      ${r.isATM ? "text-[#0284c7]" : "text-[#1e293b]"}`}
                      style={MONO}
                    >
                      {r.strike}
                    </div>
                    {r.isATM && (
                      <div
                        className="text-[6px] text-[#0284c7]/60 tracking-[1px] mt-0.5 font-bold"
                        style={MONO}
                      >
                        ATM
                      </div>
                    )}
                  </div>

                  {/* PE price — clickable */}
                  <button
                    onClick={() =>
                      setOhlcPE(
                        peSel ? null : { token: r.pe.token, strike: r.strike },
                      )
                    }
                    className={`px-4 py-3 text-left cursor-pointer transition-colors border-l border-[#f1f5f9]
                      ${
                        peSel
                          ? "bg-[#e11d48]/10 ring-1 ring-inset ring-[#e11d48]/40"
                          : peOk
                            ? "hover:bg-[#f0fdf4]"
                            : "hover:bg-[#f8fafc]"
                      }`}
                  >
                    {peP != null ? (
                      <div>
                        <div
                          className={`text-[13px] font-bold tabular-nums leading-tight
                          ${peSel ? "text-[#e11d48]" : peOk ? "text-[#16a34a]" : "text-[#334155]"}`}
                          style={MONO}
                        >
                          {peSel ? "✓ " : ""}₹{peP}
                        </div>
                        <div
                          className="text-[7px] mt-0.5 font-semibold"
                          style={MONO}
                        >
                          {peSel ? (
                            <span className="text-[#e11d48]">SELECTED</span>
                          ) : isBestPE ? (
                            <span className="text-[#16a34a]">
                              ★ BEST ₹200–₹300
                            </span>
                          ) : peOk ? (
                            <span className="text-[#16a34a]">✓ IN RANGE</span>
                          ) : (
                            <span className="text-[#94a3b8]">
                              {r.strike} PE
                            </span>
                          )}
                        </div>
                      </div>
                    ) : loadingHist ? (
                      <span className="text-[9px] text-[#e2e8f0]" style={MONO}>
                        …
                      </span>
                    ) : (
                      <span className="text-[9px] text-[#e2e8f0]" style={MONO}>
                        —
                      </span>
                    )}
                  </button>

                  {/* Right TIME corner */}
                  <TimeCorner side="PE" />
                </div>
              );
            })}
          </div>

          <div className="px-4 py-2 border-t border-[#f1f5f9] bg-[#fafafa] flex items-center justify-between">
            <span className="text-[8px] text-[#94a3b8]" style={MONO}>
              {displayRows.length} strikes · Green = ₹200–₹300 · ★ = best
              opening price · Click to select/deselect
            </span>
            {loadingHist && (
              <div className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 border border-[#0284c7]/30 border-t-[#0284c7] rounded-full animate-spin" />
                <span className="text-[7px] text-[#94a3b8]" style={MONO}>
                  fetching historical prices…
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Selected files preview ── */}
        {(ohlcCE || ohlcPE) && (
          <div className="grid grid-cols-2 gap-3">
            {ohlcCE ? (
              <div className="px-4 py-2.5 rounded-md border border-[#0284c7]/30 bg-[#0284c7]/5">
                <div className="flex items-center gap-1.5 mb-1">
                  <span
                    className="text-[7px] font-bold text-[#0284c7] uppercase tracking-[1px]"
                    style={MONO}
                  >
                    CE FILE
                  </span>
                  <span className="text-[7px] text-[#94a3b8]" style={MONO}>
                    9:15 AM → 3:30 PM
                  </span>
                </div>
                <div
                  className="text-[9px] text-[#0284c7] font-bold truncate"
                  style={MONO}
                >
                  {ohlcDate}_{symbol(ohlcCE.strike, "CE")}.csv
                </div>
                <div className="text-[8px] text-[#64748b] mt-0.5" style={MONO}>
                  Open ₹
                  {displayRows.find((r) => r.ce.token === ohlcCE.token)?.ce
                    .open ?? "—"}{" "}
                  · Minute candles
                </div>
              </div>
            ) : (
              <div />
            )}
            {ohlcPE ? (
              <div className="px-4 py-2.5 rounded-md border border-[#e11d48]/30 bg-[#e11d48]/5">
                <div className="flex items-center gap-1.5 mb-1">
                  <span
                    className="text-[7px] font-bold text-[#e11d48] uppercase tracking-[1px]"
                    style={MONO}
                  >
                    PE FILE
                  </span>
                  <span className="text-[7px] text-[#94a3b8]" style={MONO}>
                    9:15 AM → 3:30 PM
                  </span>
                </div>
                <div
                  className="text-[9px] text-[#e11d48] font-bold truncate"
                  style={MONO}
                >
                  {ohlcDate}_{symbol(ohlcPE.strike, "PE")}.csv
                </div>
                <div className="text-[8px] text-[#64748b] mt-0.5" style={MONO}>
                  Open ₹
                  {displayRows.find((r) => r.pe.token === ohlcPE.token)?.pe
                    .open ?? "—"}{" "}
                  · Minute candles
                </div>
              </div>
            ) : (
              <div />
            )}
          </div>
        )}

        {/* ── Download button ── */}
        <button
          onClick={handleDownload}
          disabled={busy || (!ohlcCE && !ohlcPE)}
          className="w-full py-3.5 text-[12px] font-bold tracking-[3px] rounded-md cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            ...MONO,
            background: busy ? "rgba(2,132,199,0.15)" : "rgba(2,132,199,0.1)",
            border: "1.5px solid #0284c7",
            color: "#0284c7",
          }}
        >
          {busy ? "DOWNLOADING…" : "↓  DOWNLOAD CSV  (9:15 AM – 3:30 PM)"}
        </button>

        <div className="text-[8px] text-[#94a3b8] text-center" style={MONO}>
          Each selected leg → 1 CSV file · Full day minute candles · OHLCV + OI
          + RSI(14)
        </div>
      </div>
    </div>
  );
}

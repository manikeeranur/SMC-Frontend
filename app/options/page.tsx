"use client";

import { useState, useEffect, useCallback, useRef, Suspense, useMemo } from "react";
import { createChart, CandlestickSeries, LineSeries, HistogramSeries } from "lightweight-charts";
import { useSearchParams, useRouter } from "next/navigation";
import { generateChain, getNiftyExpiries } from "@/lib/demoOptions";
import {
  calcRR, calcPnL, calcMaxPain, calcPCR,
  fmtOI, getATM,
  type OptionsChainData, type OptionsRow, type OptionLeg,
  type WatchedOption,
} from "@/lib/options";
import { smcApi, optionsApi, authApi, createWS, isDemoMode, AuthError } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const MONO  = { fontFamily: "'Space Mono', monospace" } as const;
const BEBAS = { fontFamily: "'Bebas Neue', sans-serif" } as const;

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span className="text-[8px] px-1.5 py-0.5 rounded-sm font-bold tracking-[1px]"
      style={{ ...MONO, background:`${color}22`, color, border:`1px solid ${color}44` }}>
      {label}
    </span>
  );
}

// ─── Inner page (uses useSearchParams — must be inside Suspense) ───────────────
function OptionsPageInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const kiteStatus   = searchParams.get("kite");
  const kiteUser     = searchParams.get("user") ?? "";
  const kiteErrMsg   = searchParams.get("msg")  ?? "";

  const [expiries, setExpiries] = useState<string[]>(getNiftyExpiries());
  const [expiry, setExpiry]           = useState("");
  const [data,   setData]             = useState<OptionsChainData | null>(null);
  const [loading, setLoading]         = useState(false);
  const [strikeRange] = useState<5|10|15>(15);
  const [live,   setLive]             = useState(true);
  const [activeTab, setActiveTab]     = useState<"chain"|"smc"|"watchlist"|"ohlc">("chain");
  const [watchlist, setWatchlist]     = useState<WatchedOption[]>([]);
  const [smcAlerts,    setSmcAlerts]    = useState<any[]>([]);
  const [smcWinRate,   setSmcWinRate]   = useState<number|null>(null);
  const [smcStatus,    setSmcStatus]    = useState<{scanActive:boolean;lastScanAt:string|null;wins:number;losses:number}|null>(null);
  const [smcBusy,      setSmcBusy]      = useState(false);
  const [histDate,     setHistDate]     = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  });
  const [histBusy,     setHistBusy]     = useState(false);
  const [histErr,      setHistErr]      = useState("");
  const [histResults,  setHistResults]  = useState<any[] | null>(null);
  const [dragOver,   setDragOver]   = useState<number|null>(null);
  const [candles3m,  setCandles3m]  = useState<Record<number, any[]>>({});
  const dragIdxRef = useRef<number|null>(null);
  const [authenticated, setAuthenticated] = useState(isDemoMode);
  const [liveUser, setLiveUser]       = useState(kiteUser);
  const [hydrated, setHydrated]       = useState(false);
  const [ohlcDate, setOhlcDate]       = useState(() => new Date().toISOString().split("T")[0]);
  const [ohlcCE,   setOhlcCE]         = useState<{token:number; strike:number} | null>(null);
  const [ohlcPE,   setOhlcPE]         = useState<{token:number; strike:number} | null>(null);
  const [ohlcBusy, setOhlcBusy]       = useState(false);

  // Restore all persisted state after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    if (!isDemoMode && localStorage.getItem("kite_auth") === "1") {
      setAuthenticated(true);
      const u = localStorage.getItem("kite_user");
      if (u) setLiveUser(u);
    }
    try {
      const wl = localStorage.getItem("kite_watchlist");
      if (wl) setWatchlist(JSON.parse(wl));
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem("kite_watchlist", JSON.stringify(watchlist)); } catch {}
  }, [watchlist, hydrated]);


  const tickRef      = useRef<ReturnType<typeof setInterval>>();
  // 1-min candle closes per option token → for RSI(14) on watchlist
  const priceHistRef = useRef<Record<number, { closes: number[]; lastKey: number }>>({});
  // 6-min OI/Vol snapshot per token → ratio = delta-OI / delta-Volume every 6 minutes
  const oiVolHistRef = useRef<Record<number, { snapOI: number; snapVol: number; lastKey: number; ratio: number }>>({});

  // ── Fetch live expiry dates from backend ────────────────────────────────────
  useEffect(() => {
    if (isDemoMode) return;
    optionsApi.expiries().then(d => {
      if (d.expiries?.length) {
        setExpiries(d.expiries);
        setExpiry(d.expiries[0]);
      }
    }).catch(() => {});
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
      return;
    }
    authApi.status().then(d => {
      setAuthenticated(d.authenticated);
      if (!d.authenticated) {
        localStorage.removeItem("kite_auth");
        localStorage.removeItem("kite_user");
      }
    }).catch(() => setAuthenticated(false));
  }, [kiteStatus, kiteUser]);

  useEffect(() => { if (isDemoMode && expiries.length && !expiry) setExpiry(expiries[0]); }, [expiries, expiry]);


  // ── WebSocket ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isDemoMode || !authenticated) return;
    const ws = createWS((msg) => {
      if (msg.type === "scan_result" && msg.active) { setActiveTab("smc"); }
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
        oiVolHistRef.current[token] = { snapOI: oi, snapVol: volume, lastKey: key,
          ratio: volume > 0 ? +(oi / volume).toFixed(1) : 0 };
      } else if (key !== h.lastKey) {
        // New 6-min window: ratio = delta-OI / delta-Volume
        const dVol = volume - h.snapVol;
        const dOI  = oi - h.snapOI;
        const ratio = dVol > 0 ? +(dOI / dVol).toFixed(1) : (dOI !== 0 ? 999 : 0);
        oiVolHistRef.current[token] = { snapOI: oi, snapVol: volume, lastKey: key, ratio };
      }
    }

    // ── DEMO MODE ─────────────────────────────────────────────────────────
    if (isDemoMode) {
      const d = generateChain(expiry);
      setData(d);
      setWatchlist(prev => prev.map(w => {
        const row    = d.rows.find(r => r.strike === w.leg.strike);
        const newLeg = w.leg.type === "CE" ? row?.ce : row?.pe;
        const current = newLeg?.ltp ?? w.leg.ltp;
        trackCandle(w.leg.token, current);
        if (newLeg) trackOIVol(w.leg.token, newLeg.oi, newLeg.volume);
        const { pnl, pct, status } = calcPnL(current, w.rr);
        return { ...w, leg: newLeg ?? w.leg, currentPnL: pnl, pnlPct: pct,
          status: w.status !== "ACTIVE" ? w.status : status };
      }));
      return;
    }

    // ── LIVE MODE ─────────────────────────────────────────────────────────
    if (!authenticated) return;
    try {
      setLoading(true);
      const d = await optionsApi.chain(expiry, strikeRange) as OptionsChainData;
      setData(d);
      setWatchlist(prev => prev.map(w => {
        const row    = d.rows.find(r => r.strike === w.leg.strike);
        const newLeg = w.leg.type === "CE" ? row?.ce : row?.pe;
        const current = newLeg?.ltp ?? w.leg.ltp;
        trackCandle(w.leg.token, current);
        if (newLeg) trackOIVol(w.leg.token, newLeg.oi, newLeg.volume);
        const { pnl, pct, status } = calcPnL(current, w.rr);
        return { ...w, leg: newLeg ?? w.leg, currentPnL: pnl, pnlPct: pct,
          status: w.status !== "ACTIVE" ? w.status : status };
      }));
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

  useEffect(() => { if (expiry && (isDemoMode || authenticated)) refresh(); }, [expiry, refresh, authenticated]);

  useEffect(() => {
    const interval = isDemoMode ? 2000 : 5000;
    if (live) tickRef.current = setInterval(refresh, interval);
    else clearInterval(tickRef.current);
    return () => clearInterval(tickRef.current);
  }, [live, refresh]);

  // ── SMC alerts fetch + manual trigger ─────────────────────────────────────
  async function handleLogout() {
    try { await authApi.logout(); } catch {}
    localStorage.removeItem("kite_auth");
    localStorage.removeItem("kite_user");
    setAuthenticated(false);
    setLiveUser("");
  }

  async function fetchSMCAlerts() {
    if (!expiry || isDemoMode || !authenticated) return;
    try {
      const r = await smcApi.alerts(expiry) as any;
      setSmcAlerts(r.alerts ?? []);
      setSmcWinRate(r.winRate ?? null);
    } catch {}
  }

  async function triggerSMCScan() {
    if (!expiry || isDemoMode || !authenticated) return;
    setSmcBusy(true);
    try {
      await smcApi.scan(expiry);
      setTimeout(fetchSMCAlerts, 2000); // refresh after 2s
    } catch {}
    finally { setSmcBusy(false); }
  }

  async function runHistoricalSMC() {
    if (!expiry || isDemoMode || !authenticated) return;
    setHistBusy(true);
    setHistErr("");
    setHistResults(null);
    try {
      const r = await smcApi.historical(histDate, expiry) as any;
      setHistResults(r.results ?? []);
      // also update winRate display from historical result
      if (r.winRate !== null && r.winRate !== undefined) setSmcWinRate(r.winRate);
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
    const t = setInterval(fetchSMCAlerts, 60_000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, expiry, authenticated]);

  // Fetch SMC status every 30s
  useEffect(() => {
    if (isDemoMode || !authenticated) return;
    const tick = () => smcApi.status().then((s: any) => setSmcStatus(s)).catch(() => {});
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [authenticated]);

  const watchlistTokens = new Set(watchlist.map(w => w.leg.token));

  // ── Fetch 3-min candles for a watchlist token ──────────────────────────────
  async function fetchCandles3m(token: number) {
    if (isDemoMode || !authenticated) return;
    try {
      const today = new Date().toISOString().split("T")[0];
      const { rows } = await optionsApi.candles(token, today, "3minute") as any;
      setCandles3m(prev => ({ ...prev, [token]: rows ?? [] }));
    } catch { setCandles3m(prev => ({ ...prev, [token]: [] })); }
  }

  // Refresh 3m candles for all watchlist items every 3 minutes
  useEffect(() => {
    const ids = watchlist.map(w => w.leg.token);
    ids.forEach(t => fetchCandles3m(t));
    const timer = setInterval(() => ids.forEach(t => fetchCandles3m(t)), 3 * 60 * 1000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlist.map(w => w.leg.token).join(","), authenticated]);

  function addToWatch(leg: OptionLeg) {
    if (watchlist.find(w => w.leg.token === leg.token)) return;
    const rr = calcRR(leg.ltp, data?.atmIV ?? 15);
    setWatchlist(prev => [{
      leg, entryPrice:leg.ltp, rr,
      addedAt: new Date().toLocaleTimeString("en-IN",{hour12:false}),
      status: "ACTIVE", currentPnL: 0, pnlPct: 0,
    }, ...prev]);
    fetchCandles3m(leg.token);
  }

  function removeWatch(token: number) {
    setWatchlist(prev => prev.filter(w => w.leg.token !== token));
    setCandles3m(prev => { const n = {...prev}; delete n[token]; return n; });
  }

  // ── Drag-and-drop handlers ─────────────────────────────────────────────────
  function handleDragStart(idx: number) { dragIdxRef.current = idx; }
  function handleDragOver(e: React.DragEvent, idx: number) { e.preventDefault(); setDragOver(idx); }
  function handleDrop(idx: number) {
    const from = dragIdxRef.current;
    if (from === null || from === idx) { setDragOver(null); return; }
    setWatchlist(prev => {
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
  const { pcrVol, pcrOI, totalCEOI, totalPEOI } = data ? calcPCR(data.rows) : { pcrVol:0, pcrOI:0, totalCEOI:0, totalPEOI:0 };
  const maxPain   = data ? calcMaxPain(data.rows) : 0;
  const atmStrike = data ? getATM(data.spot) : 0;
  const filteredRows = data ? data.rows.filter(r => {
    const aidx = data.rows.findIndex(x => x.isATM);
    const ridx = data.rows.findIndex(x => x.strike === r.strike);
    return Math.abs(ridx - aidx) <= strikeRange;
  }) : [];

  return (
    <div className="flex flex-col h-screen bg-[#f0f4f8] overflow-hidden" style={{ fontFamily:"'DM Sans',sans-serif" }}>

      {/* ══ HEADER ══ */}
      <header className="flex items-center justify-between px-5 h-[52px] bg-white border-b border-[#cbd5e1] flex-shrink-0">
        <div className="flex items-center gap-5">
          <div className="text-[20px] tracking-[3px] text-[#0284c7]" style={{ ...BEBAS, textShadow:"0 0 16px rgba(2,132,199,.15)" }}>
            NIFTY<span className="text-[#ea580c]">.</span>OPTIONS
          </div>
          <StatBadge label="NIFTY" val={data?.spot.toFixed(2) ?? "—"} color="#0284c7" big />
          <StatBadge label="ATM IV" val={data ? `${data.atmIV.toFixed(2)}%` : "—"} color="#b45309" />
          <StatBadge label="PCR OI" val={pcrOI.toFixed(3)} color={pcrOI>=1.2?"#16a34a":pcrOI<=0.8?"#e11d48":"#b45309"} />
          <StatBadge label="MAX PAIN" val={maxPain ? String(maxPain) : "—"} color="#ea580c" />
        </div>

        <div className="flex items-center gap-3">
          {isDemoMode
            ? <Pill label="DEMO MODE" color="#ea580c" />
            : <div className="flex items-center gap-1.5 px-2 py-1 border border-[#16a34a]/40 bg-[#16a34a]/5 rounded-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a] live-pulse" />
                <span className="text-[9px] text-[#16a34a]" style={MONO}>KITE LIVE{liveUser ? ` · ${liveUser}` : ""}</span>
              </div>
          }

          {loading && <span className="text-[9px] text-[#64748b]" style={MONO}>fetching...</span>}

          <select value={expiry} onChange={e => setExpiry(e.target.value)}
            className="bg-[#f1f5f9] border border-[#cbd5e1] text-[#1e293b] px-3 py-1.5 text-[11px] rounded-sm outline-none cursor-pointer" style={MONO}>
            {expiries.map(e => <option key={e} value={e}>{e}</option>)}
          </select>

          <span className="text-[11px] text-[#ea580c]" style={MONO}>{data?.daysToExpiry.toFixed(1) ?? "—"}d</span>

          <button onClick={() => setLive(v => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 text-[10px] rounded-sm border cursor-pointer transition-colors ${live?"bg-[#16a34a]/10 border-[#16a34a] text-[#16a34a]":"bg-transparent border-[#cbd5e1] text-[#64748b]"}`} style={MONO}>
            <span className={`w-1.5 h-1.5 rounded-full ${live?"bg-[#16a34a] live-pulse":"bg-[#94a3b8]"}`} />
            {live ? "LIVE" : "PAUSED"}
          </button>

          {!isDemoMode && authenticated && (
            <button onClick={handleLogout}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] border border-[#e11d48]/40 bg-[#e11d48]/5 text-[#e11d48] rounded-sm cursor-pointer hover:bg-[#e11d48]/15 transition-colors"
              style={MONO} title="Logout from Kite">
              ⏻ LOGOUT
            </button>
          )}
        </div>
      </header>

      {/* ══ TAB BAR ══ */}
      <div className="flex items-center gap-3 px-5 py-2 bg-white border-b border-[#cbd5e1] flex-shrink-0">
        {(["chain","smc","watchlist","ohlc"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab as any)}
            className={`px-3 py-1.5 text-[10px] tracking-[1px] uppercase rounded-sm border cursor-pointer transition-colors ${activeTab===tab?"bg-[#ff6b35]/20 border-[#ea580c] text-[#ea580c]":"bg-transparent border-[#cbd5e1] text-[#64748b] hover:border-[#4a6080]"}`} style={MONO}>
            {tab==="chain"?"OPTIONS CHAIN":tab==="smc"?`SMC ALERTS (${smcAlerts.length})`:tab==="watchlist"?`WATCHLIST (${watchlist.length})`:"OHLC CSV"}
          </button>
        ))}
        <div className="w-px h-4 bg-[#cbd5e1]" />
        {/* SMC live pulse */}
        {smcStatus?.scanActive && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-[#7c3aed]/8 border border-[#7c3aed]/40 rounded-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] live-pulse" />
            <span className="text-[9px] text-[#7c3aed] font-bold" style={MONO}>SMC SCANNING</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2 text-[10px] text-[#64748b]" style={MONO}>
          {smcWinRate !== null && (
            <span className="text-[#16a34a] font-bold">{smcWinRate}% W/R</span>
          )}
          <span>·</span>
          <span>{data?.updatedAt ? new Date(data.updatedAt).toLocaleTimeString("en-IN",{hour12:false}) : "—"}</span>
        </div>
      </div>

      {/* ══ CONTENT ══ */}
      <div className="flex-1 overflow-hidden">

        {!data && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-6 h-6 border-2 border-[#0284c7]/30 border-t-[#00d4ff] rounded-full animate-spin" />
            <div className="text-[10px] text-[#64748b]" style={MONO}>
              {isDemoMode ? "Loading demo data..." : "Fetching live option chain from Kite..."}
            </div>
          </div>
        )}

        {/* ── OPTIONS CHAIN ── */}
        {activeTab === "chain" && data && (
          <div className="h-full flex flex-col overflow-hidden">
            {/* ── Column headers: [+CE][CE OI][CE LTP][STRIKE][PE LTP][PE OI][+PE] */}
            <div className="grid flex-shrink-0 border-b border-[#cbd5e1] bg-white"
              style={{ gridTemplateColumns:"36px 1fr 1fr 70px 1fr 1fr 36px" }}>
              <div className="py-2.5 bg-[#e8f4ff] border-r border-[#cbd5e1]" />
              <div className="px-3 py-2.5 text-right text-[8px] font-bold tracking-[1.5px] text-[#0284c7] uppercase bg-[#e8f4ff]" style={MONO}>
                <span className="text-[#0284c7]/50">CE </span>OI
              </div>
              <div className="px-3 py-2.5 text-right text-[8px] font-bold tracking-[1.5px] text-[#0284c7] uppercase bg-[#e8f4ff] border-r border-[#cbd5e1]" style={MONO}>
                <span className="text-[#0284c7]/50">CE </span>LTP
              </div>
              <div className="px-2 py-2.5 text-center text-[8px] font-bold tracking-[1.5px] text-[#64748b] uppercase bg-[#e8eef5] border-x border-[#cbd5e1]" style={MONO}>
                STRIKE
              </div>
              <div className="px-3 py-2.5 text-left text-[8px] font-bold tracking-[1.5px] text-[#e11d48] uppercase bg-[#fff0f3] border-l border-[#cbd5e1]" style={MONO}>
                <span className="text-[#e11d48]/50">PE </span>LTP
              </div>
              <div className="px-3 py-2.5 text-left text-[8px] font-bold tracking-[1.5px] text-[#e11d48] uppercase bg-[#fff0f3]" style={MONO}>
                <span className="text-[#e11d48]/50">PE </span>OI
              </div>
              <div className="py-2.5 bg-[#fff0f3] border-l border-[#cbd5e1]" />
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredRows.map(row => <ChainRow key={row.strike} row={row} atmStrike={atmStrike} onAddWatch={addToWatch} addedTokens={watchlistTokens} expiry={expiry} onOpenChart={(_token, strike, type, _sym) => { window.open(`https://web.sensibull.com/chart?tradingSymbol=${sensibullSym(expiry, strike, type)}`, "_blank"); }} />)}
            </div>
            <div className="flex-shrink-0 grid grid-cols-4 border-t border-[#cbd5e1]" style={{ gap:"1px", background:"#cbd5e1" }}>
              {[
                { label:"TOTAL CE OI", val:fmtOI(totalCEOI), color:"#0284c7" },
                { label:"TOTAL PE OI", val:fmtOI(totalPEOI), color:"#e11d48" },
                { label:"PCR VOL",     val:pcrVol.toFixed(3), color:pcrVol>=1.2?"#16a34a":pcrVol<=0.8?"#e11d48":"#b45309" },
                { label:"PCR OI",      val:pcrOI.toFixed(3),  color:pcrOI>=1.2?"#16a34a":pcrOI<=0.8?"#e11d48":"#b45309" },
              ].map(({label,val,color})=>(
                <div key={label} className="bg-white px-4 py-2.5">
                  <div className="text-[8px] tracking-[1.5px] text-[#64748b] uppercase mb-1" style={MONO}>{label}</div>
                  <div className="text-[14px] font-bold" style={{...MONO,color}}>{val}</div>
                </div>
              ))}
            </div>
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
            expiry={expiry}
            onTrigger={triggerSMCScan}
            onClear={async () => { await smcApi.clear(); setSmcAlerts([]); setSmcWinRate(null); }}
            onAddWatch={addToWatch}
            histDate={histDate}
            onHistDateChange={setHistDate}
            histBusy={histBusy}
            histErr={histErr}
            histResults={histResults}
            onHistScan={runHistoricalSMC}
            onHistClear={() => { setHistResults(null); setHistErr(""); }}
          />
        )}

        {/* ── WATCHLIST ── */}
        {activeTab === "watchlist" && (
          <div className="h-full overflow-y-auto px-4 py-4">
            {watchlist.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[60vh] gap-3">
                <div className="text-[40px] text-[#cbd5e1]">◈</div>
                <p className="text-[11px] text-[#64748b] text-center" style={MONO}>
                  Watchlist empty · Use + button on chain or scanner
                </p>
              </div>
            ) : (
              <div className="space-y-2 pb-4">
                {watchlist.map((w, idx) => (
                  <div key={w.leg.token}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={e => handleDragOver(e, idx)}
                    onDrop={() => handleDrop(idx)}
                    onDragLeave={() => setDragOver(null)}
                    style={{opacity: dragIdxRef.current===idx?0.4:1,
                      outline: dragOver===idx?"2px dashed #0284c7":"none", borderRadius:4}}>
                    <WatchlistRow
                      watched={w}
                      candles3m={candles3m[w.leg.token] ?? []}
                      expiry={expiry}
                      onRemove={() => removeWatch(w.leg.token)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── OHLC CSV ── */}
        {activeTab === "ohlc" && (
          <OhlcTab
            expiry={expiry} rows={data?.rows ?? []}
            ohlcDate={ohlcDate} setOhlcDate={setOhlcDate}
            ohlcCE={ohlcCE} setOhlcCE={setOhlcCE}
            ohlcPE={ohlcPE} setOhlcPE={setOhlcPE}
            busy={ohlcBusy} setBusy={setOhlcBusy}
          />
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
function StatBadge({ label, val, color, big }: { label:string; val:string; color:string; big?:boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[9px] tracking-[2px] text-[#64748b]" style={MONO}>{label}</span>
      <span className={`font-bold ${big?"text-[20px]":"text-[14px]"}`} style={{ ...MONO, color }}>{val}</span>
    </div>
  );
}

// ─── TV SYMBOL HELPER ─────────────────────────────────────────────────────────
// TradingView NSE option symbol: NSE:NIFTY + YY + DD + MON + STRIKE + TYPE
// e.g. expiry 2026-03-24, strike 23100 CE → NSE:NIFTY2624MAR23100CE
function tvSymbol(expiry: string, strike: number, type: "CE"|"PE") {
  const exp = new Date(expiry);
  const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const yy  = String(exp.getUTCFullYear()).slice(-2);
  const dd  = String(exp.getUTCDate()).padStart(2, "0");
  const mon = MONTHS[exp.getUTCMonth()];
  return `NSE:NIFTY${yy}${dd}${mon}${strike}${type}`;
}

// Sensibull format: NIFTY + YY + M (no leading zero) + DD + STRIKE + TYPE
// e.g. expiry=2026-03-24, strike=23100, type=PE → NIFTY2632423100PE
function sensibullSym(expiry: string, strike: number, type: "CE"|"PE") {
  const exp = new Date(expiry);
  const yy = String(exp.getUTCFullYear()).slice(-2);
  const m  = String(exp.getUTCMonth() + 1);           // 3 for March (no padding)
  const dd = String(exp.getUTCDate()).padStart(2, "0");
  return `NIFTY${yy}${m}${dd}${strike}${type}`;
}

// ─── CANDLE ICON ──────────────────────────────────────────────────────────────
function CandleIcon({ color }: { color: string }) {
  return (
    <svg width="11" height="12" viewBox="0 0 11 12" fill={color}>
      <rect x="0.5" y="7"   width="2" height="4"   rx="0.5" />
      <rect x="0.5" y="5"   width="2" height="1.5" rx="0.5" opacity="0.4" />
      <rect x="4.5" y="2.5" width="2" height="7"   rx="0.5" />
      <rect x="4.5" y="0.5" width="2" height="1.5" rx="0.5" opacity="0.4" />
      <rect x="8.5" y="4.5" width="2" height="6"   rx="0.5" />
      <rect x="8.5" y="3"   width="2" height="1.5" rx="0.5" opacity="0.4" />
    </svg>
  );
}

// ─── CHAIN ROW ────────────────────────────────────────────────────────────────
function ChainRow({ row, atmStrike, onAddWatch, addedTokens, expiry, onOpenChart }: {
  row:OptionsRow; atmStrike:number; onAddWatch:(l:OptionLeg)=>void; addedTokens:Set<number>;
  expiry:string; onOpenChart:(token:number, strike:number, type:"CE"|"PE", sym:string)=>void;
}) {
  const { ce, pe, strike, isATM } = row;
  const rowBg = isATM ? "bg-[#eff6ff]" : "bg-white hover:bg-[#f8fafc]";
  const COLS  = "36px 1fr 1fr 70px 1fr 1fr 36px";
  return (
    <div className={`grid border-b border-[#f1f5f9] transition-colors ${rowBg}`}
      style={{ gridTemplateColumns: COLS }}>

      {/* + CE */}
      <div className="flex items-center justify-center bg-[#f8fbff]">
        <button onClick={() => onAddWatch(ce)} title={`Add CE ${strike} to watchlist`}
          className={`w-6 h-6 rounded text-[11px] font-bold border cursor-pointer transition-all
            ${addedTokens.has(ce.token)?"bg-[#16a34a] border-[#16a34a] text-white":"bg-[#0284c7]/10 text-[#0284c7] border-[#0284c7]/30 hover:bg-[#0284c7]/25"}`}>
          {addedTokens.has(ce.token) ? "✓" : "+"}
        </button>
      </div>

      {/* CE OI — bar from right toward strike */}
      <div className="px-3 py-2 text-right relative overflow-hidden bg-[#f8fbff]">
        <div className="absolute right-0 top-0 bottom-0" style={{ width:`${row.ceOIBar}%`, background:"rgba(2,132,199,0.10)" }} />
        <span className="text-[11px] tabular-nums relative z-10 text-[#475569]" style={MONO}>{fmtOI(ce.oi)}</span>
      </div>

      {/* CE LTP + chart icon */}
      <div className="px-2 py-2 text-right border-r border-[#e2e8f0] group">
        <div className="flex items-center justify-end gap-1.5">
          <button onClick={() => onOpenChart(ce.token, strike, "CE", tvSymbol(expiry, strike, "CE"))}
            title={`Chart ${strike} CE`}
            className="opacity-30 group-hover:opacity-100 transition-opacity flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-[#0284c7]/15 text-[#0284c7] cursor-pointer">
            <CandleIcon color="#0284c7" />
          </button>
          <div>
            <div className={`text-[13px] font-bold tabular-nums leading-tight
              ${ce.ltp>=200&&ce.ltp<=300?"text-[#16a34a]":"text-[#1e293b]"}`} style={MONO}>
              ₹{ce.ltp.toFixed(2)}
            </div>
            <div className={`text-[8px] ${ce.ltpChange>=0?"text-[#16a34a]":"text-[#e11d48]"}`} style={MONO}>
              {ce.ltpChange>=0?"▲":"▼"}{Math.abs(ce.ltpChange).toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* STRIKE */}
      <div className={`py-2 text-center border-x border-[#e2e8f0] flex flex-col items-center justify-center
        ${isATM ? "bg-[#dbeafe]" : "bg-[#f8fafc]"}`}>
        <div className={`text-[12px] font-bold tabular-nums leading-none
          ${isATM ? "text-[#0284c7]" : "text-[#1e293b]"}`} style={MONO}>{strike}</div>
        {isATM && <div className="text-[6px] text-[#0284c7]/60 tracking-[1px] mt-0.5 font-bold" style={MONO}>ATM</div>}
      </div>

      {/* PE LTP + chart icon */}
      <div className="px-2 py-2 text-left border-l border-[#e2e8f0] group">
        <div className="flex items-center gap-1.5">
          <div>
            <div className={`text-[13px] font-bold tabular-nums leading-tight
              ${pe.ltp>=200&&pe.ltp<=300?"text-[#16a34a]":"text-[#1e293b]"}`} style={MONO}>
              ₹{pe.ltp.toFixed(2)}
            </div>
            <div className={`text-[8px] ${pe.ltpChange>=0?"text-[#16a34a]":"text-[#e11d48]"}`} style={MONO}>
              {pe.ltpChange>=0?"▲":"▼"}{Math.abs(pe.ltpChange).toFixed(2)}
            </div>
          </div>
          <button onClick={() => onOpenChart(pe.token, strike, "PE", tvSymbol(expiry, strike, "PE"))}
            title={`Chart ${strike} PE`}
            className="opacity-30 group-hover:opacity-100 transition-opacity flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-[#e11d48]/15 text-[#e11d48] cursor-pointer">
            <CandleIcon color="#e11d48" />
          </button>
        </div>
      </div>

      {/* PE OI — bar from left toward strike */}
      <div className="px-3 py-2 text-left relative overflow-hidden bg-[#fff8fa]">
        <div className="absolute left-0 top-0 bottom-0" style={{ width:`${row.peOIBar}%`, background:"rgba(225,29,72,0.08)" }} />
        <span className="text-[11px] tabular-nums relative z-10 text-[#475569]" style={MONO}>{fmtOI(pe.oi)}</span>
      </div>

      {/* + PE */}
      <div className="flex items-center justify-center bg-[#fff8fa]">
        <button onClick={() => onAddWatch(pe)} title={`Add PE ${strike} to watchlist`}
          className={`w-6 h-6 rounded text-[11px] font-bold border cursor-pointer transition-all
            ${addedTokens.has(pe.token)?"bg-[#16a34a] border-[#16a34a] text-white":"bg-[#e11d48]/10 text-[#e11d48] border-[#e11d48]/30 hover:bg-[#e11d48]/25"}`}>
          {addedTokens.has(pe.token) ? "✓" : "+"}
        </button>
      </div>
    </div>
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
        onError={() => {/* silently handle */}}
      />
      {/* Fallback bar — visible below if iframe is blocked */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-[#f8fafc] border-t border-[#e2e8f0]">
        <span className="text-[9px] text-[#94a3b8]" style={MONO}>
          If chart is blank, Sensibull may block iframe embedding.
        </span>
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="text-[9px] px-3 py-1 bg-[#0284c7] text-white rounded-sm font-bold hover:bg-[#0369a1] transition-colors cursor-pointer"
          style={MONO}>
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
  private _diff: number;   // abs price distance (entry → target = entry → stop)
  private _views: any[];

  constructor(isLong: boolean, entry: { time: number; price: number }, second: { time: number; price: number }) {
    this._isLong = isLong;
    this._entry  = entry;
    this._diff   = Math.abs(second.price - entry.price) || entry.price * 0.005;
    const self = this;
    this._views = [{
      zOrder: () => "bottom" as const,
      renderer: () => ({
        draw(target: any) {
          if (!self._chart || !self._series) return;
          target.useMediaCoordinateSpace((scope: any) => {
            const ctx = scope.context;
            const W   = scope.mediaSize.width;
            const xE  = self._chart.timeScale().timeToCoordinate(self._entry.time as any);
            if (xE == null) return;

            const E       = self._entry.price;
            const diff    = self._diff;
            const tp      = self._isLong ? E + diff : E - diff;
            const sl      = self._isLong ? E - diff : E + diff;
            const yE  = self._series.priceToCoordinate(E);
            const yTP = self._series.priceToCoordinate(tp);
            const ySL = self._series.priceToCoordinate(sl);
            if (yE == null || yTP == null || ySL == null) return;

            const x1 = Math.max(0, xE);
            const pct = (diff / E * 100).toFixed(2);

            ctx.save();
            // Profit zone (green)
            ctx.fillStyle = "rgba(22,163,74,0.18)";
            ctx.fillRect(x1, Math.min(yE, yTP), W - x1, Math.abs(yTP - yE));
            // Loss zone (red)
            ctx.fillStyle = "rgba(220,38,38,0.18)";
            ctx.fillRect(x1, Math.min(yE, ySL), W - x1, Math.abs(ySL - yE));

            // TP line
            ctx.strokeStyle = "#16a34a"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 2]);
            ctx.beginPath(); ctx.moveTo(x1, yTP); ctx.lineTo(W, yTP); ctx.stroke();
            // Entry line
            ctx.strokeStyle = "#64748b"; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(x1, yE);  ctx.lineTo(W, yE);  ctx.stroke();
            // SL line
            ctx.strokeStyle = "#dc2626";
            ctx.beginPath(); ctx.moveTo(x1, ySL); ctx.lineTo(W, ySL); ctx.stroke();
            ctx.setLineDash([]);

            // Labels (right side)
            const lx = x1 + 8;
            ctx.font = "bold 9px 'Space Mono', monospace";
            ctx.fillStyle = "#16a34a";
            ctx.fillText(`TP  ${tp.toFixed(2)}  (+${pct}%)`, lx, yTP < yE ? yTP - 4 : yTP + 11);
            ctx.fillStyle = "#1e293b";
            ctx.fillText(`Entry  ${E.toFixed(2)}`, lx, yE - 4);
            ctx.fillStyle = "#dc2626";
            ctx.fillText(`SL  ${sl.toFixed(2)}  (-${pct}%)`, lx, ySL > yE ? ySL + 11 : ySL - 4);

            // Entry dot
            ctx.fillStyle = self._isLong ? "#16a34a" : "#dc2626";
            ctx.beginPath(); ctx.arc(xE, yE, 4, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(xE, yE, 4, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
          });
        }
      }),
    }];
  }
  attached(params: any) { this._chart = params.chart; this._series = params.series; }
  detached() { this._chart = null; this._series = null; }
  updateAllViews() {}
  paneViews() { return this._views; }
}

// ─── KITE CHART PANEL ─────────────────────────────────────────────────────────
const IV_LIST = [
  { label: "1m",  iv: "minute",   days: 3  },
  { label: "5m",  iv: "5minute",  days: 7  },
  { label: "15m", iv: "15minute", days: 14 },
  { label: "1H",  iv: "60minute", days: 30 },
  { label: "D",   iv: "day",      days: 60 },
] as const;
type IvKey  = (typeof IV_LIST)[number]["iv"];
type IndKey = "EMA9"|"EMA21"|"BB"|"VOL"|"RSI"|"MACD";
type CandleRow = {
  date: string; open: number; high: number; low: number; close: number;
  volume: number; oi: number; rsi14: number|null;
  ema9: number|null; ema21: number|null;
  bbMid: number|null; bbUp: number|null; bbDn: number|null;
  macd: number|null; macdSig: number|null; macdHist: number|null;
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
  EMA9: "#f97316", EMA21: "#3b82f6", BB: "#a855f7", VOL: "#64748b", RSI: "#a855f7", MACD: "#3b82f6",
};
const DEFAULT_IND = new Set<IndKey>(["EMA9", "VOL"]);

type DrawMode = "cursor"|"hline"|"long"|"short";

function KiteChartPanel({ target }: {
  target: { token: number; strike: number; type: "CE"|"PE"; expiry: string; sym: string };
}) {
  const chartDiv  = useRef<HTMLDivElement>(null);
  const chartApi  = useRef<ReturnType<typeof createChart> | null>(null);
  const sm        = useRef<Record<string, any>>({});
  const indRef    = useRef(new Set<IndKey>(DEFAULT_IND));
  // Drawing state
  const drawModeRef  = useRef<DrawMode>("cursor");
  const hlinesData   = useRef<number[]>([]);
  const trendData    = useRef<Array<{ isLong: boolean; entry: { time: number; price: number }; second: { time: number; price: number } }>>([]);
  const hlinesRef    = useRef<Array<{ price: number; pl: any }>>([]);
  const trendRef     = useRef<Array<{ prim: PositionPrimitive }>>([]);
  const trendStepRef = useRef(0);
  const trendP1Ref   = useRef<{ time: number; price: number } | null>(null);

  const [tf,         setTf]         = useState<IvKey>("minute");
  const [indicators, setIndicators] = useState<Set<IndKey>>(new Set(DEFAULT_IND));
  const [rows,       setRows]       = useState<CandleRow[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string|null>(null);
  const [ohlc,       setOhlc]       = useState<{o:number;h:number;l:number;c:number;v:number}|null>(null);
  const [drawMode,   setDrawMode]   = useState<DrawMode>("cursor");
  const [trendStep,  setTrendStep]  = useState(0);
  const [drawnCount, setDrawnCount] = useState(0);

  // ── Fetch candles ──────────────────────────────────────────────────────────
  useEffect(() => {
    const conf = IV_LIST.find(x => x.iv === tf)!;
    const today = new Date();
    const to    = today.toISOString().split("T")[0];
    const fromD = new Date(today); fromD.setDate(fromD.getDate() - conf.days);
    const from  = fromD.toISOString().split("T")[0];
    setLoading(true); setError(null); setRows([]);
    optionsApi.candleRange(target.token, from, to, tf)
      .then((d: { rows: CandleRow[] }) => setRows(d.rows ?? []))
      .catch((e: any) => setError(e.message ?? "Failed to load chart data"))
      .finally(() => setLoading(false));
  }, [target.token, tf]);

  // ── Build / rebuild chart when data changes ────────────────────────────────
  useEffect(() => {
    if (!chartDiv.current || rows.length === 0) return;
    if (chartApi.current) { chartApi.current.remove(); chartApi.current = null; }

    const chart = createChart(chartDiv.current, {
      layout: {
        background: { color: "#ffffff" }, textColor: "#64748b",
        fontFamily: "'Space Mono', monospace", fontSize: 10,
      },
      grid:      { vertLines: { color: "#f1f5f9" }, horzLines: { color: "#f1f5f9" } },
      crosshair: { mode: 1 },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#e2e8f0" },
      rightPriceScale: { borderColor: "#e2e8f0", scaleMargins: { top: 0.08, bottom: 0.08 } },
      autoSize: true,
    } as any);
    chartApi.current = chart;
    const s = sm.current;
    const ind = indRef.current;

    // Pane 0: candles + overlays
    s.candle = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a", downColor: "#dc2626",
      borderUpColor: "#16a34a", borderDownColor: "#dc2626",
      wickUpColor: "#16a34a", wickDownColor: "#dc2626",
    } as any, 0);
    s.ema9  = chart.addSeries(LineSeries, { color: "#f97316", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, visible: ind.has("EMA9")  } as any, 0);
    s.ema21 = chart.addSeries(LineSeries, { color: "#3b82f6", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, visible: ind.has("EMA21") } as any, 0);
    s.bbUp  = chart.addSeries(LineSeries, { color: "#a855f7", lineWidth: 1, lineStyle: 1, lastValueVisible: false, priceLineVisible: false, visible: ind.has("BB") } as any, 0);
    s.bbMid = chart.addSeries(LineSeries, { color: "#a855f7", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, visible: ind.has("BB") } as any, 0);
    s.bbDn  = chart.addSeries(LineSeries, { color: "#a855f7", lineWidth: 1, lineStyle: 1, lastValueVisible: false, priceLineVisible: false, visible: ind.has("BB") } as any, 0);

    // Pane 1: volume
    s.vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false, visible: ind.has("VOL"),
    } as any, 1);

    // Pane 2: RSI
    s.rsi = chart.addSeries(LineSeries, {
      color: "#a855f7", lineWidth: 1.5, lastValueVisible: true, priceLineVisible: false, visible: ind.has("RSI"),
    } as any, 2);
    try {
      s.rsi.createPriceLine({ price: 70, color: "rgba(220,38,38,0.5)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "70" });
      s.rsi.createPriceLine({ price: 30, color: "rgba(22,163,74,0.5)",  lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "30" });
    } catch {}

    // Pane 3: MACD
    s.macd     = chart.addSeries(LineSeries,     { color: "#3b82f6", lineWidth: 1.5, lastValueVisible: false, priceLineVisible: false, visible: ind.has("MACD") } as any, 3);
    s.macdSig  = chart.addSeries(LineSeries,     { color: "#f97316", lineWidth: 1,   lastValueVisible: false, priceLineVisible: false, visible: ind.has("MACD") } as any, 3);
    s.macdHist = chart.addSeries(HistogramSeries, {                                   lastValueVisible: false, priceLineVisible: false, visible: ind.has("MACD") } as any, 3);

    // Pane heights
    try {
      const panes = (chart as any).panes?.();
      panes?.[1]?.setHeight(60); panes?.[2]?.setHeight(80); panes?.[3]?.setHeight(80);
    } catch {}

    // Set data
    const t = (r: CandleRow) => istToUnix(r.date) as any;
    s.candle.setData(rows.map(r => ({ time: t(r), open: r.open, high: r.high, low: r.low, close: r.close })));
    s.ema9.setData( rows.filter(r => r.ema9   != null).map(r => ({ time: t(r), value: r.ema9! })));
    s.ema21.setData(rows.filter(r => r.ema21  != null).map(r => ({ time: t(r), value: r.ema21! })));
    s.bbUp.setData( rows.filter(r => r.bbUp   != null).map(r => ({ time: t(r), value: r.bbUp! })));
    s.bbMid.setData(rows.filter(r => r.bbMid  != null).map(r => ({ time: t(r), value: r.bbMid! })));
    s.bbDn.setData( rows.filter(r => r.bbDn   != null).map(r => ({ time: t(r), value: r.bbDn! })));
    s.vol.setData(  rows.map(r => ({ time: t(r), value: r.volume, color: r.close >= r.open ? "rgba(22,163,74,0.35)" : "rgba(220,38,38,0.35)" })));
    s.rsi.setData(      rows.filter(r => r.rsi14    != null).map(r => ({ time: t(r), value: r.rsi14! })));
    s.macd.setData(     rows.filter(r => r.macd     != null).map(r => ({ time: t(r), value: r.macd! })));
    s.macdSig.setData(  rows.filter(r => r.macdSig  != null).map(r => ({ time: t(r), value: r.macdSig! })));
    s.macdHist.setData( rows.filter(r => r.macdHist != null).map(r => ({
      time: t(r), value: r.macdHist!,
      color: (r.macdHist ?? 0) >= 0 ? "rgba(22,163,74,0.55)" : "rgba(220,38,38,0.55)",
    })));

    chart.timeScale().fitContent();

    // Re-apply stored drawings after rebuild
    hlinesRef.current = hlinesData.current.map(price => ({
      price,
      pl: s.candle.createPriceLine({ price, color: "#f97316", lineWidth: 1.5, lineStyle: 2, axisLabelVisible: true, title: price.toFixed(2) }),
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
        const pl = s.candle.createPriceLine({ price, color: "#f97316", lineWidth: 1.5, lineStyle: 2, axisLabelVisible: true, title: price.toFixed(2) });
        hlinesData.current.push(price);
        hlinesRef.current.push({ price, pl });
        setDrawnCount(c => c + 1);
      }
      if (drawModeRef.current === "long" || drawModeRef.current === "short") {
        const isLong = drawModeRef.current === "long";
        if (trendStepRef.current === 0) {
          trendP1Ref.current = { time, price };
          trendStepRef.current = 1; setTrendStep(1);
        } else {
          const entry  = trendP1Ref.current!;
          const second = { time, price };
          const prim   = new PositionPrimitive(isLong, entry, second);
          s.candle.attachPrimitive(prim);
          trendData.current.push({ isLong, entry, second });
          trendRef.current.push({ prim });
          trendStepRef.current = 0; trendP1Ref.current = null; setTrendStep(0);
          setDrawnCount(c => c + 1);
        }
      }
    });

    // Crosshair OHLC
    chart.subscribeCrosshairMove((param: any) => {
      if (!param.time || !param.seriesData?.size) { setOhlc(null); return; }
      const cd = param.seriesData.get(s.candle);
      const vd = param.seriesData.get(s.vol);
      if (cd) setOhlc({ o: cd.open, h: cd.high, l: cd.low, c: cd.close, v: vd?.value ?? 0 });
      else     setOhlc(null);
    });

    return () => { chart.remove(); chartApi.current = null; };
  }, [rows]);

  // ── Indicator toggle ───────────────────────────────────────────────────────
  function toggleInd(ind: IndKey) {
    const next = new Set(indRef.current);
    if (next.has(ind)) next.delete(ind); else next.add(ind);
    indRef.current = next; setIndicators(new Set(next));
    const on = next.has(ind); const s = sm.current;
    switch (ind) {
      case "EMA9":  s.ema9?.applyOptions({ visible: on }); break;
      case "EMA21": s.ema21?.applyOptions({ visible: on }); break;
      case "BB":    s.bbUp?.applyOptions({ visible: on }); s.bbMid?.applyOptions({ visible: on }); s.bbDn?.applyOptions({ visible: on }); break;
      case "VOL":   s.vol?.applyOptions({ visible: on }); break;
      case "RSI":   s.rsi?.applyOptions({ visible: on }); break;
      case "MACD":  s.macd?.applyOptions({ visible: on }); s.macdSig?.applyOptions({ visible: on }); s.macdHist?.applyOptions({ visible: on }); break;
    }
  }

  // ── Drawing mode ───────────────────────────────────────────────────────────
  function setDraw(mode: DrawMode) {
    drawModeRef.current = mode; setDrawMode(mode);
    if (mode !== "long" && mode !== "short") { trendStepRef.current = 0; trendP1Ref.current = null; setTrendStep(0); }
  }

  function clearDrawings() {
    const s = sm.current;
    hlinesRef.current.forEach(({ pl }) => { try { s.candle?.removePriceLine(pl); } catch {} });
    trendRef.current.forEach(({ prim }) => { try { s.candle?.detachPrimitive(prim); } catch {} });
    hlinesRef.current = []; trendRef.current = [];
    hlinesData.current = []; trendData.current = [];
    trendStepRef.current = 0; trendP1Ref.current = null; setTrendStep(0);
    setDrawnCount(0);
  }

  const tc = target.type === "CE" ? "#0284c7" : "#dc2626";

  // Drawing tool button helper
  function DrawBtn({ mode, title, children }: { mode: DrawMode; title: string; children: React.ReactNode }) {
    const active = drawMode === mode;
    return (
      <button title={title} onClick={() => setDraw(mode)}
        className="w-7 h-7 flex items-center justify-center rounded cursor-pointer transition-colors"
        style={{ background: active ? "#0284c7" : "transparent", color: active ? "#fff" : "#64748b" }}>
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
            <button key={iv} onClick={() => setTf(iv as IvKey)}
              className={`px-2.5 py-1 text-[9px] cursor-pointer transition-colors ${tf === iv ? "bg-[#0284c7] text-white font-bold" : "text-[#64748b] hover:bg-[#f1f5f9]"}`}
              style={MONO}>{label}</button>
          ))}
        </div>

        <div className="w-px h-3.5 bg-[#e2e8f0]" />

        {/* Indicator toggles */}
        {(["EMA9","EMA21","BB","VOL","RSI","MACD"] as IndKey[]).map(ind => (
          <button key={ind} onClick={() => toggleInd(ind)}
            className="px-2 py-0.5 text-[8px] rounded-sm cursor-pointer border transition-colors font-bold"
            style={{
              ...MONO,
              background:  indicators.has(ind) ? IND_COLORS[ind] : "transparent",
              borderColor: indicators.has(ind) ? IND_COLORS[ind] : "#e2e8f0",
              color:       indicators.has(ind) ? "#fff"          : "#94a3b8",
            }}>
            {ind}
          </button>
        ))}

        {loading && <div className="w-3.5 h-3.5 border-2 border-[#0284c7]/20 border-t-[#0284c7] rounded-full animate-spin" />}
        {error   && <span className="text-[8px] text-[#dc2626]" style={MONO}>⚠ {error}</span>}

        {/* OHLC display */}
        {(ohlc ?? (rows.length > 0 ? { o: rows[rows.length-1].open, h: rows[rows.length-1].high, l: rows[rows.length-1].low, c: rows[rows.length-1].close, v: rows[rows.length-1].volume } : null)) && !loading && (() => {
          const d = ohlc ?? { o: rows[rows.length-1].open, h: rows[rows.length-1].high, l: rows[rows.length-1].low, c: rows[rows.length-1].close, v: rows[rows.length-1].volume };
          return (
            <div className="ml-auto flex items-center gap-2 text-[8px]" style={MONO}>
              <span className="text-[#64748b]">O <span style={{ color: tc }}>{d.o.toFixed(2)}</span></span>
              <span className="text-[#64748b]">H <span style={{ color: "#16a34a" }}>{d.h.toFixed(2)}</span></span>
              <span className="text-[#64748b]">L <span style={{ color: "#dc2626" }}>{d.l.toFixed(2)}</span></span>
              <span className="text-[#64748b]">C <span style={{ color: d.c >= d.o ? "#16a34a" : "#dc2626" }}>{d.c.toFixed(2)}</span></span>
              <span className="text-[#94a3b8]">V {(d.v / 1000).toFixed(0)}K</span>
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
              <path d="M2 1L8 11L9.5 8L13 7L2 1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
            </svg>
          </DrawBtn>

          {/* H-Line */}
          <DrawBtn mode="hline" title="Horizontal Line — click to place">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <line x1="1" y1="6.5" x2="12" y2="6.5" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="1.5" cy="6.5" r="1.5" fill="currentColor"/>
              <circle cx="11.5" cy="6.5" r="1.5" fill="currentColor"/>
            </svg>
          </DrawBtn>

          {/* Long Position */}
          <DrawBtn mode="long" title={drawMode === "long" && trendStep === 1 ? "Click 2nd point to set size…" : "Long Position (2 clicks: entry → size)"}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <rect x="1" y="1" width="11" height="5" rx="1" fill="rgba(22,163,74,0.25)" stroke="#16a34a" strokeWidth="1"/>
              <rect x="1" y="7" width="11" height="5" rx="1" fill="rgba(220,38,38,0.2)" stroke="#dc2626" strokeWidth="1"/>
              <line x1="1" y1="6.5" x2="12" y2="6.5" stroke="#64748b" strokeWidth="1.5"/>
            </svg>
          </DrawBtn>

          {/* Short Position */}
          <DrawBtn mode="short" title={drawMode === "short" && trendStep === 1 ? "Click 2nd point to set size…" : "Short Position (2 clicks: entry → size)"}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <rect x="1" y="1" width="11" height="5" rx="1" fill="rgba(220,38,38,0.2)" stroke="#dc2626" strokeWidth="1"/>
              <rect x="1" y="7" width="11" height="5" rx="1" fill="rgba(22,163,74,0.25)" stroke="#16a34a" strokeWidth="1"/>
              <line x1="1" y1="6.5" x2="12" y2="6.5" stroke="#64748b" strokeWidth="1.5"/>
            </svg>
          </DrawBtn>

          {/* Step indicator for position tools */}
          {(drawMode === "long" || drawMode === "short") && (
            <div className="text-[7px] text-center leading-none px-0.5 font-bold"
              style={{ ...MONO, color: drawMode === "long" ? "#16a34a" : "#dc2626" }}>
              {trendStep === 0 ? "E?" : "T?"}
            </div>
          )}

          <div className="flex-1" />

          {/* Clear */}
          <button title="Clear all drawings" onClick={clearDrawings}
            className="w-7 h-7 flex items-center justify-center rounded cursor-pointer transition-colors"
            style={{ color: drawnCount > 0 ? "#e11d48" : "#cbd5e1" }}
            disabled={drawnCount === 0}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M1 1L12 12M12 1L1 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Chart area */}
        <div className="flex-1 min-h-0 relative" style={{ cursor: drawMode === "cursor" ? "default" : "crosshair" }}>
          {loading && rows.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-[10px] text-[#94a3b8]" style={MONO}>
              <div className="w-4 h-4 border-2 border-[#0284c7]/20 border-t-[#0284c7] rounded-full animate-spin" />
              Loading chart data…
            </div>
          )}
          {!loading && rows.length === 0 && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-[10px] text-[#94a3b8]" style={MONO}>No data for selected interval</div>
          )}
          <div ref={chartDiv} className="absolute inset-0" style={{ visibility: rows.length > 0 ? "visible" : "hidden" }} />
        </div>
      </div>
    </div>
  );
}

// ─── SENSIBULL-STYLE PAYOFF CHART ────────────────────────────────────────────
const NIFTY_LOT = 75;

function drawPayoffChart(
  canvas: HTMLCanvasElement,
  strike: number, type: "CE"|"PE", spot: number, entry: number,
) {
  const ctx = canvas.getContext("2d")!;
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.clientWidth;
  const H   = canvas.clientHeight;
  if (W < 20 || H < 20) return;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const P  = { t: 44, r: 76, b: 56, l: 76 };
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
    const intr  = type === "CE" ? Math.max(0, price - strike) : Math.max(0, strike - price);
    pts.push({ px: price, pnl: (intr - entry) * NIFTY_LOT });
  }

  const maxPnL  = Math.max(...pts.map(d => d.pnl));
  const minPnL  = Math.min(...pts.map(d => d.pnl));
  const pnlSpan = (maxPnL - minPnL) || 1;
  const yLo     = minPnL - pnlSpan * 0.15;
  const yHi     = maxPnL + pnlSpan * 0.15;

  const toX = (p: number)   => P.l + ((p - minP) / (maxP - minP)) * cw;
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
  ctx.strokeStyle = "#f1f5f9"; ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const x = P.l + (i / 8) * cw;
    ctx.beginPath(); ctx.moveTo(x, P.t); ctx.lineTo(x, P.t + ch); ctx.stroke();
  }
  for (let i = 0; i <= 5; i++) {
    const y = P.t + (i / 5) * ch;
    ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(P.l + cw, y); ctx.stroke();
  }

  // ── X-axis labels (price) ──
  ctx.fillStyle = "#94a3b8"; ctx.font = "9px 'Space Mono', monospace"; ctx.textAlign = "center";
  for (let i = 0; i <= 8; i++) {
    const p = minP + (i / 8) * (maxP - minP);
    ctx.fillText(Math.round(p).toLocaleString("en-IN"), P.l + (i / 8) * cw, P.t + ch + 20);
  }

  // ── Y-axis labels (P&L) ──
  ctx.textAlign = "right";
  for (let i = 0; i <= 5; i++) {
    const pnl = yLo + (i / 5) * (yHi - yLo);
    const y   = toY(pnl);
    const abs = Math.abs(pnl);
    const lbl = abs >= 100000 ? `${(pnl/1000).toFixed(0)}k`
              : abs >= 1000   ? `${(pnl/1000).toFixed(1)}k`
              : pnl.toFixed(0);
    ctx.fillStyle = pnl > 50 ? "#16a34a" : pnl < -50 ? "#e11d48" : "#94a3b8";
    ctx.fillText(lbl, P.l - 8, y + 3.5);
  }

  // ── Zero line ──
  ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(P.l, zeroY); ctx.lineTo(P.l + cw, zeroY); ctx.stroke();

  // ── Profit fill ──
  ctx.save(); ctx.beginPath();
  ctx.moveTo(toX(pts[0].px), zeroY);
  pts.forEach(d => ctx.lineTo(toX(d.px), d.pnl > 0 ? toY(d.pnl) : zeroY));
  ctx.lineTo(toX(pts[pts.length-1].px), zeroY); ctx.closePath();
  ctx.fillStyle = "rgba(22,163,74,0.20)"; ctx.fill(); ctx.restore();

  // ── Loss fill ──
  ctx.save(); ctx.beginPath();
  ctx.moveTo(toX(pts[0].px), zeroY);
  pts.forEach(d => ctx.lineTo(toX(d.px), d.pnl < 0 ? toY(d.pnl) : zeroY));
  ctx.lineTo(toX(pts[pts.length-1].px), zeroY); ctx.closePath();
  ctx.fillStyle = "rgba(225,29,72,0.15)"; ctx.fill(); ctx.restore();

  // ── Payoff curve ──
  ctx.strokeStyle = type === "CE" ? "#0284c7" : "#dc2626";
  ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.beginPath();
  pts.forEach((d, i) => { if (i===0) ctx.moveTo(toX(d.px), toY(d.pnl)); else ctx.lineTo(toX(d.px), toY(d.pnl)); });
  ctx.stroke();

  // ── Vertical marker helper ──
  function vline(px: number, color: string, dash: number[], lw: number, topTag: string, val: string) {
    const x = toX(px);
    if (x < P.l - 1 || x > P.l + cw + 1) return;
    ctx.save(); ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(x, P.t); ctx.lineTo(x, P.t + ch); ctx.stroke(); ctx.restore();
    ctx.fillStyle = color; ctx.textAlign = "center";
    ctx.font = "bold 7px 'Space Mono', monospace"; ctx.fillText(topTag, x, P.t - 22);
    ctx.font = "8px 'Space Mono', monospace";      ctx.fillText(val,    x, P.t - 11);
  }
  vline(strike, "#94a3b8", [3,3], 1,   "STRIKE",    strike.toLocaleString("en-IN"));
  if (entry > 0) {
    const be = type === "CE" ? strike + entry : strike - entry;
    vline(be, "#16a34a", [6,3], 1.5, "BREAKEVEN", Math.round(be).toLocaleString("en-IN"));
  }
  vline(spot, "#f97316", [6,3], 2, "SPOT", Math.round(spot).toLocaleString("en-IN"));

  // ── Dot at current spot on payoff curve ──
  const sX = toX(spot);
  if (sX >= P.l && sX <= P.l + cw) {
    const intr   = type === "CE" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
    const curPnL = (intr - entry) * NIFTY_LOT;
    const dotY   = toY(curPnL);
    ctx.beginPath(); ctx.arc(sX, dotY, 6, 0, Math.PI * 2);
    ctx.fillStyle = curPnL >= 0 ? "#16a34a" : "#e11d48"; ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.stroke();
    const lbl = `${curPnL >= 0 ? "+" : ""}₹${Math.abs(Math.round(curPnL)).toLocaleString("en-IN")}`;
    ctx.fillStyle = curPnL >= 0 ? "#16a34a" : "#e11d48";
    ctx.font = "bold 11px 'Space Mono', monospace";
    ctx.textAlign = sX > W * 0.6 ? "right" : "left";
    ctx.fillText(lbl, sX + (sX > W * 0.6 ? -12 : 12), dotY - 10);
  }

  // ── Chart border ──
  ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 1; ctx.strokeRect(P.l, P.t, cw, ch);

  // ── Axis titles ──
  ctx.save(); ctx.translate(13, P.t + ch / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#94a3b8"; ctx.font = "8px 'Space Mono', monospace"; ctx.textAlign = "center";
  ctx.fillText("P&L AT EXPIRY  (₹)", 0, 0); ctx.restore();
  ctx.fillStyle = "#94a3b8"; ctx.font = "8px 'Space Mono', monospace"; ctx.textAlign = "center";
  ctx.fillText("NIFTY 50 AT EXPIRY", P.l + cw / 2, H - 10);
}

function PayoffPanel({ target, spot, entryPrice }: {
  target:     { strike: number; type: "CE"|"PE"; expiry: string };
  spot:       number;
  entryPrice: number | null;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);  // use div as measurement anchor
  const cvRef     = useRef<HTMLCanvasElement>(null);
  const entry     = entryPrice ?? 0;
  const tc        = target.type === "CE" ? "#0284c7" : "#e11d48";

  useEffect(() => {
    const canvas = cvRef.current;
    if (!canvas) return;
    const redraw = () => drawPayoffChart(canvas, target.strike, target.type, spot, entry);
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    redraw();
    return () => ro.disconnect();
  }, [target.strike, target.type, spot, entry]);

  // Derived stats
  const be      = target.type === "CE" ? target.strike + entry : target.strike - entry;
  const maxLoss = entry * NIFTY_LOT;
  const intr    = target.type === "CE" ? Math.max(0, spot - target.strike) : Math.max(0, target.strike - spot);
  const curPnL  = (intr - entry) * NIFTY_LOT;

  return (
    <div className="absolute inset-0 flex flex-col bg-white">
      {/* Canvas */}
      <div ref={canvasRef} className="flex-1 min-h-0 relative">
        <canvas ref={cvRef} className="absolute inset-0 w-full h-full" />
      </div>

      {/* Stats bar */}
      <div className="flex-shrink-0 border-t border-[#e2e8f0] bg-[#f8fafc] grid grid-cols-6 divide-x divide-[#e2e8f0]">
        {[
          { label:"STRIKE",    val: target.strike.toLocaleString("en-IN"),                                                               color:"#64748b" },
          { label:"PREMIUM",   val: entry > 0 ? `₹${entry.toFixed(2)}` : "—",                                                           color: tc },
          { label:"BREAKEVEN", val: entry > 0 ? Math.round(be).toLocaleString("en-IN") : "—",                                           color:"#16a34a" },
          { label:"MAX LOSS",  val: entry > 0 ? `₹${maxLoss.toLocaleString("en-IN",{maximumFractionDigits:0})}` : "—",                  color:"#e11d48" },
          { label:"MAX PROFIT",val: target.type === "CE" ? "Unlimited" : `₹${(target.strike * NIFTY_LOT).toLocaleString("en-IN",{maximumFractionDigits:0})}`, color:"#16a34a" },
          { label:"CUR P&L",   val: entry > 0 ? `${curPnL>=0?"+":""}₹${Math.abs(Math.round(curPnL)).toLocaleString("en-IN")}` : "—",   color: curPnL >= 0 ? "#16a34a" : "#e11d48" },
        ].map(({ label, val, color }) => (
          <div key={label} className="px-3 py-2.5 text-center">
            <div className="text-[7px] text-[#94a3b8] tracking-[1.5px] uppercase mb-1" style={MONO}>{label}</div>
            <div className="text-[12px] font-bold leading-tight" style={{ ...MONO, color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex-shrink-0 flex items-center justify-center gap-5 py-1.5 border-t border-[#f1f5f9] bg-white">
        {[
          { color:"#f97316", dash:false, label:"Current Spot" },
          { color:"#16a34a", dash:true,  label:"Breakeven" },
          { color:"#94a3b8", dash:true,  label:"Strike" },
          { color:"rgba(22,163,74,0.5)", dash:false, label:"Profit Zone" },
          { color:"rgba(225,29,72,0.5)", dash:false, label:"Loss Zone" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-5 h-[2px] rounded-full" style={{ background: color }} />
            <span className="text-[8px] text-[#94a3b8]" style={MONO}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SMC TABLE VIEW ────────────────────────────────────────────────────────────
function SMCTableView({ alerts, winRate, smcStatus, busy, authenticated, expiry,
  onTrigger, onClear, onAddWatch,
  histDate, onHistDateChange, histBusy, histErr, histResults, onHistScan, onHistClear,
}: {
  alerts: any[]; winRate: number|null;
  smcStatus: {scanActive:boolean;lastScanAt:string|null;wins:number;losses:number} | null;
  busy: boolean; authenticated: boolean; expiry: string;
  onTrigger: () => void; onClear: () => void; onAddWatch: (leg:OptionLeg) => void;
  histDate: string; onHistDateChange: (d:string) => void;
  histBusy: boolean; histErr: string; histResults: any[]|null;
  onHistScan: () => void; onHistClear: () => void;
}) {
  const [mode, setMode] = useState<"live"|"backtest">("live");

  // Which alerts to show in table
  const tableAlerts = mode === "backtest" && histResults !== null ? histResults : alerts;

  const wins   = tableAlerts.filter(a => a.status === "TARGET" || a.status === "TIME_PROFIT").length;
  const losses = tableAlerts.filter(a => a.status === "SL" || a.status === "TIME_EXIT").length;
  const eod    = tableAlerts.filter(a => a.status === "EOD").length;
  const active = tableAlerts.filter(a => a.status === "ACTIVE").length;
  const total  = wins + losses;
  const wr     = total > 0 ? ((wins / total) * 100).toFixed(1) : null;

  const LOT_QTY = 65; // NIFTY 1 lot = 65 qty

  // concept pill color map
  const conceptColor: Record<string,string> = {
    LiqGrab: "#7c3aed", FVG: "#0284c7", OrdBlock: "#b45309",
    Breaker: "#ea580c", SMTrap: "#e11d48",
  };

  const fmtLotPnl = (n: number) => {
    const abs = Math.abs(n);
    const s   = n >= 0 ? "+" : "−";
    return abs >= 100000 ? `${s}₹${(abs/100000).toFixed(2)}L` : abs >= 1000 ? `${s}₹${(abs/1000).toFixed(1)}K` : `${s}₹${abs.toFixed(0)}`;
  };

  // Overall lot P&L — sum of every trade in the table (realized + unrealized)
  const totalLotPnl   = tableAlerts.reduce((s, a) => s + (a.currentPnL ?? 0) * LOT_QTY, 0);
  const realizedLotPnl = tableAlerts.filter(a => a.status !== "ACTIVE").reduce((s, a) => s + (a.currentPnL ?? 0) * LOT_QTY, 0);

  const COLS = "40px 60px 1fr 80px 70px 72px 72px 72px 90px 130px 80px";

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Mode switcher + action bar ── */}
      <div className="flex items-center gap-3 px-5 py-2.5 bg-white border-b border-[#cbd5e1] flex-shrink-0">

        {/* LIVE / BACKTEST toggle */}
        <div className="flex border border-[#cbd5e1] rounded-sm overflow-hidden">
          {(["live","backtest"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-[9px] font-bold tracking-[1px] cursor-pointer transition-colors ${mode===m?"text-white":"text-[#64748b] hover:bg-[#f1f5f9]"}`}
              style={{...MONO, background:mode===m?(m==="live"?"#7c3aed":"#ea580c"):"transparent"}}>
              {m === "live" ? "▶ LIVE" : "◉ BACKTEST"}
            </button>
          ))}
        </div>

        {mode === "live" ? (
          <>
            {/* Live scan status */}
            {smcStatus?.scanActive ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#7c3aed]/8 border border-[#7c3aed]/40 rounded-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] live-pulse" />
                <span className="text-[9px] font-bold text-[#7c3aed]" style={MONO}>SCANNING LIVE</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#f1f5f9] border border-[#cbd5e1] rounded-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-[#94a3b8]" />
                <span className="text-[9px] text-[#64748b]" style={MONO}>{authenticated ? "MARKET CLOSED" : "NOT AUTHENTICATED"}</span>
              </div>
            )}
            {wr !== null && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 border rounded-sm"
                style={{background:Number(wr)>=70?"#f0fdf4":"#fef2f2", borderColor:Number(wr)>=70?"#bbf7d0":"#fecaca"}}>
                <span className="text-[9px] font-bold" style={{...MONO, color:Number(wr)>=70?"#16a34a":"#e11d48"}}>
                  {wr}% W/R  {wins}W/{losses}L
                </span>
              </div>
            )}
            <div className="text-[9px] text-[#64748b]" style={MONO}>
              <span className="text-[#0284c7] font-bold">{active}</span> active · {alerts.length} total
              {smcStatus?.lastScanAt && ` · last ${new Date(smcStatus.lastScanAt).toLocaleTimeString("en-IN",{hour12:false})}`}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={onTrigger} disabled={busy || !authenticated || isDemoMode}
                className="px-3 py-1.5 text-[9px] font-bold tracking-[1.5px] rounded-sm border cursor-pointer disabled:opacity-40"
                style={{...MONO, background:"#7c3aed18", borderColor:"#7c3aed", color:"#7c3aed"}}>
                {busy ? "SCANNING…" : "▶ SCAN NOW"}
              </button>
              {alerts.length > 0 && (
                <button onClick={onClear}
                  className="px-3 py-1.5 text-[9px] text-[#94a3b8] border border-[#cbd5e1] rounded-sm cursor-pointer hover:border-[#94a3b8]" style={MONO}>
                  CLEAR
                </button>
              )}
            </div>
          </>
        ) : (
          /* Backtest date picker */
          <>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-[#64748b] tracking-[1px]" style={MONO}>DATE</span>
              <input type="date" value={histDate}
                max={(() => { const d = new Date(); d.setDate(d.getDate()-1); return d.toISOString().split("T")[0]; })()}
                onChange={e => onHistDateChange(e.target.value)}
                className="border border-[#cbd5e1] rounded-sm px-2 py-1 text-[11px] bg-white cursor-pointer outline-none" style={MONO} />
              <button onClick={onHistScan} disabled={histBusy || !authenticated || isDemoMode || !expiry}
                className="px-3 py-1.5 text-[9px] font-bold tracking-[1px] rounded-sm border cursor-pointer disabled:opacity-40 transition-colors"
                style={{...MONO, background:"#ea580c18", borderColor:"#ea580c", color:"#ea580c"}}>
                {histBusy ? "SCANNING…" : "◉ RUN BACKTEST"}
              </button>
              {histErr && <span className="text-[9px] text-[#e11d48]" style={MONO}>{histErr}</span>}
            </div>
            {histResults !== null && wr !== null && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 border rounded-sm"
                style={{background:Number(wr)>=70?"#f0fdf4":"#fef2f2", borderColor:Number(wr)>=70?"#bbf7d0":"#fecaca"}}>
                <span className="text-[9px] font-bold" style={{...MONO, color:Number(wr)>=70?"#16a34a":"#e11d48"}}>
                  {histDate} · {wr}% W/R  {wins}W/{losses}L{eod>0?` · ${eod} EOD`:""}
                </span>
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[8px] text-[#94a3b8]" style={MONO}>
                Expiry: {expiry} · min 2 SMC concepts · 09:21–15:30
              </span>
              {histResults !== null && (
                <button onClick={onHistClear}
                  className="px-3 py-1.5 text-[9px] text-[#94a3b8] border border-[#cbd5e1] rounded-sm cursor-pointer hover:border-[#94a3b8]" style={MONO}>
                  CLEAR
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Concept legend ── */}
      <div className="flex items-center gap-2 px-5 py-1.5 bg-[#fafbfc] border-b border-[#e2e8f0] flex-shrink-0 flex-wrap">
        <span className="text-[7px] text-[#94a3b8] tracking-[1px]" style={MONO}>SMC CONCEPTS:</span>
        {Object.entries(conceptColor).map(([k,c]) => (
          <span key={k} className="text-[8px] px-1.5 py-0.5 rounded-sm font-bold"
            style={{...MONO, background:`${c}18`, color:c, border:`1px solid ${c}33`}}>{k}</span>
        ))}
        <span className="text-[7px] text-[#94a3b8] ml-2" style={MONO}>· min 2 concepts · LTP ₹200–₹300 · SL −12% · Target +24% · entry ≥ 09:21</span>
      </div>

      {/* ── Table header ── */}
      <div className="grid flex-shrink-0 border-b-2 border-[#cbd5e1] bg-[#f8fafc]"
        style={{ gridTemplateColumns: COLS }}>
        {["#","TIME","SIGNALS","STRIKE","LTP","SL","T1","T2","STATUS","P&L · LOT (65)",""].map(h => (
          <div key={h} className="px-2 py-2 text-[8px] font-bold tracking-[1.5px] text-[#64748b] uppercase" style={MONO}>{h}</div>
        ))}
      </div>

      {/* ── Table body ── */}
      <div className="flex-1 overflow-y-auto">
        {tableAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[50vh] gap-4">
            <div className="text-[56px] text-[#e2e8f0]">◎</div>
            <p className="text-[11px] text-[#94a3b8] text-center" style={MONO}>
              {mode === "backtest"
                ? "Select a date and click RUN BACKTEST to analyse a past day"
                : !authenticated
                ? "Connect Kite to start SMC scanning"
                : isDemoMode
                ? "SMC scanner requires live data"
                : "No alerts yet · Scanner runs every minute from 09:21 AM"}
            </p>
            {mode === "live" && authenticated && !isDemoMode && (
              <button onClick={onTrigger} disabled={busy}
                className="px-5 py-2.5 text-[10px] font-bold tracking-[2px] rounded-sm border cursor-pointer disabled:opacity-40"
                style={{...MONO, background:"#7c3aed18", borderColor:"#7c3aed", color:"#7c3aed"}}>
                {busy ? "SCANNING…" : "▶ RUN SMC SCAN NOW"}
              </button>
            )}
            {mode === "backtest" && authenticated && !isDemoMode && (
              <button onClick={onHistScan} disabled={histBusy}
                className="px-5 py-2.5 text-[10px] font-bold tracking-[2px] rounded-sm border cursor-pointer disabled:opacity-40"
                style={{...MONO, background:"#ea580c18", borderColor:"#ea580c", color:"#ea580c"}}>
                {histBusy ? "SCANNING…" : "◉ RUN BACKTEST NOW"}
              </button>
            )}
          </div>
        ) : (
          tableAlerts.map((a, idx) => {
            const isCE       = a.direction === "CE";
            const isTimedWin  = a.status === "TIME_PROFIT";
            const isTimedExit = a.status === "TIME_EXIT";
            const rowBg      = a.status === "TARGET" || isTimedWin ? "#f0fdf4" : a.status === "SL" || isTimedExit ? "#fff5f5" : a.status === "EOD" ? "#fefce8" : idx % 2 === 0 ? "#fff" : "#fafafa";
            const dirColor   = isCE ? "#0284c7" : "#e11d48";
            const stColor    = a.status === "TARGET" || isTimedWin ? "#16a34a" : a.status === "SL" || isTimedExit ? "#e11d48" : a.status === "EOD" ? "#b45309" : "#0284c7";
            const pnlUp      = a.currentPnL >= 0;
            const pnlColor   = a.status === "TARGET" || isTimedWin ? "#16a34a" : a.status === "SL" || isTimedExit ? "#e11d48" : pnlUp ? "#16a34a" : "#e11d48";
            const stIcon     = a.status === "TARGET" ? "🎯" : a.status === "SL" ? "🛑" : a.status === "EOD" ? "🕐" : isTimedWin ? "⏱" : isTimedExit ? "⏱" : "⏳";
            const stLabel    = isTimedWin ? "60M PROFIT" : isTimedExit ? "75M EXIT" : a.status;
            // progress bar for ACTIVE
            const sl  = a.rr?.sl  ?? 0;
            const t2  = a.rr?.target2 ?? 0;
            const ltp = a.leg?.ltp ?? a.rr?.entry ?? 0;
            const fillPct = (t2 - sl) > 0 ? Math.min(Math.max(((ltp - sl) / (t2 - sl)) * 100, 0), 100) : 50;

            return (
              <div key={a.id} className="grid border-b border-[#f1f5f9] hover:bg-[#f0f4ff] transition-colors items-center"
                style={{ gridTemplateColumns: COLS, background: rowBg }}>

                {/* # */}
                <div className="px-2 py-2.5 text-[9px] text-[#94a3b8]" style={MONO}>{idx + 1}</div>

                {/* TIME */}
                <div className="px-2 py-2.5">
                  <div className="text-[10px] font-bold text-[#1e293b]" style={MONO}>{a.entryTime}</div>
                  {a.exitTime
                    ? <div className="text-[8px] text-[#94a3b8]" style={MONO}>→{a.exitTime}</div>
                    : <div className="text-[8px] text-[#94a3b8]" style={MONO}>{a.strength}</div>}
                </div>

                {/* SIGNALS */}
                <div className="px-2 py-2.5 flex flex-wrap gap-1">
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm"
                    style={{...MONO, background:`${dirColor}18`, color:dirColor, border:`1px solid ${dirColor}30`}}>
                    {a.direction} {a.score}/5
                  </span>
                  {(a.concepts ?? []).map((c: string) => (
                    <span key={c} className="text-[7px] px-1 py-0.5 rounded-sm font-bold"
                      style={{...MONO, background:`${conceptColor[c] ?? "#64748b"}14`, color:conceptColor[c] ?? "#64748b"}}>
                      {c}
                    </span>
                  ))}
                  {a.trendOk && <span className="text-[7px] text-[#16a34a]" style={MONO}>+EMA✓</span>}
                </div>

                {/* STRIKE */}
                <div className="px-2 py-2.5">
                  <div className="text-[11px] font-bold" style={{...MONO, color:dirColor}}>
                    {a.strike} {a.direction}
                  </div>
                  <div className="text-[8px] text-[#94a3b8]" style={MONO}>spot {a.spot?.toFixed(0)}</div>
                </div>

                {/* LTP (entry) */}
                <div className="px-2 py-2.5 text-[12px] font-bold tabular-nums" style={{...MONO, color:dirColor}}>
                  ₹{a.rr?.entry?.toFixed(2) ?? "—"}
                </div>

                {/* SL */}
                <div className="px-2 py-2.5 text-[11px] font-bold tabular-nums text-[#e11d48]" style={MONO}>
                  ₹{a.rr?.sl?.toFixed(2) ?? "—"}
                </div>

                {/* T1 */}
                <div className="px-2 py-2.5 text-[11px] font-bold tabular-nums text-[#b45309]" style={MONO}>
                  ₹{a.rr?.target1?.toFixed(2) ?? "—"}
                </div>

                {/* T2 */}
                <div className="px-2 py-2.5 text-[11px] font-bold tabular-nums text-[#16a34a]" style={MONO}>
                  ₹{a.rr?.target2?.toFixed(2) ?? "—"}
                </div>

                {/* STATUS + T1/T2 badges + progress bar */}
                <div className="px-2 py-2.5">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-[9px]">{stIcon}</span>
                    <span className="text-[8px] font-bold" style={{...MONO, color:stColor}}>{stLabel}</span>
                  </div>
                  {/* T1 / T2 hit indicators */}
                  <div className="flex gap-1 mb-0.5">
                    <span className="text-[7px] px-1 py-0.5 rounded-sm font-bold" style={{...MONO,
                      background: (a.t1Hit || a.status === "TARGET") ? "#dcfce7" : "#f1f5f9",
                      color:      (a.t1Hit || a.status === "TARGET") ? "#15803d" : "#94a3b8"}}>
                      T1{(a.t1Hit || a.status === "TARGET") ? "✓" : "✗"}
                    </span>
                    <span className="text-[7px] px-1 py-0.5 rounded-sm font-bold" style={{...MONO,
                      background: a.status === "TARGET" ? "#dcfce7" : "#f1f5f9",
                      color:      a.status === "TARGET" ? "#15803d" : "#94a3b8"}}>
                      T2{a.status === "TARGET" ? "✓" : "✗"}
                    </span>
                  </div>
                  {a.status === "ACTIVE" && (() => {
                    // T1 is at 66.7% of SL→T2 range
                    const t1Pct = (a.rr?.target2 - a.rr?.sl) > 0
                      ? Math.min(((a.rr?.target1 - a.rr?.sl) / (a.rr?.target2 - a.rr?.sl)) * 100, 100)
                      : 67;
                    return (
                      <div className="h-1.5 bg-[#e2e8f0] rounded-full overflow-hidden w-full relative">
                        <div className="h-full rounded-full transition-all"
                          style={{width:`${fillPct}%`, background:fillPct >= 67 ? "#16a34a" : fillPct >= 33 ? "#f59e0b" : "#e11d48"}} />
                        {/* T1 tick mark */}
                        <div className="absolute top-0 bottom-0 w-px bg-[#7c3aed] opacity-70"
                          style={{left:`${t1Pct}%`}} />
                      </div>
                    );
                  })()}
                  {a.status !== "ACTIVE" && (
                    <div className="text-[8px] font-bold" style={{...MONO, color:stColor}}>
                      {fmtLotPnl((a.currentPnL ?? 0) * LOT_QTY)}
                    </div>
                  )}
                </div>

                {/* P&L per unit + lot */}
                <div className="px-2 py-2.5">
                  {/* per-unit */}
                  <div className="flex items-baseline gap-1">
                    <span className="text-[11px] font-bold tabular-nums" style={{...MONO, color:pnlColor}}>
                      {pnlUp ? "+" : ""}₹{a.currentPnL?.toFixed(2) ?? "0.00"}
                    </span>
                    <span className="text-[7px] text-[#94a3b8]" style={MONO}>unit</span>
                  </div>
                  {/* lot P&L = unit × 65 */}
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="text-[12px] font-bold tabular-nums" style={{...MONO, color:pnlColor}}>
                      {fmtLotPnl((a.currentPnL ?? 0) * LOT_QTY)}
                    </span>
                    <span className="text-[7px] font-bold" style={{...MONO, color:pnlColor}}>×65</span>
                  </div>
                  <div className="text-[8px]" style={{...MONO, color:pnlColor}}>
                    {pnlUp ? "+" : ""}{a.pnlPct?.toFixed(2) ?? "0.00"}%
                  </div>
                </div>

                {/* Add to watchlist */}
                <div className="px-2 py-2.5 flex items-center justify-center">
                  {a.leg && a.status === "ACTIVE" && (
                    <button onClick={() => onAddWatch(a.leg)}
                      title="Add to watchlist"
                      className="w-6 h-6 flex items-center justify-center rounded text-[11px] font-bold border cursor-pointer transition-all"
                      style={{background:`${dirColor}15`, borderColor:`${dirColor}50`, color:dirColor}}>
                      +
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Footer stats ── */}
      {tableAlerts.length > 0 && (
        <div className="flex-shrink-0 border-t border-[#cbd5e1] bg-white" style={{gap:"1px"}}>
          {mode === "backtest" && histResults !== null && (
            <div className="px-5 py-1.5 bg-[#fef9ec] border-b border-[#fde68a] text-[8px] text-[#b45309]" style={MONO}>
              ◉ BACKTEST  {histDate}  ·  expiry {expiry}  ·  all prices from historical candles  ·  EOD = position open at 15:30
            </div>
          )}
          <div className="grid" style={{gridTemplateColumns:"repeat(7,1fr)", gap:"1px", background:"#cbd5e1"}}>
            {[
              { label:"TOTAL SIGNALS", val:`${tableAlerts.length}`,  color:"#475569" },
              { label:"ACTIVE",        val:`${active}`,              color:"#0284c7" },
              { label:"TARGET HIT",    val:`${wins}`,                color:"#16a34a" },
              { label:"SL HIT",        val:`${losses}`,              color:"#e11d48" },
              { label:"EOD / OPEN",    val:`${eod}`,                 color:"#b45309" },
              { label:"WIN RATE",      val:wr ? `${wr}%` : "—",     color:wr && Number(wr)>=70?"#16a34a":"#e11d48" },
              {
                label: "LOT P&L (65×)",
                val:   tableAlerts.length > 0 ? fmtLotPnl(totalLotPnl) : "—",
                color: totalLotPnl >= 0 ? "#16a34a" : "#e11d48",
                sub:   active > 0 ? `realized ${fmtLotPnl(realizedLotPnl)}` : undefined,
              },
            ].map(({label,val,color,sub}: any) => (
              <div key={label} className="bg-white px-3 py-2.5">
                <div className="text-[7px] tracking-[1.5px] text-[#64748b] uppercase mb-1" style={MONO}>{label}</div>
                <div className="text-[15px] font-bold leading-tight" style={{...MONO, color}}>{val}</div>
                {sub && <div className="text-[7px] text-[#94a3b8] mt-0.5" style={MONO}>{sub}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── WATCHLIST ROW ────────────────────────────────────────────────────────────
function WatchlistRow({ watched, candles3m, expiry, onRemove }:
  { watched:WatchedOption; candles3m:any[]; expiry:string; onRemove:()=>void }) {

  const { leg, status, entryPrice, currentPnL, pnlPct } = watched;
  const isCE = leg.type === "CE";

  // CE = green, PE = red
  const borderClr = isCE ? "#16a34a" : "#e11d48";
  const bgLight   = isCE ? "rgba(22,163,74,0.04)" : "rgba(225,29,72,0.05)";
  const nameClr   = isCE ? "#15803d" : "#be123c";

  const sc       = status==="TARGET"?"#16a34a":status==="SL"?"#e11d48":status==="ACTIVE"?"#0284c7":"#94a3b8";
  const pnlUp    = currentPnL >= 0;
  const pnlColor = status==="TARGET"?"#16a34a":status==="SL"?"#e11d48":pnlUp?"#16a34a":"#e11d48";
  const moveUp   = leg.ltpChange >= 0;

  // ── 3-min candle derived metrics ──────────────────────────────────────────
  const lastC = candles3m.length > 0 ? candles3m[candles3m.length - 1] : null;
  const prevC = candles3m.length > 1 ? candles3m[candles3m.length - 2] : null;

  const rsi3m: number|null = lastC?.rsi14 ?? null;
  const vol3m: number|null = lastC?.volume ?? null;

  // OI/Vol from last 2 candles: ΔOI / (vol1 + vol2)
  let oiVol3m: number|null = null;
  if (lastC && prevC) {
    const dOI  = Math.abs((lastC.oi ?? 0) - (prevC.oi ?? 0));
    const dVol = (lastC.volume ?? 0) + (prevC.volume ?? 0);
    oiVol3m = dVol > 0 ? +(dOI / dVol).toFixed(2) : null;
  } else if (lastC && lastC.volume > 0) {
    oiVol3m = +((lastC.oi ?? 0) / lastC.volume).toFixed(2);
  }

  const rsiColor   = rsi3m === null ? "#94a3b8" : rsi3m >= 70 ? "#e11d48" : rsi3m <= 30 ? "#16a34a" : "#475569";
  const oiVolColor = oiVol3m === null ? "#94a3b8" : oiVol3m < 1 ? "#16a34a" : oiVol3m > 5 ? "#e11d48" : "#b45309";

  const chartUrl = `https://web.sensibull.com/chart?tradingSymbol=${sensibullSym(expiry, leg.strike, leg.type)}`;

  return (
    <div className="rounded overflow-hidden"
      style={{ border:`1.5px solid ${borderClr}33`, borderLeft:`3px solid ${borderClr}`, background:"#fff", boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>

      {/* ── Header: drag handle + strike name + status + remove ── */}
      <div className="flex items-center gap-2 px-3 py-2" style={{background:bgLight}}>
        <span className="text-[#cbd5e1] cursor-grab select-none text-base leading-none">⠿</span>
        <span className="text-[20px] font-bold flex-1" style={{...BEBAS, color:nameClr, letterSpacing:1}}>
          NIFTY {leg.strike} {leg.type}
        </span>
        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm tracking-[1px]"
          style={{...MONO, background:`${sc}14`, color:sc, border:`1px solid ${sc}30`}}>{status}</span>
        <span className="text-[9px] text-[#94a3b8]" style={MONO}>{watched.addedAt}</span>
        <button onClick={onRemove}
          className="w-5 h-5 flex items-center justify-center text-[#94a3b8] hover:text-[#e11d48] cursor-pointer text-sm">×</button>
      </div>

      {/* ── Price row: current price + move% + P&L + chart icon ── */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-[#f1f5f9]">
        <div className="flex items-baseline gap-2" style={MONO}>
          <span className="text-[22px] font-bold tabular-nums" style={{color:borderClr}}>₹{leg.ltp.toFixed(2)}</span>
          {leg.ltpChange != null && (
            <span className="text-[11px] font-bold" style={{color:moveUp?"#16a34a":"#e11d48"}}>
              {moveUp?"▲":"▼"}{Math.abs(leg.ltpChange).toFixed(2)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right" style={MONO}>
            <div className="text-[13px] font-bold tabular-nums" style={{color:pnlColor}}>
              {pnlUp?"+":""}₹{currentPnL.toFixed(2)}
            </div>
            <div className="text-[10px] font-bold" style={{color:pnlColor}}>
              {pnlUp?"+":""}{pnlPct.toFixed(2)}%
            </div>
          </div>
          <button onClick={()=>window.open(chartUrl,"_blank")}
            title="Open chart" style={{color:borderClr}}
            className="w-6 h-6 flex items-center justify-center rounded hover:opacity-60 cursor-pointer transition-opacity">
            <CandleIcon color={borderClr} />
          </button>
        </div>
      </div>

      {/* ── 3-min candle metrics: RSI | OI/Vol (2c) | Volume ── */}
      <div className="grid grid-cols-3 divide-x divide-[#f1f5f9] border-t border-[#f1f5f9] bg-[#fafafa]">
        <div className="px-3 py-2 text-center">
          <div className="text-[7px] text-[#94a3b8] tracking-[1px] uppercase mb-0.5" style={MONO}>RSI 3m</div>
          <div className="text-[13px] font-bold tabular-nums" style={{...MONO, color:rsiColor}}>
            {rsi3m !== null ? rsi3m.toFixed(1) : "—"}
          </div>
        </div>
        <div className="px-3 py-2 text-center">
          <div className="text-[7px] text-[#94a3b8] tracking-[1px] uppercase mb-0.5" style={MONO}>OI/VOL (2c)</div>
          <div className="text-[13px] font-bold tabular-nums" style={{...MONO, color:oiVolColor}}>
            {oiVol3m !== null ? oiVol3m.toFixed(2) : "—"}
          </div>
        </div>
        <div className="px-3 py-2 text-center">
          <div className="text-[7px] text-[#94a3b8] tracking-[1px] uppercase mb-0.5" style={MONO}>VOLUME 3m</div>
          <div className="text-[13px] font-bold text-[#475569] tabular-nums" style={MONO}>
            {vol3m !== null ? fmtOI(vol3m) : "—"}
          </div>
        </div>
      </div>

      {/* ── Result card — always visible, updates as price moves ── */}
      {(() => {
        const isTarget   = status === "TARGET";
        const isSL       = status === "SL";
        const isTimedWin = status === "TIME_PROFIT";
        const isTimedExit= status === "TIME_EXIT";
        const isActive   = status === "ACTIVE" || status === "EXPIRED";

        const bg  = isTarget || isTimedWin ? "#f0fdf4" : isSL || isTimedExit ? "#fef2f2" : "#f8fafc";
        const bdr = isTarget || isTimedWin ? "#bbf7d0" : isSL || isTimedExit ? "#fecaca"  : "#e2e8f0";
        const clr = isTarget || isTimedWin ? "#15803d" : isSL || isTimedExit ? "#be123c"  : "#475569";
        const icon  = isTarget ? "🎯" : isSL ? "🛑" : isTimedWin || isTimedExit ? "⏱" : "⏳";
        const label = isTarget    ? "TARGET HIT — PREDICTION CORRECT"
          : isSL                  ? "STOP LOSS HIT — PREDICTION WRONG"
          : isTimedWin            ? "60-MIN EXIT — PROFIT LOCKED"
          : isTimedExit           ? "75-MIN EXIT — POSITION CLOSED"
          : "IN TRADE — TRACKING";
        const pnlSign  = currentPnL >= 0 ? "+" : "−";
        const rupee    = `${pnlSign}₹${Math.abs(currentPnL).toFixed(2)}`;
        const pctStr   = `${pnlSign}${Math.abs(pnlPct).toFixed(2)}%`;
        const lotPnl   = currentPnL * 65;
        const lotAbs   = Math.abs(lotPnl);
        const lotStr   = lotAbs >= 1000
          ? `${pnlSign}₹${(lotAbs/1000).toFixed(1)}K`
          : `${pnlSign}₹${lotAbs.toFixed(0)}`;
        const rr       = watched.rr;

        return (
          <div className="border-t" style={{background:bg, borderColor:bdr}}>
            {/* Top row: label + P&L */}
            <div className="px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base leading-none">{icon}</span>
                <div>
                  <div className="text-[8px] font-bold tracking-[1px]" style={{...MONO, color:clr}}>{label}</div>
                  <div className="text-[9px] text-[#64748b]" style={MONO}>
                    Entry ₹{entryPrice.toFixed(2)}
                    {!isActive && ` · Exit ₹${leg.ltp.toFixed(2)}`}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[18px] font-bold tabular-nums leading-tight" style={{...MONO, color:clr}}>{rupee}</div>
                <div className="text-[10px] font-bold" style={{...MONO, color:clr}}>{pctStr} per unit</div>
                <div className="text-[11px] font-bold mt-0.5" style={{...MONO, color:clr}}>
                  {lotStr} <span className="text-[8px] font-normal opacity-70">× 65 lot</span>
                </div>
              </div>
            </div>
            {/* Progress bar: SL ←——— current ———→ T2 */}
            {isActive && (() => {
              const sl  = rr.sl;
              const t2  = rr.target2;
              const cur = leg.ltp;
              const range   = t2 - sl;
              const fillPct = range > 0 ? Math.min(Math.max(((cur - sl) / range) * 100, 0), 100) : 50;
              const barClr  = fillPct >= 50 ? "#16a34a" : "#e11d48";
              return (
                <div className="px-3 pb-2">
                  <div className="flex justify-between text-[7px] text-[#94a3b8] mb-1" style={MONO}>
                    <span>SL ₹{sl.toFixed(0)}</span>
                    <span>T ₹{t2.toFixed(0)}</span>
                  </div>
                  <div className="h-2 bg-[#e2e8f0] rounded-full overflow-hidden relative">
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{width:`${fillPct}%`, background:barClr}} />
                    {/* current marker line */}
                    <div className="absolute top-0 bottom-0 w-0.5 bg-[#1e293b]"
                      style={{left:`${fillPct}%`, transform:"translateX(-50%)"}} />
                  </div>
                  <div className="text-center text-[8px] mt-0.5 font-bold" style={{...MONO, color:barClr}}>
                    {fillPct.toFixed(0)}% to target
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}
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
      const y  = d.getFullYear();
      const m  = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      days.push(`${y}-${m}-${dd}`);
    }
    d.setDate(d.getDate() - 1);
  }
  return days;
}

function fmtTradingDay(iso: string): string {
  const [y, mo, dd] = iso.split("-").map(Number);
  const DAYS   = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
  const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const day = new Date(y, mo - 1, dd).getDay();
  return `${String(dd).padStart(2,"0")} ${MONTHS[mo-1]} ${y}  ·  ${DAYS[day]}`;
}

// ─── OHLC CSV TAB ─────────────────────────────────────────────────────────────
function OhlcTab({ expiry, rows, ohlcDate, setOhlcDate, ohlcCE, setOhlcCE, ohlcPE, setOhlcPE, busy, setBusy }:{
  expiry:string; rows:OptionsRow[];
  ohlcDate:string; setOhlcDate:(d:string)=>void;
  ohlcCE:{token:number;strike:number}|null; setOhlcCE:(v:{token:number;strike:number}|null)=>void;
  ohlcPE:{token:number;strike:number}|null; setOhlcPE:(v:{token:number;strike:number}|null)=>void;
  busy:boolean; setBusy:(v:boolean)=>void;
}) {
  type HistRow = { strike: number; isATM: boolean; ce: { token: number; open: number|null }; pe: { token: number; open: number|null } };
  const [histData, setHistData]       = useState<{ spot: number; atm: number; rows: HistRow[] } | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);

  const tradingDays = useMemo(() => getTradingDays(30), []);

  const inRange = (p: number | null | undefined) => p != null && p >= 200 && p <= 300;

  // Single fetch: historical NIFTY spot → historical ATM → ±15 strikes → 9:15 prices
  // All done server-side so the correct historical ATM is always used.
  useEffect(() => {
    if (!ohlcDate || !expiry) return;
    if (isDemoMode) {
      setHistData({ spot: 0, atm: 0, rows: rows.map(r => ({ strike: r.strike, isATM: r.isATM, ce: { token: r.ce.token, open: null }, pe: { token: r.pe.token, open: null } })) });
      return;
    }
    setHistData(null);
    setOhlcCE(null);
    setOhlcPE(null);
    setLoadingHist(true);
    optionsApi.historicalOpenPrices(ohlcDate, expiry)
      .then((d: any) => {
        setHistData(d);
        // Auto-select inside .then() — d is the fresh data, no stale-closure risk
        const bCE = d.rows
          .filter((r: HistRow) => inRange(r.ce.open))
          .sort((a: HistRow, b: HistRow) => (b.ce.open ?? 0) - (a.ce.open ?? 0))[0];
        const bPE = d.rows
          .filter((r: HistRow) => inRange(r.pe.open))
          .sort((a: HistRow, b: HistRow) => (b.pe.open ?? 0) - (a.pe.open ?? 0))[0];
        if (bCE) setOhlcCE({ token: bCE.ce.token, strike: bCE.strike });
        if (bPE) setOhlcPE({ token: bPE.pe.token, strike: bPE.strike });
      })
      .catch(() => {})
      .finally(() => setLoadingHist(false));
  }, [ohlcDate, expiry]);

  const displayRows = histData?.rows ?? [];

  // Derived best-range rows (for banner + ★ label in table)
  const bestCERow = displayRows
    .filter(r => inRange(r.ce.open))
    .sort((a, b) => (b.ce.open ?? 0) - (a.ce.open ?? 0))[0];
  const bestPERow = displayRows
    .filter(r => inRange(r.pe.open))
    .sort((a, b) => (b.pe.open ?? 0) - (a.pe.open ?? 0))[0];

  const hasPrices = displayRows.length > 0 && displayRows.some(r => r.ce.open != null || r.pe.open != null);

  function symbol(strike: number, type: "CE"|"PE") {
    const exp = new Date(expiry);
    const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const ddmmmyy = `${String(exp.getUTCDate()).padStart(2,"0")}${MONTHS[exp.getUTCMonth()]}${String(exp.getUTCFullYear()).slice(-2)}`;
    return `NIFTY${ddmmmyy}${strike}${type}`;
  }

  async function downloadOne(token: number, strike: number, type: "CE"|"PE") {
    const d = await optionsApi.candles(token, ohlcDate, "minute") as { rows: any[] };
    const filename = `${ohlcDate}_${symbol(strike, type)}.csv`;
    const header   = "Date,Open,High,Low,Close,Volume,OI,RSI(14)\n";
    const body     = d.rows.map(r =>
      `${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume},${r.oi ?? ""},${r.rsi14 ?? ""}`
    ).join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownload() {
    if (!ohlcCE && !ohlcPE) { alert("Select at least one CE or PE"); return; }
    setBusy(true);
    try {
      if (ohlcCE) await downloadOne(ohlcCE.token, ohlcCE.strike, "CE");
      if (ohlcPE) await downloadOne(ohlcPE.token, ohlcPE.strike, "PE");
    } catch (e: any) { alert("Download failed: " + e.message); }
    finally { setBusy(false); }
  }

  // ── GRID COLUMNS: [TIME 44px | CE 1fr | STRIKE 68px | PE 1fr | TIME 44px]
  const GRID = "44px 1fr 68px 1fr 44px";

  // Small time-corner cell (appears on both far sides of every row)
  function TimeCorner({ side }: { side: "CE"|"PE" }) {
    return (
      <div className={`flex flex-col items-center justify-center py-2 gap-0.5
        ${side === "CE" ? "bg-[#f0f7ff]" : "bg-[#fff0f3]"}`}>
        <div className="text-[7px] font-bold tracking-[0.5px]"
          style={{...MONO, color: side==="CE" ? "#0284c7" : "#e11d48"}}>
          {side}
        </div>
        <div className="text-[8px] font-bold text-[#64748b]" style={MONO}>9:15</div>
        <div className="text-[6px] text-[#94a3b8]" style={MONO}>AM</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto flex items-start justify-center pt-6 px-4 pb-8">
      <div className="w-full max-w-[680px] space-y-4">

        {/* ── Header: title + 9:15 AM ──── 3:30 PM ── */}
        <div className="bg-white border border-[#cbd5e1] rounded-md shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-[#cbd5e1]" style={{background:"rgba(2,132,199,0.04)"}}>
            <div className="flex items-center justify-between">
              {/* Left corner: 9:15 AM */}
              <div className="flex items-center gap-2">
                <div className="px-2.5 py-1.5 rounded bg-[#16a34a]/10 border border-[#16a34a]/30">
                  <div className="text-[7px] text-[#16a34a]/70 tracking-[1px] uppercase leading-none mb-0.5" style={MONO}>OPEN</div>
                  <div className="text-[14px] font-bold text-[#16a34a] leading-none" style={MONO}>9:15 AM</div>
                </div>
                <div className="text-[#cbd5e1]" style={MONO}>────</div>
              </div>

              {/* Center: title */}
              <div className="text-center">
                <div className="text-[15px] tracking-[2px] text-[#0284c7]" style={BEBAS}>OHLC CSV DOWNLOAD</div>
                <div className="text-[8px] text-[#64748b]" style={MONO}>
                  {histData ? `Spot ₹${histData.spot} · ATM ${histData.atm} · ${displayRows.length} strikes` : `${displayRows.length} strikes`} · OHLCV + OI + RSI(14)
                </div>
              </div>

              {/* Right corner: 3:30 PM */}
              <div className="flex items-center gap-2">
                <div className="text-[#cbd5e1]" style={MONO}>────</div>
                <div className="px-2.5 py-1.5 rounded bg-[#e11d48]/10 border border-[#e11d48]/30">
                  <div className="text-[7px] text-[#e11d48]/70 tracking-[1px] uppercase leading-none mb-0.5" style={MONO}>CLOSE</div>
                  <div className="text-[14px] font-bold text-[#e11d48] leading-none" style={MONO}>3:30 PM</div>
                </div>
              </div>
            </div>
          </div>

          {/* Date dropdown */}
          <div className="px-5 py-3">
            <div className="text-[8px] text-[#64748b] tracking-[1.5px] uppercase mb-2" style={MONO}>
              Select Date — Last 30 Trading Days
            </div>
            <Select value={ohlcDate} onValueChange={setOhlcDate}>
              <SelectTrigger className="w-full border-[#cbd5e1] bg-[#f8fafc] text-[11px] h-9" style={MONO}>
                <SelectValue placeholder="Select date" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {tradingDays.map(d => (
                  <SelectItem key={d} value={d} className="text-[11px]" style={MONO}>
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
              <div className="text-[8px] font-bold tracking-[1.5px] text-[#475569] uppercase" style={MONO}>
                ★ TOP OPENING PRICE · {fmtTradingDay(ohlcDate)} · ₹200–₹300 SCAN RANGE
              </div>
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr]">
              {/* CE best */}
              <div className={`px-5 py-3 ${bestCERow ? "" : "opacity-40"}`}>
                <div className="text-[8px] text-[#94a3b8] tracking-[1px] uppercase mb-1" style={MONO}>
                  CE · Best Opening
                </div>
                {bestCERow ? (
                  <>
                    <div className="text-[17px] font-bold text-[#0284c7]" style={MONO}>
                      {bestCERow.strike} CE
                    </div>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-[9px] text-[#64748b]" style={MONO}>9:15 AM</span>
                      <span className="text-[15px] font-bold text-[#16a34a]" style={MONO}>
                        ₹{bestCERow.ce.open}
                      </span>
                      <span className="text-[8px] font-bold text-[#16a34a]" style={MONO}>★ BEST</span>
                    </div>
                  </>
                ) : (
                  <div className="text-[9px] text-[#94a3b8]" style={MONO}>No CE in ₹200–₹300 range</div>
                )}
              </div>

              {/* Divider */}
              <div className="w-px bg-[#f1f5f9] my-2" />

              {/* PE best */}
              <div className={`px-5 py-3 text-right ${bestPERow ? "" : "opacity-40"}`}>
                <div className="text-[8px] text-[#94a3b8] tracking-[1px] uppercase mb-1" style={MONO}>
                  PE · Best Opening
                </div>
                {bestPERow ? (
                  <>
                    <div className="text-[17px] font-bold text-[#e11d48]" style={MONO}>
                      {bestPERow.strike} PE
                    </div>
                    <div className="flex items-baseline gap-2 justify-end mt-0.5">
                      <span className="text-[8px] font-bold text-[#16a34a]" style={MONO}>★ BEST</span>
                      <span className="text-[15px] font-bold text-[#16a34a]" style={MONO}>
                        ₹{bestPERow.pe.open}
                      </span>
                      <span className="text-[9px] text-[#64748b]" style={MONO}>9:15 AM</span>
                    </div>
                  </>
                ) : (
                  <div className="text-[9px] text-[#94a3b8]" style={MONO}>No PE in ₹200–₹300 range</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Strike table: TIME | CE | STRIKE | PE | TIME ── */}
        <div className="bg-white border border-[#cbd5e1] rounded-md shadow-sm overflow-hidden">

          {/* Table header */}
          <div className="grid border-b border-[#cbd5e1] bg-[#f1f5f9]" style={{gridTemplateColumns: GRID}}>
            <div className="py-2 text-center text-[7px] font-bold tracking-[1px] text-[#0284c7] uppercase bg-[#e8f4ff] border-r border-[#cbd5e1]" style={MONO}>
              TIME
            </div>
            <div className="px-3 py-2 text-right text-[8px] font-bold tracking-[1.5px] text-[#0284c7] uppercase" style={MONO}>
              CE · 9:15 AM OPENING
            </div>
            <div className="py-2 text-center text-[8px] tracking-[1.5px] text-[#64748b] uppercase border-x border-[#cbd5e1] bg-[#e8eef5]" style={MONO}>
              STRIKE
            </div>
            <div className="px-3 py-2 text-left text-[8px] font-bold tracking-[1.5px] text-[#e11d48] uppercase" style={MONO}>
              PE · 9:15 AM OPENING
            </div>
            <div className="py-2 text-center text-[7px] font-bold tracking-[1px] text-[#e11d48] uppercase bg-[#fff0f3] border-l border-[#cbd5e1]" style={MONO}>
              TIME
            </div>
          </div>

          {/* Loading state */}
          {loadingHist && (
            <div className="flex items-center justify-center gap-2 py-6 border-b border-[#f1f5f9]">
              <div className="w-4 h-4 border-2 border-[#0284c7]/20 border-t-[#0284c7] rounded-full animate-spin" />
              <span className="text-[9px] text-[#94a3b8]" style={MONO}>Loading {fmtTradingDay(ohlcDate)} historical strikes…</span>
            </div>
          )}

          {/* Strike rows */}
          <div className="max-h-[400px] overflow-y-auto divide-y divide-[#f8fafc]">
            {displayRows.map(r => {
              const ceP      = r.ce.open;
              const peP      = r.pe.open;
              const ceOk     = inRange(ceP);
              const peOk     = inRange(peP);
              const ceSel    = ohlcCE?.token === r.ce.token;
              const peSel    = ohlcPE?.token === r.pe.token;
              const isBestCE = bestCERow?.strike === r.strike;
              const isBestPE = bestPERow?.strike === r.strike;
              const rowBg    = r.isATM ? "bg-[#eff6ff]" : "bg-white";

              return (
                <div key={r.strike} className={`grid ${rowBg} transition-colors`}
                  style={{gridTemplateColumns: GRID}}>

                  {/* Left TIME corner */}
                  <TimeCorner side="CE" />

                  {/* CE price — clickable */}
                  <button
                    onClick={() => setOhlcCE(ceSel ? null : { token: r.ce.token, strike: r.strike })}
                    className={`px-4 py-3 text-right cursor-pointer transition-colors border-r border-[#f1f5f9]
                      ${ceSel
                        ? "bg-[#0284c7]/10 ring-1 ring-inset ring-[#0284c7]/40"
                        : ceOk ? "hover:bg-[#f0fdf4]" : "hover:bg-[#f8fafc]"}`}>
                    {ceP != null ? (
                      <div>
                        <div className={`text-[13px] font-bold tabular-nums leading-tight
                          ${ceSel ? "text-[#0284c7]" : ceOk ? "text-[#16a34a]" : "text-[#334155]"}`} style={MONO}>
                          {ceSel ? "✓ " : ""}₹{ceP}
                        </div>
                        <div className="text-[7px] mt-0.5 font-semibold" style={MONO}>
                          {ceSel
                            ? <span className="text-[#0284c7]">SELECTED</span>
                            : isBestCE ? <span className="text-[#16a34a]">★ BEST ₹200–₹300</span>
                            : ceOk ? <span className="text-[#16a34a]">✓ IN RANGE</span>
                            : <span className="text-[#94a3b8]">{r.strike} CE</span>}
                        </div>
                      </div>
                    ) : loadingHist ? (
                      <span className="text-[9px] text-[#e2e8f0]" style={MONO}>…</span>
                    ) : (
                      <span className="text-[9px] text-[#e2e8f0]" style={MONO}>—</span>
                    )}
                  </button>

                  {/* Strike — center */}
                  <div className={`py-3 text-center border-x border-[#e2e8f0] flex flex-col items-center justify-center
                    ${r.isATM ? "bg-[#dbeafe]" : "bg-[#f8fafc]"}`}>
                    <div className={`text-[12px] font-bold tabular-nums leading-none
                      ${r.isATM ? "text-[#0284c7]" : "text-[#1e293b]"}`} style={MONO}>
                      {r.strike}
                    </div>
                    {r.isATM && (
                      <div className="text-[6px] text-[#0284c7]/60 tracking-[1px] mt-0.5 font-bold" style={MONO}>ATM</div>
                    )}
                  </div>

                  {/* PE price — clickable */}
                  <button
                    onClick={() => setOhlcPE(peSel ? null : { token: r.pe.token, strike: r.strike })}
                    className={`px-4 py-3 text-left cursor-pointer transition-colors border-l border-[#f1f5f9]
                      ${peSel
                        ? "bg-[#e11d48]/10 ring-1 ring-inset ring-[#e11d48]/40"
                        : peOk ? "hover:bg-[#f0fdf4]" : "hover:bg-[#f8fafc]"}`}>
                    {peP != null ? (
                      <div>
                        <div className={`text-[13px] font-bold tabular-nums leading-tight
                          ${peSel ? "text-[#e11d48]" : peOk ? "text-[#16a34a]" : "text-[#334155]"}`} style={MONO}>
                          {peSel ? "✓ " : ""}₹{peP}
                        </div>
                        <div className="text-[7px] mt-0.5 font-semibold" style={MONO}>
                          {peSel
                            ? <span className="text-[#e11d48]">SELECTED</span>
                            : isBestPE ? <span className="text-[#16a34a]">★ BEST ₹200–₹300</span>
                            : peOk ? <span className="text-[#16a34a]">✓ IN RANGE</span>
                            : <span className="text-[#94a3b8]">{r.strike} PE</span>}
                        </div>
                      </div>
                    ) : loadingHist ? (
                      <span className="text-[9px] text-[#e2e8f0]" style={MONO}>…</span>
                    ) : (
                      <span className="text-[9px] text-[#e2e8f0]" style={MONO}>—</span>
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
              {displayRows.length} strikes · Green = ₹200–₹300 · ★ = best opening price · Click to select/deselect
            </span>
            {loadingHist && (
              <div className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 border border-[#0284c7]/30 border-t-[#0284c7] rounded-full animate-spin" />
                <span className="text-[7px] text-[#94a3b8]" style={MONO}>fetching historical prices…</span>
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
                  <span className="text-[7px] font-bold text-[#0284c7] uppercase tracking-[1px]" style={MONO}>CE FILE</span>
                  <span className="text-[7px] text-[#94a3b8]" style={MONO}>9:15 AM → 3:30 PM</span>
                </div>
                <div className="text-[9px] text-[#0284c7] font-bold truncate" style={MONO}>
                  {ohlcDate}_{symbol(ohlcCE.strike, "CE")}.csv
                </div>
                <div className="text-[8px] text-[#64748b] mt-0.5" style={MONO}>
                  Open ₹{displayRows.find(r => r.ce.token === ohlcCE.token)?.ce.open ?? "—"} · Minute candles
                </div>
              </div>
            ) : <div />}
            {ohlcPE ? (
              <div className="px-4 py-2.5 rounded-md border border-[#e11d48]/30 bg-[#e11d48]/5">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[7px] font-bold text-[#e11d48] uppercase tracking-[1px]" style={MONO}>PE FILE</span>
                  <span className="text-[7px] text-[#94a3b8]" style={MONO}>9:15 AM → 3:30 PM</span>
                </div>
                <div className="text-[9px] text-[#e11d48] font-bold truncate" style={MONO}>
                  {ohlcDate}_{symbol(ohlcPE.strike, "PE")}.csv
                </div>
                <div className="text-[8px] text-[#64748b] mt-0.5" style={MONO}>
                  Open ₹{displayRows.find(r => r.pe.token === ohlcPE.token)?.pe.open ?? "—"} · Minute candles
                </div>
              </div>
            ) : <div />}
          </div>
        )}

        {/* ── Download button ── */}
        <button
          onClick={handleDownload}
          disabled={busy || (!ohlcCE && !ohlcPE)}
          className="w-full py-3.5 text-[12px] font-bold tracking-[3px] rounded-md cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{...MONO,
            background: busy ? "rgba(2,132,199,0.15)" : "rgba(2,132,199,0.1)",
            border: "1.5px solid #0284c7",
            color: "#0284c7",
          }}>
          {busy ? "DOWNLOADING…" : "↓  DOWNLOAD CSV  (9:15 AM – 3:30 PM)"}
        </button>

        <div className="text-[8px] text-[#94a3b8] text-center" style={MONO}>
          Each selected leg → 1 CSV file · Full day minute candles · OHLCV + OI + RSI(14)
        </div>
      </div>
    </div>
  );
}

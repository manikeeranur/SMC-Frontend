"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "@/lib/theme";
import { LOT_SIZE, NUM_LOTS, MARKET_HOLIDAYS_MAP } from "@/lib/constants";

const API = process.env.NEXT_PUBLIC_API_URL || "http://13.61.175.6:4000";

const MONO  = { fontFamily: "'Space Mono', monospace" } as const;
const BEBAS = { fontFamily: "'Bebas Neue', sans-serif" } as const;

type Row = Record<string, string>;
type DaySummary = { date: string; totalPnL: number; trades: number; wins: number };

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAY_NAMES = ["SUN","MON","TUE","WED","THU","FRI","SAT"];


const STATUS_COLOR: Record<string, string> = {
  TARGET:      "#22c55e",
  TIME_PROFIT: "#86efac",
  SL:          "#ef4444",
  TIME_EXIT:   "#f97316",
  EOD:         "#94a3b8",
  ACTIVE:      "#60a5fa",
};

function statusLabel(s: string) {
  return s === "TARGET" ? "TARGET ✓"
    : s === "TIME_PROFIT" ? "T-PROFIT"
    : s === "SL"          ? "SL ✗"
    : s === "TIME_EXIT"   ? "T-EXIT"
    : s === "EOD"         ? "EOD"
    : s;
}

function dirColor(d: string) {
  return d === "CE" ? "#0284c7" : "#e11d48";
}

function fmtTime(t: string) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function pnlColor(p: number) {
  return p >= 0 ? "#22c55e" : "#ef4444";
}

function fmtLotPnl(n: number) {
  const abs = Math.abs(n);
  const s   = n >= 0 ? "+" : "−";
  return abs >= 100000
    ? `${s}₹${(abs / 100000).toFixed(2)}L`
    : abs >= 1000
    ? `${s}₹${(abs / 1000).toFixed(1)}K`
    : `${s}₹${abs.toFixed(0)}`;
}

function fmtLotPnlFull(n: number) {
  const sign = n >= 0 ? "+" : "−";
  const [int, dec] = Math.abs(n).toFixed(2).split(".");
  const intComma = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}₹${intComma}.${dec}`;
}

function buildCalendar(year: number, month: number): (number | null)[] {
  const firstDay    = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const LOT_QTY = LOT_SIZE * NUM_LOTS;
const COLS_DESKTOP = "40px 120px 1fr 90px 70px 70px 72px 72px 90px 130px 65px";

export function ResultsContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [tab, setTab]           = useState<"backtest" | "live">("backtest");
  const [dates, setDates]       = useState<{ backtest: string[]; live: string[] }>({ backtest: [], live: [] });
  const [selDate, setSelDate]   = useState("");
  const [rows, setRows]         = useState<Row[]>([]);
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState("");
  const [viewMode, setViewMode] = useState<"table" | "calendar">("calendar");
  const [summary, setSummary]   = useState<DaySummary[]>([]);
  const [calMonth, setCalMonth] = useState<{ year: number; month: number }>(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() + 1 };
  });

  useEffect(() => {
    fetch(`${API}/api/results`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        setDates(d);
        const first = d["backtest"]?.[0];
        if (first) setSelDate(first);
      })
      .catch(() => setErr("Failed to load dates"));
  }, []);

  useEffect(() => {
    const first = dates[tab]?.[0] ?? "";
    setSelDate(first);
    setRows([]);
  }, [tab]);

  useEffect(() => {
    if (!selDate) return;
    setLoading(true);
    setErr("");
    fetch(`${API}/api/results?type=${tab}&date=${selDate}`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setErr(d.error); setRows([]); }
        else setRows(d.rows ?? []);
      })
      .catch(() => setErr("Failed to load data"))
      .finally(() => setLoading(false));
  }, [selDate, tab]);

  // Fetch per-day summary for calendar view
  useEffect(() => {
    fetch(`${API}/api/results/summary?type=${tab}`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => setSummary(d.summary ?? []))
      .catch(() => {});
  }, [tab]);

  const summaryMap = useMemo(() => {
    const m: Record<string, DaySummary> = {};
    for (const s of summary) m[s.date] = s;
    return m;
  }, [summary]);

  // Month P&L totals for calendar footer
  const monthStats = useMemo(() => {
    const prefix = `${calMonth.year}-${String(calMonth.month).padStart(2, "0")}`;
    const days = Object.values(summaryMap).filter(s => s.date.startsWith(prefix));
    const totalPnL = days.reduce((s, d) => s + d.totalPnL, 0);
    const trades   = days.reduce((s, d) => s + d.trades, 0);
    const wins     = days.reduce((s, d) => s + d.wins, 0);
    return { totalPnL, trades, wins, days: days.length };
  }, [summaryMap, calMonth]);

  const wins     = rows.filter(r => r.Status === "TARGET" || r.Status === "TIME_PROFIT").length;
  const losses   = rows.filter(r => r.Status === "SL" || r.Status === "TIME_EXIT").length;
  const eod      = rows.filter(r => r.Status === "EOD").length;
  const closed   = wins + losses;
  const winRate  = closed > 0 ? ((wins / closed) * 100).toFixed(1) : null;
  const totalPnL = rows.reduce((s, r) => s + (parseFloat(r.PnL) || 0), 0);
  const lotPnL   = totalPnL * LOT_QTY;

  const tabAccent = tab === "backtest" ? "#ea580c" : "#7c3aed";

  return (
    <div className="h-full flex flex-col overflow-hidden"
      style={{ background: isDark ? "#080b0f" : "#fff", color: isDark ? "#e2e8f0" : "#1e293b" }}>

      {/* ── Tabs + controls ── */}
      <div className="flex flex-wrap items-center gap-2 px-3 sm:px-5 py-2.5 border-b flex-shrink-0 overflow-x-auto"
        style={{ borderColor: isDark ? "#1e2a3a" : "#e2e8f0", background: isDark ? "#080b0f" : "#fff" }}>

        <div className="flex border rounded-sm overflow-hidden flex-shrink-0"
          style={{ borderColor: isDark ? "#1e2a3a" : "#cbd5e1" }}>
          {(["backtest", "live"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="px-2 sm:px-3 py-1.5 text-[9px] font-bold tracking-[1px] cursor-pointer transition-colors whitespace-nowrap"
              style={{
                ...MONO,
                background: tab === t ? (t === "backtest" ? "#ea580c" : "#7c3aed") : "transparent",
                color: tab === t ? "#fff" : isDark ? "#64748b" : "#64748b",
              }}>
              {t === "backtest" ? "◉ BACKTEST" : "▶ LIVE"}
            </button>
          ))}
        </div>

        {viewMode === "table" && winRate !== null && (
          <div className="flex items-center gap-1.5 px-2 py-1 border rounded-sm flex-shrink-0"
            style={{
              background: Number(winRate) >= 70 ? (isDark ? "#052e16" : "#f0fdf4") : (isDark ? "#2d0505" : "#fef2f2"),
              borderColor: Number(winRate) >= 70 ? (isDark ? "#166534" : "#bbf7d0") : (isDark ? "#991b1b" : "#fecaca"),
            }}>
            <span className="text-[9px] font-bold whitespace-nowrap"
              style={{ ...MONO, color: Number(winRate) >= 70 ? "#16a34a" : "#e11d48" }}>
              {winRate}% · {wins}W/{losses}L{eod > 0 ? ` · ${eod}E` : ""}
            </span>
          </div>
        )}

        {viewMode === "table" && rows.length > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[7px] tracking-[1px]"
              style={{ ...MONO, color: isDark ? "#4a6080" : "#94a3b8" }}>LOT P&L</span>
            <span className="text-[13px] font-bold" style={{ ...BEBAS, color: pnlColor(lotPnL) }}>
              {lotPnL >= 0 ? "+" : ""}₹{Math.abs(lotPnL).toFixed(0)}
            </span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {viewMode === "table" && (
            <>
              <span className="hidden sm:block text-[9px]"
                style={{ ...MONO, color: isDark ? "#4a6080" : "#94a3b8" }}>DATE:</span>
              <select value={selDate} onChange={e => setSelDate(e.target.value)}
                className="text-[10px] px-2 py-1 rounded-sm cursor-pointer outline-none"
                style={{
                  ...MONO,
                  background: isDark ? "#0f1923" : "#f8fafc",
                  border: `1px solid ${isDark ? "#2a3a4a" : "#cbd5e1"}`,
                  color: isDark ? "#e2e8f0" : "#1e293b",
                }}>
                {(dates[tab] ?? []).map(d => <option key={d} value={d}>{d}</option>)}
                {!(dates[tab]?.length) && <option value="">— no files —</option>}
              </select>
            </>
          )}

          {/* Calendar / Table toggle */}
          <button
            onClick={() => setViewMode(v => v === "calendar" ? "table" : "calendar")}
            title={viewMode === "calendar" ? "Table view" : "Calendar view"}
            className="p-1.5 rounded-sm border cursor-pointer transition-colors flex-shrink-0"
            style={{
              background: viewMode === "calendar" ? tabAccent : (isDark ? "#0f1923" : "#f8fafc"),
              borderColor: isDark ? "#2a3a4a" : "#cbd5e1",
              color: viewMode === "calendar" ? "#fff" : (isDark ? "#4a6080" : "#64748b"),
            }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ══ CALENDAR VIEW ══ */}
      {viewMode === "calendar" && (
        <div className="flex-1 overflow-auto px-3 sm:px-5 py-4 flex flex-col">
          {/* Month navigation */}
          <div className="flex items-center justify-center gap-4 mb-4 flex-shrink-0">
            <button
              onClick={() => setCalMonth(m => {
                const d = new Date(m.year, m.month - 2, 1);
                return { year: d.getFullYear(), month: d.getMonth() + 1 };
              })}
              className="w-7 h-7 flex items-center justify-center rounded cursor-pointer text-base font-bold transition-colors"
              style={{ background: isDark ? "#0f1923" : "#f1f5f9", color: isDark ? "#e2e8f0" : "#1e293b" }}>
              ‹
            </button>
            <span className="text-[12px] font-bold tracking-[2px]"
              style={{ ...MONO, color: isDark ? "#e2e8f0" : "#1e293b", minWidth: 160, textAlign: "center" }}>
              {MONTH_NAMES[calMonth.month - 1].toUpperCase()} {calMonth.year}
            </span>
            <button
              onClick={() => setCalMonth(m => {
                const d = new Date(m.year, m.month, 1);
                return { year: d.getFullYear(), month: d.getMonth() + 1 };
              })}
              className="w-7 h-7 flex items-center justify-center rounded cursor-pointer text-base font-bold transition-colors"
              style={{ background: isDark ? "#0f1923" : "#f1f5f9", color: isDark ? "#e2e8f0" : "#1e293b" }}>
              ›
            </button>
          </div>
        <div className="p-1 rounded border"
          style={{border: `1px solid ${isDark ? "#1e2a3a" : "#e2e8f0"}`}}
            >
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-1.5 flex-shrink-0">
            {DAY_NAMES.map(d => (
              <div key={d} className="text-center text-[8px] md:text-[12px] font-bold tracking-[1.5px] py-1.5 rounded-sm"
                style={{ ...MONO, color: isDark ? "#94a3b8" : "#475569", background: isDark ? "#1a2332" : "#e2e8f0" }}>{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1 flex-shrink-0">
            {buildCalendar(calMonth.year, calMonth.month).map((day, i) => {
              if (!day) return <div key={i} className="min-h-[56px] sm:min-h-[72px]" />;
              const dateStr = `${calMonth.year}-${String(calMonth.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const data    = summaryMap[dateStr];
              const lotPnl  = data ? data.totalPnL * LOT_QTY : null;
              const hasData = !!data;
              const isToday   = dateStr === new Date().toISOString().slice(0, 10);
              const holiday   = MARKET_HOLIDAYS_MAP[dateStr];
              const isHoliday = !!holiday && !hasData;
              const profitBg  = "rgba(22, 163, 74, 0.1)";
              const lossBg    = "rgba(225, 29, 72, 0.1)";
              const noTradeBg = "rgba(100, 116, 139, 0.1)";
              const holidayBg = "rgba(251, 191, 36, 0.35)";
              const bg          = hasData ? (lotPnl! >= 0 ? profitBg : lossBg) : isHoliday ? holidayBg : noTradeBg;
              const borderColor = isToday ? tabAccent
                : hasData    ? (lotPnl! >= 0 ? "rgba(22,163,74,0.6)"  : "rgba(225,29,72,0.6)")
                : isHoliday  ? "rgba(251,191,36,0.6)"
                : "rgba(100,116,139,0.3)";
              const pnlTxt = hasData ? (lotPnl! >= 0 ? "#16a34a" : "#e11d48") : "";
              return (
                <div key={i}
                  onClick={() => { if (hasData) { setSelDate(dateStr); setViewMode("table"); } }}
                  className="rounded-lg p-1.5 sm:p-2 min-h-[56px] sm:min-h-[72px] flex flex-col transition-colors"
                  style={{
                    background: bg,
                    border: `${isToday ? "2px" : "1px"} solid ${borderColor}`,
                    cursor: hasData ? "pointer" : "default",
                  }}>
                  <span className="text-[10px] md:text-[12px] font-bold"
                    style={{ ...MONO, color: isToday ? tabAccent : (isDark ? "#cbd5e1" : "#334155") }}>{day}</span>
                  {isHoliday && (
                    <span className="text-[10px] md:text-[12px] font-bold leading-tight mt-0.5 break-words"
                      style={{ ...MONO, color: "#b45309" }}>
                      {holiday}
                    </span>
                  )}
                  {hasData && lotPnl !== null && (
                    <>
                      <span className="sm:hidden text-[10px] md:text-[12px] font-bold mt-auto leading-tight"
                        style={{ ...MONO, color: pnlTxt }}>
                        {fmtLotPnl(lotPnl)}
                      </span>
                      <span className="hidden sm:block text-[10px] md:text-[12px] font-bold mt-auto leading-tight"
                        style={{ ...MONO, color: pnlTxt }}>
                        {fmtLotPnlFull(lotPnl)}
                      </span>
                      <span className="text-[7px] mt-0.5 hidden sm:block"
                        style={{ ...MONO, color: isDark ? "#94a3b8" : "#475569" }}>
                        {data.trades}T · {data.wins}W
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
          {/* Monthly summary footer */}
          {monthStats.days > 0 && (
            <div className="mt-4 flex-shrink-0 rounded-xl overflow-hidden border"
              style={{ borderColor: isDark ? "#1e2a3a" : "#e2e8f0", background: isDark ? "#0d1420" : "#f8fafc" }}>
              <div className="grid grid-cols-4" style={{ gap: "1px", background: isDark ? "#1e2a3a" : "#e2e8f0" }}>
                {[
                  { label: "TRADE DAYS",   val: `${monthStats.days}`,                                        color: isDark ? "#94a3b8" : "#475569" },
                  { label: "TOTAL TRADES", val: `${monthStats.trades}`,                                      color: isDark ? "#94a3b8" : "#475569" },
                  { label: "WIN RATE",     val: monthStats.trades > 0 ? `${((monthStats.wins / monthStats.trades) * 100).toFixed(0)}%` : "—",
                                                                                                              color: monthStats.trades > 0 && monthStats.wins / monthStats.trades >= 0.7 ? "#16a34a" : "#e11d48" },
                  { label: "MONTH LOT P&L",val: fmtLotPnl(monthStats.totalPnL * LOT_QTY),                   color: pnlColor(monthStats.totalPnL) },
                ].map(({ label, val, color }) => (
                  <div key={label} className="px-3 py-2.5" style={{ background: isDark ? "#0a0f16" : "#fff" }}>
                    <div className="text-[7px] tracking-[1.5px] uppercase mb-1"
                      style={{ ...MONO, color: isDark ? "#4a6080" : "#64748b" }}>{label}</div>
                    <div className="text-[14px] font-bold leading-tight" style={{ ...MONO, color }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {monthStats.days === 0 && (
            <div className="mt-6 text-center text-[10px]"
              style={{ ...MONO, color: isDark ? "#4a6080" : "#94a3b8" }}>
              No {tab} data for {MONTH_NAMES[calMonth.month - 1]} {calMonth.year}
            </div>
          )}
        </div>
      )}

      {/* ══ TABLE VIEW ══ */}
      {viewMode === "table" && (
        <>
          {/* ── States ── */}
          {loading && (
            <div className="flex-1 flex items-center justify-center text-[10px]"
              style={{ ...MONO, color: isDark ? "#4a6080" : "#94a3b8" }}>Loading...</div>
          )}
          {!loading && err && (
            <div className="flex-1 flex items-center justify-center text-[10px]"
              style={{ ...MONO, color: "#e11d48" }}>{err}</div>
          )}
          {!loading && !err && rows.length === 0 && selDate && (
            <div className="flex-1 flex items-center justify-center text-[10px]"
              style={{ ...MONO, color: isDark ? "#4a6080" : "#94a3b8" }}>No data for {selDate}</div>
          )}
          {!loading && !err && !selDate && (
            <div className="flex-1 flex items-center justify-center text-[10px] text-center px-6"
              style={{ ...MONO, color: isDark ? "#4a6080" : "#94a3b8" }}>
              No CSV files found. Run a backtest or wait for live alerts to be saved.
            </div>
          )}

          {/* ── Results ── */}
          {!loading && rows.length > 0 && (
            <>
              {/* ══ MOBILE CARDS ══ */}
              <div className="md:hidden flex-1 overflow-auto px-3 py-3 space-y-3">
                {rows.map((r, i) => {
                  const pnl    = parseFloat(r.PnL) || 0;
                  const lPnl   = pnl * LOT_QTY;
                  const pnlPct = parseFloat(r.PnLPct) || 0;
                  const isWin  = r.Status === "TARGET" || r.Status === "TIME_PROFIT";
                  const isLoss = r.Status === "SL" || r.Status === "TIME_EXIT";
                  const dc     = dirColor(r.Direction);
                  const sc     = STATUS_COLOR[r.Status] ?? "#94a3b8";
                  const stIco  = r.Status === "TARGET" ? "🎯" : r.Status === "SL" ? "🛑" : r.Status === "EOD" ? "🕐" : r.Status === "ACTIVE" ? "⏳" : "⏹";
                  const stLbl  = r.Status === "TIME_PROFIT" ? "T-PROFIT" : r.Status === "TIME_EXIT" ? "T-EXIT" : r.Status;
                  const t1Hit  = r.T1Hit === "Y";
                  const t2Hit  = r.Status === "TARGET";
                  return (
                    <div key={i} className="rounded-xl overflow-hidden"
                      style={{
                        background: isDark ? "#0d1420" : "#fff",
                        border: `1px solid ${isWin ? "#22c55e33" : isLoss ? "#ef444433" : isDark ? "#1e2a3a" : "#e2e8f0"}`,
                        borderLeft: `3px solid ${isWin ? "#22c55e" : isLoss ? "#e11d48" : dc}`,
                      }}>
                      <div className="px-3 py-3 flex items-start justify-between gap-2"
                        style={{ background: isWin ? (isDark ? "rgba(34,197,94,0.04)" : "rgba(34,197,94,0.03)") : isLoss ? (isDark ? "rgba(239,68,68,0.04)" : "rgba(239,68,68,0.03)") : undefined }}>
                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                          <div className="w-10 h-10 rounded-xl flex flex-col items-center justify-center flex-shrink-0"
                            style={{ background: `${dc}18`, border: `1.5px solid ${dc}40` }}>
                            <span className="text-[7px] font-bold" style={{ ...MONO, color: isDark ? "#64748b" : "#94a3b8" }}>NI</span>
                            <span className="text-[12px] font-bold" style={{ ...BEBAS, color: dc }}>{r.Direction}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[15px] font-bold leading-tight" style={{ ...BEBAS, color: isDark ? "#e2e8f0" : "#1e293b" }}>
                              NIFTY {r.Strike} {r.Direction === "CE" ? "Call" : "Put"}
                            </div>
                            <div className="text-[8px] mt-0.5" style={{ ...MONO, color: isDark ? "#64748b" : "#94a3b8" }}>
                              {fmtTime(r.EntryTime)}{r.ExitTime ? ` → ${fmtTime(r.ExitTime)}` : " → ACTIVE"}
                            </div>
                            {r.Concepts && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {r.Concepts.split(",").map((c: string) => (
                                  <span key={c} className="text-[7px] px-1 py-0.5 rounded-sm font-bold"
                                    style={{ ...MONO, background: isDark ? "#1e2a3a" : "#f1f5f9", color: isDark ? "#64748b" : "#94a3b8" }}>
                                    {c.trim()}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                          <span className="text-[8px] font-bold px-2 py-0.5 rounded-full"
                            style={{ ...MONO, background: `${sc}18`, color: sc, border: `1px solid ${sc}40` }}>
                            {stIco} {stLbl}
                          </span>
                          <div className="flex gap-1">
                            <span className="text-[7px] px-1.5 py-0.5 rounded-sm font-bold"
                              style={{ ...MONO, background: t1Hit ? (isDark ? "#052e16" : "#dcfce7") : (isDark ? "#0f1923" : "#f1f5f9"), color: t1Hit ? "#15803d" : (isDark ? "#4a6080" : "#94a3b8") }}>
                              T1{t1Hit ? "✓" : "✗"}
                            </span>
                            <span className="text-[7px] px-1.5 py-0.5 rounded-sm font-bold"
                              style={{ ...MONO, background: t2Hit ? (isDark ? "#052e16" : "#dcfce7") : (isDark ? "#0f1923" : "#f1f5f9"), color: t2Hit ? "#15803d" : (isDark ? "#4a6080" : "#94a3b8") }}>
                              T2{t2Hit ? "✓" : "✗"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="px-3 py-1.5 flex items-center gap-3 border-t"
                        style={{ background: isDark ? "#0d1420" : "#f8fafc", borderColor: isDark ? "#1e2a3a" : "#e2e8f0" }}>
                        <span className="text-[9px] font-bold" style={{ ...MONO, color: "#b45309" }}>T1 ₹{r.Target1 ?? "—"}{t1Hit ? " ✓" : ""}</span>
                        <span className="text-[9px] font-bold" style={{ ...MONO, color: "#16a34a" }}>T2 ₹{r.Target2 ?? "—"}{t2Hit ? " ✓" : ""}</span>
                        {r.MaxPoints && <span className="text-[9px] font-bold" style={{ ...MONO, color: "#7c3aed" }}>MAX +{r.MaxPoints}</span>}
                      </div>
                      <div className="grid grid-cols-3 border-t" style={{ gap: "1px", background: isDark ? "#1e2a3a" : "#e2e8f0" }}>
                        <div className="px-3 py-2" style={{ background: isDark ? "#0a0f16" : "#f8fafc" }}>
                          <div className="text-[7px] tracking-[1px] mb-0.5" style={{ ...MONO, color: isDark ? "#64748b" : "#94a3b8" }}>ENTRY</div>
                          <div className="text-[12px] font-bold tabular-nums" style={{ ...MONO, color: dc }}>₹{r.Entry}</div>
                        </div>
                        <div className="px-3 py-2" style={{ background: isDark ? "#0a0f16" : "#f8fafc" }}>
                          <div className="text-[7px] tracking-[1px] mb-0.5" style={{ ...MONO, color: isDark ? "#64748b" : "#94a3b8" }}>STOP LOSS</div>
                          <div className="text-[12px] font-bold tabular-nums" style={{ ...MONO, color: "#e11d48" }}>₹{r.SL}</div>
                        </div>
                        <div className="px-3 py-2" style={{ background: isDark ? "#0a0f16" : "#f8fafc" }}>
                          <div className="text-[7px] tracking-[1px] mb-0.5" style={{ ...MONO, color: isDark ? "#64748b" : "#94a3b8" }}>LOT P&L</div>
                          <div className="text-[13px] font-bold tabular-nums" style={{ ...MONO, color: pnlColor(lPnl) }}>{fmtLotPnl(lPnl)}</div>
                          <div className="text-[8px]" style={{ ...MONO, color: pnlColor(pnlPct) }}>{pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="rounded-xl overflow-hidden"
                  style={{ background: isDark ? "#0d1420" : "#f8fafc", border: `1px solid ${isDark ? "#1e2a3a" : "#e2e8f0"}` }}>
                  <div className="grid grid-cols-3" style={{ gap: "1px", background: isDark ? "#1e2a3a" : "#e2e8f0" }}>
                    {[
                      { label: "TRADES",   val: `${rows.length}`,              color: isDark ? "#475569" : "#64748b" },
                      { label: "WIN RATE", val: winRate ? `${winRate}%` : "—", color: winRate && +winRate >= 70 ? "#16a34a" : "#e11d48" },
                      { label: "LOT P&L",  val: fmtLotPnl(lotPnL),            color: pnlColor(lotPnL) },
                    ].map(({ label, val, color }) => (
                      <div key={label} className="px-3 py-2.5 text-center" style={{ background: isDark ? "#0a0f16" : "#fff" }}>
                        <div className="text-[7px] tracking-[1.5px] mb-1" style={{ ...MONO, color: isDark ? "#64748b" : "#94a3b8" }}>{label}</div>
                        <div className="text-[15px] font-bold" style={{ ...MONO, color }}>{val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ══ DESKTOP TABLE ══ */}
              <div className="hidden md:flex md:flex-col flex-1 overflow-hidden">
                <div className="flex-1 overflow-auto">
                  <div style={{ minWidth: "900px" }}>
                    <div className="grid flex-shrink-0 border-b-2"
                      style={{ gridTemplateColumns: COLS_DESKTOP, borderColor: isDark ? "#1e2a3a" : "#cbd5e1", background: isDark ? "#080d14" : "#f8fafc" }}>
                      {["#","TIME","CONCEPTS","STRIKE","ENTRY","SL","T1","T2","STATUS",`P&L · LOT (${NUM_LOTS}×${LOT_SIZE}=${LOT_QTY})`,"MAX PTS"].map(h => (
                        <div key={h} className="px-2 py-2 text-[8px] font-bold tracking-[1.5px] uppercase"
                          style={{ ...MONO, color: isDark ? "#4a6080" : "#64748b" }}>{h}</div>
                      ))}
                    </div>
                    <div>
                      {rows.map((r, i) => {
                        const pnl        = parseFloat(r.PnL) || 0;
                        const lPnL       = pnl * LOT_QTY;
                        const pnlPct     = parseFloat(r.PnLPct) || 0;
                        const isTimedWin = r.Status === "TIME_PROFIT";
                        const isTimedExit= r.Status === "TIME_EXIT";
                        const isWin      = r.Status === "TARGET" || isTimedWin;
                        const isLoss     = r.Status === "SL" || isTimedExit;
                        const isEod      = r.Status === "EOD";
                        const dc         = dirColor(r.Direction);
                        const stColor    = isWin ? "#16a34a" : isLoss ? "#e11d48" : isEod ? "#b45309" : "#0284c7";
                        const pnlClr     = isWin ? "#16a34a" : isLoss ? "#e11d48" : pnl >= 0 ? "#16a34a" : "#e11d48";
                        const stIcon     = r.Status === "TARGET" ? "🎯" : r.Status === "SL" ? "🛑" : isEod ? "🕐" : isTimedWin ? "⏱" : isTimedExit ? "⏱" : "⏳";
                        const stLabel    = isTimedWin ? "60M PROFIT" : isTimedExit ? "75M EXIT" : r.Status;
                        const t1Hit      = r.T1Hit === "Y";
                        const t2Hit      = r.Status === "TARGET";
                        const rowBg      = isWin ? (isDark ? "#052e16" : "#f0fdf4") : isLoss ? (isDark ? "#2d0505" : "#fff5f5") : isEod ? (isDark ? "#1c1500" : "#fefce8") : i % 2 === 0 ? (isDark ? "#0a0f16" : "#fff") : (isDark ? "#0d1420" : "#fafafa");
                        return (
                          <div key={i} className="grid border-b transition-colors items-center"
                            style={{ gridTemplateColumns: COLS_DESKTOP, background: rowBg, borderColor: isDark ? "#0f1923" : "#f1f5f9" }}>
                            <div className="px-2 py-2.5 text-[9px]" style={{ ...MONO, color: isDark ? "#4a6080" : "#94a3b8" }}>{i + 1}</div>
                            <div className="px-2 py-2.5">
                              <div className="text-[10px] font-bold" style={{ ...MONO, color: isDark ? "#e2e8f0" : "#1e293b" }}>{fmtTime(r.EntryTime)}</div>
                              <div className="text-[8px]" style={{ ...MONO, color: isDark ? "#4a6080" : "#94a3b8" }}>→{fmtTime(r.ExitTime)}</div>
                            </div>
                            <div className="px-2 py-2.5 flex flex-wrap gap-1">
                              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm"
                                style={{ ...MONO, background: `${dc}18`, color: dc, border: `1px solid ${dc}30` }}>{r.Direction}</span>
                              {r.Concepts && r.Concepts.split(",").map((c: string) => (
                                <span key={c} className="text-[7px] px-1 py-0.5 rounded-sm font-bold"
                                  style={{ ...MONO, background: isDark ? "#1e2a3a" : "#64748b14", color: "#64748b" }}>{c.trim()}</span>
                              ))}
                            </div>
                            <div className="px-2 py-2.5">
                              <div className="text-[11px] font-bold" style={{ ...MONO, color: dc }}>{r.Strike} {r.Direction}</div>
                            </div>
                            <div className="px-2 py-2.5 text-[12px] font-bold tabular-nums" style={{ ...MONO, color: dc }}>₹{r.Entry}</div>
                            <div className="px-2 py-2.5 text-[11px] font-bold tabular-nums text-[#e11d48]" style={MONO}>₹{r.SL}</div>
                            <div className="px-2 py-2.5 text-[11px] font-bold tabular-nums text-[#b45309]" style={MONO}>₹{r.Target1}</div>
                            <div className="px-2 py-2.5 text-[11px] font-bold tabular-nums text-[#16a34a]" style={MONO}>₹{r.Target2}</div>
                            <div className="px-2 py-2.5">
                              <div className="flex items-center gap-1 mb-0.5">
                                <span className="text-[9px]">{stIcon}</span>
                                <span className="text-[8px] font-bold" style={{ ...MONO, color: stColor }}>{stLabel}</span>
                              </div>
                              <div className="flex gap-1 mb-0.5">
                                <span className="text-[7px] px-1 py-0.5 rounded-sm font-bold"
                                  style={{ ...MONO, background: t1Hit ? (isDark ? "#052e16" : "#dcfce7") : (isDark ? "#0f1923" : "#f1f5f9"), color: t1Hit ? "#15803d" : (isDark ? "#4a6080" : "#94a3b8") }}>
                                  T1{t1Hit ? "✓" : "✗"}
                                </span>
                                <span className="text-[7px] px-1 py-0.5 rounded-sm font-bold"
                                  style={{ ...MONO, background: t2Hit ? (isDark ? "#052e16" : "#dcfce7") : (isDark ? "#0f1923" : "#f1f5f9"), color: t2Hit ? "#15803d" : (isDark ? "#4a6080" : "#94a3b8") }}>
                                  T2{t2Hit ? "✓" : "✗"}
                                </span>
                              </div>
                              <div className="text-[8px] font-bold" style={{ ...MONO, color: stColor }}>{fmtLotPnl(lPnL)}</div>
                            </div>
                            <div className="px-2 py-2.5">
                              <div className="flex items-baseline gap-1">
                                <span className="text-[11px] font-bold tabular-nums" style={{ ...MONO, color: pnlClr }}>{pnl >= 0 ? "+" : ""}₹{pnl.toFixed(2)}</span>
                                <span className="text-[7px]" style={{ ...MONO, color: isDark ? "#4a6080" : "#94a3b8" }}>unit</span>
                              </div>
                              <div className="flex items-baseline gap-1 mt-0.5">
                                <span className="text-[12px] font-bold tabular-nums" style={{ ...MONO, color: pnlClr }}>{fmtLotPnl(lPnL)}</span>
                                <span className="text-[7px] font-bold" style={{ ...MONO, color: pnlClr }}>×{LOT_QTY}</span>
                              </div>
                              <div className="text-[8px]" style={{ ...MONO, color: pnlClr }}>{pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%</div>
                            </div>
                            <div className="px-2 py-2.5">
                              {r.MaxPoints && parseFloat(r.MaxPoints) > 0
                                ? <div className="text-[11px] font-bold tabular-nums text-[#7c3aed]" style={MONO}>+{r.MaxPoints}</div>
                                : <div className="text-[9px]" style={{ ...MONO, color: isDark ? "#4a6080" : "#94a3b8" }}>—</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex-shrink-0 border-t"
                  style={{ borderColor: isDark ? "#1e2a3a" : "#cbd5e1", background: isDark ? "#080b0f" : "#fff" }}>
                  <div className="grid grid-cols-4 sm:grid-cols-7"
                    style={{ gap: "1px", background: isDark ? "#1e2a3a" : "#cbd5e1" }}>
                    {[
                      { label: "TOTAL TRADES", val: `${rows.length}`,              color: isDark ? "#94a3b8" : "#475569" },
                      { label: "TARGET HIT",   val: `${wins}`,                     color: "#16a34a" },
                      { label: "SL HIT",       val: `${losses}`,                   color: "#e11d48" },
                      { label: "EOD / OPEN",   val: `${eod}`,                      color: "#b45309" },
                      { label: "WIN RATE",     val: winRate ? `${winRate}%` : "—", color: winRate && Number(winRate) >= 70 ? "#16a34a" : "#e11d48" },
                      { label: "PREMIUM P&L",  val: `${totalPnL >= 0 ? "+" : ""}${totalPnL.toFixed(2)} ₹`, color: pnlColor(totalPnL) },
                      { label: `LOT P&L (${LOT_QTY}×)`, val: fmtLotPnl(lotPnL), color: pnlColor(lotPnL) },
                    ].map(({ label, val, color }) => (
                      <div key={label} className="px-3 py-2.5" style={{ background: isDark ? "#0a0f16" : "#fff" }}>
                        <div className="text-[7px] tracking-[1.5px] uppercase mb-1" style={{ ...MONO, color: isDark ? "#4a6080" : "#64748b" }}>{label}</div>
                        <div className="text-[15px] font-bold leading-tight" style={{ ...MONO, color }}>{val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

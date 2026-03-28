"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/lib/theme";

const MONO  = { fontFamily: "'Space Mono', monospace" } as const;
const BEBAS = { fontFamily: "'Bebas Neue', sans-serif" } as const;

type Row = Record<string, string>;

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

const LOT_QTY = 65;
const COLS_DESKTOP = "40px 120px 1fr 90px 70px 70px 72px 72px 90px 130px 65px";

export function ResultsContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [tab, setTab]         = useState<"backtest" | "live">("backtest");
  const [dates, setDates]     = useState<{ backtest: string[]; live: string[] }>({ backtest: [], live: [] });
  const [selDate, setSelDate] = useState("");
  const [rows, setRows]       = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState("");

  useEffect(() => {
    fetch("/api/results")
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
    fetch(`/api/results?type=${tab}&date=${selDate}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setErr(d.error); setRows([]); }
        else setRows(d.rows ?? []);
      })
      .catch(() => setErr("Failed to load data"))
      .finally(() => setLoading(false));
  }, [selDate, tab]);

  const wins     = rows.filter(r => r.Status === "TARGET" || r.Status === "TIME_PROFIT").length;
  const losses   = rows.filter(r => r.Status === "SL" || r.Status === "TIME_EXIT").length;
  const eod      = rows.filter(r => r.Status === "EOD").length;
  const closed   = wins + losses;
  const winRate  = closed > 0 ? ((wins / closed) * 100).toFixed(1) : null;
  const totalPnL = rows.reduce((s, r) => s + (parseFloat(r.PnL) || 0), 0);
  const lotPnL   = totalPnL * LOT_QTY;

  return (
    <div className="h-full flex flex-col overflow-hidden"
      style={{ background: isDark ? "#080b0f" : "#fff", color: isDark ? "#e2e8f0" : "#1e293b" }}>

      {/* ── Tabs + Date ── */}
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

        {winRate !== null && (
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

        {rows.length > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[7px] tracking-[1px]"
              style={{ ...MONO, color: isDark ? "#4a6080" : "#94a3b8" }}>LOT P&L</span>
            <span className="text-[13px] font-bold" style={{ ...BEBAS, color: pnlColor(lotPnL) }}>
              {lotPnL >= 0 ? "+" : ""}₹{Math.abs(lotPnL).toFixed(0)}
            </span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
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
        </div>
      </div>

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
                  {["#","TIME","CONCEPTS","STRIKE","ENTRY","SL","T1","T2","STATUS","P&L · LOT (65)","MAX PTS"].map(h => (
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
                            <span className="text-[7px] font-bold" style={{ ...MONO, color: pnlClr }}>×65</span>
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
                  { label: "LOT P&L (65×)", val: fmtLotPnl(lotPnL),           color: pnlColor(lotPnL) },
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
    </div>
  );
}

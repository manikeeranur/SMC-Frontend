"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/lib/theme";

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
  return s === "TARGET" ? "TARGET ✅"
    : s === "TIME_PROFIT" ? "T-PROFIT"
    : s === "SL"          ? "SL ❌"
    : s === "TIME_EXIT"   ? "T-EXIT"
    : s === "EOD"         ? "EOD"
    : s;
}

function dirColor(d: string) {
  return d === "CE" ? "#22c55e" : "#ef4444";
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

export default function ResultsPage() {
  const router = useRouter();
  const [tab, setTab]           = useState<"backtest" | "live">("backtest");
  const [dates, setDates]       = useState<{ backtest: string[]; live: string[] }>({ backtest: [], live: [] });
  const [selDate, setSelDate]   = useState("");
  const [rows, setRows]         = useState<Row[]>([]);
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState("");

  // Load available dates on mount
  useEffect(() => {
    fetch("/api/results")
      .then(r => r.json())
      .then(d => {
        setDates(d);
        const first = d[tab === "backtest" ? "backtest" : "live"]?.[0];
        if (first) setSelDate(first);
      })
      .catch(() => setErr("Failed to load dates"));
  }, []);

  // When tab changes, reset to first date of new tab
  useEffect(() => {
    const first = dates[tab]?.[0] ?? "";
    setSelDate(first);
    setRows([]);
  }, [tab]);

  // Load CSV when date/tab changes
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

  // ── Stats ─────────────────────────────────────────────────────────────────
  const wins      = rows.filter(r => r.Status === "TARGET" || r.Status === "TIME_PROFIT").length;
  const losses    = rows.filter(r => r.Status === "SL" || r.Status === "TIME_EXIT").length;
  const eod       = rows.filter(r => r.Status === "EOD").length;
  const closed    = wins + losses;
  const winRate   = closed > 0 ? ((wins / closed) * 100).toFixed(1) : null;
  const totalPnL  = rows.reduce((s, r) => s + (parseFloat(r.PnL) || 0), 0);
  const lotPnL    = totalPnL * 65;

  return (
    <div className="min-h-screen bg-[#080b0f] text-[#e2e8f0]" style={MONO}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[#1e2a3a]">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push("/options")}
            className="text-[10px] text-[#64748b] hover:text-[#94a3b8] cursor-pointer" style={MONO}>
            ← BACK
          </button>
          <span className="text-[16px] text-[#e2e8f0] tracking-[3px]" style={BEBAS}>
            RESULTS VIEWER
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[9px] text-[#4a6080]" style={MONO}>
            SMC ALGO · RESULTS
          </span>
          <ThemeToggle />
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-[#1e2a3a]">
        {(["backtest", "live"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-[10px] tracking-[1px] uppercase rounded-sm border cursor-pointer transition-colors ${tab === t ? "bg-[#ea580c22] border-[#ea580c] text-[#ea580c]" : "bg-transparent border-[#2a3a4a] text-[#64748b] hover:border-[#4a6080]"}`}
            style={MONO}>
            {t === "backtest" ? "Backtest Results" : "Live Alerts"}
          </button>
        ))}

        {/* Date picker */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[9px] text-[#4a6080]">DATE:</span>
          <select
            value={selDate}
            onChange={e => setSelDate(e.target.value)}
            className="bg-[#0f1923] border border-[#2a3a4a] text-[#e2e8f0] text-[10px] px-2 py-1 rounded-sm cursor-pointer"
            style={MONO}>
            {(dates[tab] ?? []).map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
            {!(dates[tab]?.length) && <option value="">— no files —</option>}
          </select>
        </div>
      </div>

      {/* ── Summary Bar ── */}
      {rows.length > 0 && (
        <div className="flex items-center gap-6 px-6 py-3 border-b border-[#1e2a3a] bg-[#0a1118]">
          <Stat label="TRADES" value={String(rows.length)} />
          <div className="w-px h-6 bg-[#1e2a3a]" />
          <Stat label="WIN" value={String(wins)} color="#22c55e" />
          <Stat label="LOSS" value={String(losses)} color="#ef4444" />
          {eod > 0 && <Stat label="EOD" value={String(eod)} color="#94a3b8" />}
          <div className="w-px h-6 bg-[#1e2a3a]" />
          <Stat label="WIN RATE" value={winRate ? `${winRate}%` : "—"} color={winRate && +winRate >= 50 ? "#22c55e" : "#ef4444"} />
          <div className="w-px h-6 bg-[#1e2a3a]" />
          <div className="flex flex-col">
            <span className="text-[8px] text-[#4a6080] tracking-[1px]">PREMIUM P&L</span>
            <span className="text-[13px] font-bold" style={{ color: pnlColor(totalPnL) }}>
              {totalPnL >= 0 ? "+" : ""}{totalPnL.toFixed(2)} RS
            </span>
          </div>
          <div className="w-px h-6 bg-[#1e2a3a]" />
          <div className="flex flex-col">
            <span className="text-[8px] text-[#4a6080] tracking-[1px]">LOT P&L (×65)</span>
            <span className="text-[15px] font-bold" style={{ ...BEBAS, color: pnlColor(lotPnL) }}>
              {lotPnL >= 0 ? "+" : ""}₹{Math.abs(lotPnL).toFixed(0)}
            </span>
          </div>
        </div>
      )}

      {/* ── Table ── */}
      <div className="px-6 py-4 overflow-x-auto">
        {loading && (
          <div className="text-[10px] text-[#4a6080] py-10 text-center" style={MONO}>Loading...</div>
        )}
        {err && (
          <div className="text-[10px] text-[#e11d48] py-10 text-center" style={MONO}>{err}</div>
        )}
        {!loading && !err && rows.length === 0 && selDate && (
          <div className="text-[10px] text-[#4a6080] py-10 text-center" style={MONO}>No data for {selDate}</div>
        )}
        {!loading && !err && !selDate && (
          <div className="text-[10px] text-[#4a6080] py-10 text-center" style={MONO}>
            No CSV files found. Run a backtest or wait for live alerts to be saved.
          </div>
        )}

        {!loading && rows.length > 0 && (
          <table className="w-full border-collapse text-[10px]" style={MONO}>
            <thead>
              <tr className="border-b border-[#1e2a3a] text-[#4a6080] text-[8px] tracking-[1px] uppercase">
                <th className="py-2 px-2 text-left w-6">#</th>
                <th className="py-2 px-2 text-left">Entry</th>
                <th className="py-2 px-2 text-left">Exit</th>
                <th className="py-2 px-2 text-center">Dir</th>
                <th className="py-2 px-2 text-right">Strike</th>
                <th className="py-2 px-2 text-right">Entry ₹</th>
                <th className="py-2 px-2 text-right">SL ₹</th>
                <th className="py-2 px-2 text-right">T1 ₹</th>
                <th className="py-2 px-2 text-right">T2 ₹</th>
                <th className="py-2 px-2 text-center">Status</th>
                <th className="py-2 px-2 text-center">T1</th>
                <th className="py-2 px-2 text-right">PnL ₹</th>
                <th className="py-2 px-2 text-right">Lot P&L</th>
                <th className="py-2 px-2 text-right">PnL%</th>
                <th className="py-2 px-2 text-left">Concepts</th>
                <th className="py-2 px-2 text-right">Max Pts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const pnl    = parseFloat(r.PnL) || 0;
                const lPnL   = pnl * 65;
                const pnlPct = parseFloat(r.PnLPct) || 0;
                const isWin  = r.Status === "TARGET" || r.Status === "TIME_PROFIT";
                const isLoss = r.Status === "SL";
                return (
                  <tr key={i}
                    className="border-b border-[#0f1923] hover:bg-[#0f1923] transition-colors"
                    style={{ background: isWin ? "#052e1622" : isLoss ? "#2d050522" : undefined }}>
                    <td className="py-2 px-2 text-[#4a6080]">{i + 1}</td>
                    <td className="py-2 px-2 text-[#94a3b8]">{fmtTime(r.EntryTime)}</td>
                    <td className="py-2 px-2 text-[#94a3b8]">{fmtTime(r.ExitTime)}</td>
                    <td className="py-2 px-2 text-center">
                      <span className="px-1.5 py-0.5 rounded-sm text-[8px] font-bold"
                        style={{ background: `${dirColor(r.Direction)}22`, color: dirColor(r.Direction), border: `1px solid ${dirColor(r.Direction)}44` }}>
                        {r.Direction}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right text-[#e2e8f0] font-bold">{r.Strike}</td>
                    <td className="py-2 px-2 text-right text-[#e2e8f0]">{r.Entry}</td>
                    <td className="py-2 px-2 text-right text-[#ef4444]">{r.SL}</td>
                    <td className="py-2 px-2 text-right text-[#60a5fa]">{r.Target1}</td>
                    <td className="py-2 px-2 text-right text-[#22c55e]">{r.Target2}</td>
                    <td className="py-2 px-2 text-center">
                      <span className="text-[8px] font-bold" style={{ color: STATUS_COLOR[r.Status] ?? "#94a3b8" }}>
                        {statusLabel(r.Status)}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center text-[11px]">
                      {r.T1Hit === "Y" ? <span style={{ color: "#22c55e" }}>✅ {r.T1HitTime}</span> : <span style={{ color: "#ef444466" }}>—</span>}
                    </td>
                    <td className="py-2 px-2 text-right font-bold" style={{ color: pnlColor(pnl) }}>
                      {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                    </td>
                    <td className="py-2 px-2 text-right font-bold" style={{ color: pnlColor(lPnL) }}>
                      {lPnL >= 0 ? "+" : ""}₹{Math.abs(lPnL).toFixed(0)}
                    </td>
                    <td className="py-2 px-2 text-right" style={{ color: pnlColor(pnlPct) }}>
                      {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                    </td>
                    <td className="py-2 px-2 text-[8px] text-[#64748b]">{r.Concepts}</td>
                    <td className="py-2 px-2 text-right text-[#94a3b8]">{r.MaxPoints || "—"}</td>
                  </tr>
                );
              })}
            </tbody>

            {/* Totals row */}
            <tfoot>
              <tr className="border-t-2 border-[#2a3a4a] bg-[#0a1118]">
                <td colSpan={11} className="py-2.5 px-2 text-[8px] text-[#4a6080] tracking-[1px] uppercase">
                  Total · {rows.length} trades · Win Rate {winRate ?? "—"}%
                </td>
                <td className="py-2.5 px-2 text-right font-bold text-[12px]" style={{ color: pnlColor(totalPnL) }}>
                  {totalPnL >= 0 ? "+" : ""}{totalPnL.toFixed(2)}
                </td>
                <td className="py-2.5 px-2 text-right font-bold text-[14px]" style={{ ...BEBAS, color: pnlColor(lotPnL) }}>
                  {lotPnL >= 0 ? "+" : ""}₹{Math.abs(lotPnL).toFixed(0)}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[8px] text-[#4a6080] tracking-[1px]">{label}</span>
      <span className="text-[13px] font-bold" style={{ ...MONO, color: color ?? "#e2e8f0" }}>{value}</span>
    </div>
  );
}

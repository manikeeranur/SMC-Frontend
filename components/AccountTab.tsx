"use client";

import { useState, useEffect, useCallback } from "react";
import { accountApi } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { IconRefresh, IconWallet, IconReceipt, IconChartBar } from "@tabler/icons-react";

const MONO = { fontFamily: "'Space Mono', monospace" } as const;

type AccountData = Awaited<ReturnType<typeof accountApi.get>>;
type Position    = AccountData["positions"][number];

function fmt(n: number, d = 2) {
  return n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
}

// ─── Summary card wrapper ─────────────────────────────────────────────────────
function SCard({ title, icon, accent, children }: {
  title: string; icon: React.ReactNode; accent: string; children: React.ReactNode;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  return (
    <div className="rounded-xl border flex flex-col gap-3 p-4"
      style={{ background: isDark ? "#0f172a" : "#fff", borderColor: isDark ? "#1e293b" : "#e2e8f0" }}>
      <div className="flex items-center gap-1.5">
        <span style={{ color: accent }}>{icon}</span>
        <span className="text-[9px] font-bold tracking-[1.5px] uppercase"
          style={{ ...MONO, color: isDark ? "#64748b" : "#94a3b8" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

// ─── Position card ────────────────────────────────────────────────────────────
function PositionCard({ p }: { p: Position }) {
  const { theme } = useTheme();
  const isDark  = theme === "dark";
  const border  = isDark ? "#1e293b" : "#e2e8f0";
  const subtext = isDark ? "#64748b" : "#94a3b8";
  const muted   = isDark ? "#94a3b8" : "#64748b";
  const text    = isDark ? "#e2e8f0" : "#1e293b";

  const isOpen   = p.status === "OPEN";
  const isCE     = p.direction === "CE";
  const pnlVal   = p.pnl;
  const pnlColor = pnlVal > 0 ? "#16a34a" : pnlVal < 0 ? "#e11d48" : muted;

  // Direction colors — CE = green, PE = red
  const dirColor  = isCE ? "#16a34a" : "#e11d48";
  const dirBg     = isCE ? "#16a34a" : "#e11d48";

  // Status label
  const statusLabel = p.atStatus ?? p.status;
  const statusColor = isOpen ? "#ea580c" : (pnlVal >= 0 ? "#16a34a" : "#e11d48");
  const statusBg    = isOpen ? "#ea580c18" : (pnlVal >= 0 ? "#16a34a18" : "#e11d4818");

  return (
    <div className="rounded-xl border overflow-hidden flex flex-col"
      style={{ borderColor: border, background: isDark ? "#0f172a" : "#fff" }}>

      {/* ── Header: CE/PE square + symbol + qty + P&L ── */}
      <div className="flex items-stretch">

        {/* Left accent strip — colored CE/PE square */}
        <div className="flex flex-col items-center justify-center px-3 gap-1 flex-shrink-0"
          style={{ background: dirBg, minWidth: 44 }}>
          <span className="text-[11px] font-bold text-white leading-none" style={MONO}>
            {p.direction}
          </span>
          {p.strike && (
            <span className="text-[8px] text-white/70 leading-none" style={MONO}>
              {p.strike}
            </span>
          )}
        </div>

        {/* Symbol + status + qty */}
        <div className="flex-1 px-3 py-2.5 flex flex-col justify-center gap-1 min-w-0">
          <span className="text-[11px] font-bold truncate leading-tight" style={{ ...MONO, color: text }}>
            {p.tradingsymbol}
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold"
              style={{ background: statusBg, color: statusColor, ...MONO }}>
              {statusLabel}
            </span>
            {/* Qty highlight */}
            <span className="px-2 py-0.5 rounded text-[9px] font-bold"
              style={{ background: isDark ? "#1e293b" : "#f1f5f9", color: muted, ...MONO }}>
              QTY&nbsp;{p.quantity}
            </span>
          </div>
        </div>

        {/* P&L */}
        <div className="flex flex-col items-end justify-center px-3 py-2.5 flex-shrink-0">
          <span className="text-[17px] font-bold leading-tight" style={{ ...MONO, color: pnlColor }}>
            {pnlVal >= 0 ? "+" : ""}₹{fmt(pnlVal)}
          </span>
          <span className="text-[9px]" style={{ ...MONO, color: subtext }}>P&amp;L</span>
        </div>
      </div>

      {/* ── Times ── */}
      <div className="grid grid-cols-2 border-t" style={{ borderColor: border }}>
        <div className="px-3 py-2 border-r" style={{ borderColor: border }}>
          <div className="text-[8px] uppercase tracking-[1px] mb-0.5" style={{ ...MONO, color: subtext }}>
            Entry Time
          </div>
          <div className="text-[10px] font-bold uppercase" style={{ ...MONO, color: p.entryTime ? muted : subtext }}>
            {p.entryTime ?? "—"}
          </div>
        </div>
        <div className="px-3 py-2">
          <div className="text-[8px] uppercase tracking-[1px] mb-0.5" style={{ ...MONO, color: subtext }}>
            Exit Time
          </div>
          <div className="text-[10px] font-bold uppercase"
            style={{ ...MONO, color: p.exitTime ? muted : (isOpen ? "#ea580c" : subtext) }}>
            {p.exitTime ?? (isOpen ? "Open" : "—")}
          </div>
        </div>
      </div>

      {/* ── Prices ── */}
      <div className="grid grid-cols-3 border-t" style={{ borderColor: border }}>
        {[
          { label: "Entry Price", val: p.buyPrice  > 0 ? `₹${fmt(p.buyPrice)}`  : "—", color: muted },
          { label: "Exit Price",  val: p.sellPrice > 0 ? `₹${fmt(p.sellPrice)}` : "—", color: muted },
          { label: "CMP",         val: p.currentPrice > 0 ? `₹${fmt(p.currentPrice)}` : "—", color: text },
        ].map(({ label, val, color }, i) => (
          <div key={label} className={`px-3 py-2.5 ${i < 2 ? "border-r" : ""}`}
            style={{ borderColor: border }}>
            <div className="text-[8px] uppercase tracking-[1px] mb-0.5" style={{ ...MONO, color: subtext }}>
              {label}
            </div>
            <div className="text-[10px] font-bold" style={{ ...MONO, color }}>{val}</div>
          </div>
        ))}
      </div>

    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────
export function AccountTab() {
  const { theme } = useTheme();
  const isDark  = theme === "dark";
  const border  = isDark ? "#1e293b" : "#e2e8f0";
  const subtext = isDark ? "#64748b" : "#94a3b8";
  const muted   = isDark ? "#94a3b8" : "#64748b";
  const text    = isDark ? "#e2e8f0" : "#1e293b";

  const [data,    setData]    = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try   { setData(await accountApi.get()); }
    catch (e: any) { setError(e.message || "Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="h-full overflow-y-auto px-3 py-3">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-[11px] font-bold tracking-[2px] uppercase" style={{ ...MONO, color: text }}>
          Account Overview
        </span>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-[1px] uppercase disabled:opacity-50"
          style={{ ...MONO, background: isDark ? "#1e293b" : "#f1f5f9", color: muted }}>
          <IconRefresh size={12} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-[11px]"
          style={{ background: "#e11d4815", border: "1px solid #e11d4840", ...MONO, color: "#e11d48" }}>
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center h-40 gap-2">
          <div className="w-5 h-5 border-2 border-[#ea580c]/30 border-t-[#ea580c] rounded-full animate-spin" />
          <span className="text-[10px]" style={{ ...MONO, color: subtext }}>Loading…</span>
        </div>
      )}

      {data && (
        <>
          {/* ── 3 summary cards ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">

            <SCard title="Wallet" icon={<IconWallet size={14} />} accent="#16a34a">
              <span className="text-[22px] font-bold" style={{ ...MONO, color: "#16a34a" }}>
                ₹{fmt(data.wallet.available)}
              </span>
              <div className="flex flex-col gap-1 text-[10px]" style={MONO}>
                <div className="flex justify-between">
                  <span style={{ color: subtext }}>Available</span>
                  <span style={{ color: "#16a34a" }}>₹{fmt(data.wallet.available)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: subtext }}>Used margin</span>
                  <span style={{ color: "#f59e0b" }}>₹{fmt(data.wallet.used)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: subtext }}>Net</span>
                  <span style={{ color: muted }}>₹{fmt(data.wallet.net)}</span>
                </div>
              </div>
            </SCard>

            <SCard title="Charges Today" icon={<IconReceipt size={14} />} accent="#f59e0b">
              <span className="text-[22px] font-bold" style={{ ...MONO, color: "#f59e0b" }}>
                ₹{fmt(data.charges.total)}
              </span>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]" style={MONO}>
                {([
                  ["Brokerage", data.charges.brokerage],
                  ["STT",       data.charges.stt],
                  ["Txn (NSE)", data.charges.txn],
                  ["Clearing",  data.charges.clearing],
                  ["GST",       data.charges.gst],
                  ["SEBI",      data.charges.sebi],
                  ["Stamp",     data.charges.stampDuty],
                ] as [string, number][]).map(([l, v]) => (
                  <div key={l} className="flex justify-between gap-1">
                    <span style={{ color: subtext }}>{l}</span>
                    <span style={{ color: muted }}>₹{fmt(v)}</span>
                  </div>
                ))}
              </div>
            </SCard>

            <SCard title="Overall P&L" icon={<IconChartBar size={14} />} accent="#ea580c">
              <span className="text-[22px] font-bold"
                style={{ ...MONO, color: data.pnl.total >= 0 ? "#16a34a" : "#e11d48" }}>
                {data.pnl.total >= 0 ? "+" : ""}₹{fmt(data.pnl.total)}
              </span>
              <div className="flex flex-col gap-1 text-[10px]" style={MONO}>
                <div className="flex justify-between">
                  <span style={{ color: subtext }}>Realised</span>
                  <span style={{ color: data.pnl.realised >= 0 ? "#16a34a" : "#e11d48" }}>
                    {data.pnl.realised >= 0 ? "+" : ""}₹{fmt(data.pnl.realised)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: subtext }}>Unrealised</span>
                  <span style={{ color: data.pnl.unrealised >= 0 ? "#16a34a" : "#e11d48" }}>
                    {data.pnl.unrealised >= 0 ? "+" : ""}₹{fmt(data.pnl.unrealised)}
                  </span>
                </div>
                <div className="flex justify-between pt-1 font-bold border-t" style={{ borderColor: border }}>
                  <span style={{ color: subtext }}>Net (after charges)</span>
                  {(() => {
                    const net = +(data.pnl.total - data.charges.total).toFixed(2);
                    return (
                      <span style={{ color: net >= 0 ? "#16a34a" : "#e11d48" }}>
                        {net >= 0 ? "+" : ""}₹{fmt(net)}
                      </span>
                    );
                  })()}
                </div>
              </div>
            </SCard>
          </div>

          {/* ── Positions header ── */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold tracking-[1.5px] uppercase" style={{ ...MONO, color: subtext }}>
              Today's Positions
            </span>
            <span className="text-[10px]" style={{ ...MONO, color: subtext }}>
              {data.positions.length} position{data.positions.length !== 1 ? "s" : ""}
            </span>
          </div>

          {data.positions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 gap-2 rounded-xl border"
              style={{ borderColor: border, background: isDark ? "#0f172a" : "#fff" }}>
              <span className="text-3xl" style={{ color: isDark ? "#1e293b" : "#e2e8f0" }}>◈</span>
              <span className="text-[11px]" style={{ ...MONO, color: subtext }}>No positions today</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pb-4">
              {data.positions.map((p, i) => <PositionCard key={i} p={p} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

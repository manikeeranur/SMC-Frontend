"use client";

import { useState, useEffect, useCallback } from "react";
import { accountApi } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { IconRefresh, IconWallet, IconReceipt, IconChartBar, IconList, IconDownload, IconClock,
         IconArrowUpRight, IconArrowDownLeft, IconPercentage, IconMinus } from "@tabler/icons-react";

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
  const isDark  = theme === "dark";
  const bg      = isDark ? "#0f172a" : "#fff";
  const border  = isDark ? "#1e293b" : "#e2e8f0";
  const subtext = isDark ? "#64748b" : "#94a3b8";
  return (
    <div className="rounded-2xl border flex flex-col overflow-hidden"
      style={{ background: bg, borderColor: border, borderTop: `2px solid ${accent}` }}>
      {/* Card header */}
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${accent}22` }}>
          <span style={{ color: accent }}>{icon}</span>
        </div>
        <span className="text-[10px] font-bold tracking-[1.8px] uppercase"
          style={{ ...MONO, color: subtext }}>{title}</span>
      </div>
      {/* Card body */}
      <div className="flex flex-col gap-0">
        {children}
      </div>
    </div>
  );
}

// ─── Format duration from seconds ────────────────────────────────────────────
function fmtDuration(secs: number | null): string {
  if (secs === null || secs < 0) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── Parse Kite symbol → human-readable ──────────────────────────────────────
function formatSymbol(sym: string): string {
  const type = sym.slice(-2); // CE or PE
  if (type !== "CE" && type !== "PE") return sym;
  const base = sym.slice(0, -2);
  const monthMap: Record<string, string> = {
    "1":"JAN","2":"FEB","3":"MAR","4":"APR","5":"MAY","6":"JUN",
    "7":"JUL","8":"AUG","9":"SEP","A":"OCT","B":"NOV","C":"DEC",
  };
  // Weekly: NIFTY2641323850 → index=NIFTY yy=26 month=4 dd=13 strike=23850
  const weekly = base.match(/^([A-Z]+)(\d{2})([1-9ABC])(\d{2})(\d+)$/);
  if (weekly) {
    const [, index, , m, dd, strike] = weekly;
    const mon = monthMap[m] ?? m;
    return `${index} ${parseInt(dd)} ${mon} ${strike} ${type}`;
  }
  // Monthly: NIFTY26APR23850 → index=NIFTY yy=26 mon=APR strike=23850
  const monthly = base.match(/^([A-Z]+)(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d+)$/);
  if (monthly) {
    const [, index, yy, mon, strike] = monthly;
    return `${index} ${mon} 20${yy} ${strike} ${type}`;
  }
  return sym;
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

  // Status label
  const statusLabel = p.atStatus ?? p.status;
  const statusColor = isOpen ? "#ea580c" : (pnlVal >= 0 ? "#16a34a" : "#e11d48");
  const statusBg    = isOpen ? "#ea580c18" : (pnlVal >= 0 ? "#16a34a18" : "#e11d4818");

  return (
    <div className="rounded-xl border overflow-hidden flex flex-col"
      style={{
        borderColor: border,
        background: isDark ? "#0f172a" : "#fff",
        borderLeft: `3px solid ${isCE ? "#16a34a" : "#e11d48"}`,
      }}>

      {/* ── Header: symbol + qty + P&L ── */}
      <div className="flex items-stretch">

        {/* Symbol + status + qty */}
        <div className="flex-1 px-3 py-2.5 flex flex-col justify-center gap-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[11px] font-bold truncate leading-tight" style={{ ...MONO, color: text }}>
              {formatSymbol(p.tradingsymbol)}
            </span>
          </div>
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

      {/* ── Duration ── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-t" style={{ borderColor: border }}>
        <IconClock className="size-4" style={{ color: isOpen ? "#ea580c" : subtext, flexShrink: 0 }} />
        <span className="text-[8px] uppercase tracking-[1px]" style={{ ...MONO, color: subtext }}>
          Duration
        </span>
        <span className="ml-auto text-[10px] font-bold"
          style={{ ...MONO, color: isOpen ? "#ea580c" : muted }}>
          {fmtDuration(p.durationSecs)}{isOpen ? " ↑" : ""}
        </span>
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

// ─── CSV from current data (today, no DB needed) ─────────────────────────────
function downloadTodayCSV(data: AccountData, type: "trades" | "summary") {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const cell  = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const row   = (cols: any[]) => cols.map(cell).join(",");

  let csv = "";

  if (type === "summary") {
    const closed  = data.positions.filter(p => p.status === "CLOSED");
    const winners = closed.filter(p => p.pnl > 0).length;
    const losers  = closed.filter(p => p.pnl < 0).length;
    const winRate = closed.length ? (winners / closed.length * 100).toFixed(1) : "0.0";
    const gross   = data.pnl.total;
    const chrgs   = data.charges.total;
    csv  = row(["Date","Trades","Winners","Losers","Win Rate (%)","Gross P&L (₹)","Charges (₹)","Net P&L (₹)"]) + "\n";
    csv += row([today, closed.length, winners, losers, winRate,
                gross.toFixed(2), chrgs.toFixed(2), (gross - chrgs).toFixed(2)]) + "\n";
    csv += row(["OVERALL TOTAL", closed.length, winners, losers, winRate,
                gross.toFixed(2), chrgs.toFixed(2), (gross - chrgs).toFixed(2)]) + "\n";
  } else {
    csv = row(["Date","Symbol","Direction","Strike","Qty","Entry Time","Exit Time",
               "Entry Price (₹)","Exit Price (₹)","Gross P&L (₹)","Status"]) + "\n";
    for (const p of data.positions) {
      csv += row([today, p.tradingsymbol, p.direction, p.strike ?? "",
                  p.quantity, p.entryTime ?? "", p.exitTime ?? "",
                  p.buyPrice, p.sellPrice || "", p.pnl, p.status]) + "\n";
    }
    const totalPnl     = data.positions.reduce((s, p) => s + p.pnl, 0);
    const totalCharges = data.charges.total;
    csv += row(["OVERALL GROSS P&L", "", "", "", "", "", "", "", "", totalPnl.toFixed(2),              ""]) + "\n";
    csv += row(["OVERALL CHARGES",   "", "", "", "", "", "", "", "", `-${totalCharges.toFixed(2)}`,     ""]) + "\n";
    csv += row(["NET P&L (FINAL)",   "", "", "", "", "", "", "", "", (totalPnl - totalCharges).toFixed(2), ""]) + "\n";
  }

  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `pnl_${type}_${today}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ─── Report downloader panel ──────────────────────────────────────────────────
function ReportDownloader({ todayData }: { todayData: AccountData }) {
  const { theme } = useTheme();
  const isDark  = theme === "dark";
  const subtext = isDark ? "#64748b" : "#94a3b8";
  const muted   = isDark ? "#94a3b8" : "#64748b";
  const text    = isDark ? "#e2e8f0" : "#1e293b";

  const [reportType, setReportType] = useState<"trades" | "summary">("trades");
  const [preset,     setPreset]     = useState<"today" | "month" | "lastmonth" | "custom">("today");
  const [from,       setFrom]       = useState("");
  const [to,         setTo]         = useState("");
  const [busy,       setBusy]       = useState(false);
  const [err,        setErr]        = useState("");

  async function handleDownload() {
    setErr(""); setBusy(true);
    try {
      if (preset === "today") {
        downloadTodayCSV(todayData, reportType);
      } else {
        let f = from, t = to;
        if (preset !== "custom") {
          const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
          if (preset === "month") {
            f = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
            t = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
          } else {
            const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const last  = new Date(now.getFullYear(), now.getMonth(), 0);
            f = first.toLocaleDateString("en-CA");
            t = last.toLocaleDateString("en-CA");
          }
        }
        if (!f || !t) { setErr("Select a date range"); setBusy(false); return; }
        await accountApi.report(f, t, reportType);
      }
    } catch (e: any) {
      const msg = e.message || "Download failed";
      setErr(msg.includes("No data") ? "No trading data saved yet for this period. Data is captured daily from 3:31 PM IST." : msg);
    } finally {
      setBusy(false);
    }
  }

  const pill = (label: string, active: boolean, onClick: () => void) => (
    <button onClick={onClick}
      className="px-3 py-1 rounded-lg text-[10px] font-bold tracking-[0.5px]"
      style={{ ...MONO, background: active ? "#ea580c" : (isDark ? "#1e293b" : "#f1f5f9"),
               color: active ? "#fff" : muted }}>
      {label}
    </button>
  );

  return (
    <div className="rounded-xl border p-4 mb-4 flex flex-col gap-3"
      style={{ background: isDark ? "#0f172a" : "#fff", borderColor: isDark ? "#1e293b" : "#e2e8f0" }}>

      {/* Header */}
      <div className="flex items-center gap-1.5">
        <IconDownload size={13} style={{ color: "#ea580c" }} />
        <span className="text-[9px] font-bold tracking-[1.5px] uppercase" style={{ ...MONO, color: subtext }}>
          Download P&amp;L Report
        </span>
      </div>

      {/* Report type */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[9px] uppercase tracking-[1px]" style={{ ...MONO, color: subtext }}>Type</span>
        <div className="flex gap-2">
          {pill("Trades",        reportType === "trades",  () => setReportType("trades"))}
          {pill("Daily Summary", reportType === "summary", () => setReportType("summary"))}
        </div>
      </div>

      {/* Period */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[9px] uppercase tracking-[1px]" style={{ ...MONO, color: subtext }}>Period</span>
        <div className="flex flex-wrap gap-2">
          {pill("Today",       preset === "today",     () => setPreset("today"))}
          {pill("This Month",  preset === "month",     () => setPreset("month"))}
          {pill("Last Month",  preset === "lastmonth", () => setPreset("lastmonth"))}
          {pill("Custom",      preset === "custom",    () => setPreset("custom"))}
        </div>
      </div>

      {/* Custom date range */}
      {preset === "custom" && (
        <div className="flex gap-3 flex-wrap">
          {(["From", "To"] as const).map((label, i) => (
            <div key={label} className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-[1px]" style={{ ...MONO, color: subtext }}>{label}</span>
              <input type="date" value={i === 0 ? from : to}
                onChange={e => i === 0 ? setFrom(e.target.value) : setTo(e.target.value)}
                className="px-2 py-1 rounded-lg text-[11px] border outline-none"
                style={{ ...MONO, background: isDark ? "#1e293b" : "#f8fafc",
                         borderColor: isDark ? "#334155" : "#e2e8f0", color: text }} />
            </div>
          ))}
        </div>
      )}

      {err && <span className="text-[10px]" style={{ ...MONO, color: "#e11d48" }}>{err}</span>}

      {/* Download button */}
      <button onClick={handleDownload} disabled={busy}
        className="flex items-center justify-center gap-2 py-2 rounded-lg text-[11px] font-bold tracking-[1px] uppercase disabled:opacity-50 w-full"
        style={{ ...MONO, background: "#ea580c", color: "#fff" }}>
        <IconDownload size={13} />
        {busy ? "Downloading…" : "Download CSV"}
      </button>
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

            {/* ── Wallet ── */}
            <SCard title="Wallet" icon={<IconWallet size={16} />} accent="#16a34a">
              {/* Big number */}
              <div className="px-4 pb-3">
                <div className="text-[28px] font-black leading-none" style={{ ...MONO, color: "#16a34a" }}>
                  ₹{fmt(data.wallet.available)}
                </div>
                <div className="text-[10px] mt-0.5" style={{ ...MONO, color: subtext }}>Available Balance</div>
              </div>
              {/* Details */}
              <div className="border-t" style={{ borderColor: isDark ? "#1e293b" : "#e2e8f0" }}>
                {([
                  { label: "Used Margin",      val: `₹${fmt(data.wallet.used)}`,  color: "#f59e0b" },
                  { label: "Net Balance",       val: `₹${fmt(data.wallet.net)}`,   color: muted     },
                ] as { label: string; val: string; color: string }[]).map(({ label, val, color }) => (
                  <div key={label} className="flex items-center justify-between px-4 py-2 border-b"
                    style={{ borderColor: isDark ? "#1e293b" : "#f1f5f9" }}>
                    <span className="text-[10px]" style={{ ...MONO, color: subtext }}>{label}</span>
                    <span className="text-[11px] font-bold" style={{ ...MONO, color }}>{val}</span>
                  </div>
                ))}
                {/* Deposit / Withdrawal */}
                <div className="flex border-b" style={{ borderColor: isDark ? "#1e293b" : "#f1f5f9" }}>
                  <div className="flex-1 flex items-center gap-1.5 px-4 py-2 border-r"
                    style={{ borderColor: isDark ? "#1e293b" : "#f1f5f9" }}>
                    <IconArrowDownLeft size={11} color="#16a34a" />
                    <span className="text-[9px]" style={{ ...MONO, color: subtext }}>Deposit</span>
                    <span className="ml-auto text-[11px] font-bold"
                      style={{ ...MONO, color: data.wallet.deposit > 0 ? "#16a34a" : muted }}>
                      ₹{fmt(data.wallet.deposit)}
                    </span>
                  </div>
                  <div className="flex-1 flex items-center gap-1.5 px-4 py-2">
                    <IconArrowUpRight size={11} color="#e11d48" />
                    <span className="text-[9px]" style={{ ...MONO, color: subtext }}>Withdrawal</span>
                    <span className="ml-auto text-[11px] font-bold"
                      style={{ ...MONO, color: data.wallet.withdrawal > 0 ? "#e11d48" : muted }}>
                      ₹{fmt(data.wallet.withdrawal)}
                    </span>
                  </div>
                </div>
                {/* Margin bar */}
                {(() => {
                  const total    = data.wallet.used + data.wallet.available;
                  const pct      = total > 0 ? Math.min(100, +(data.wallet.used / total * 100).toFixed(1)) : 0;
                  const barColor = pct > 80 ? "#e11d48" : pct > 50 ? "#f59e0b" : "#16a34a";
                  return (
                    <div className="px-4 py-3 flex flex-col gap-1.5">
                      <div className="flex justify-between text-[9px]" style={MONO}>
                        <span style={{ color: subtext }}>Margin Utilisation</span>
                        <span style={{ color: barColor, fontWeight: 700 }}>{pct}%</span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden"
                        style={{ background: isDark ? "#1e293b" : "#f1f5f9" }}>
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: barColor }} />
                      </div>
                    </div>
                  );
                })()}
              </div>
            </SCard>

            {/* ── Charges Today ── */}
            <SCard title="Charges Today" icon={<IconReceipt size={16} />} accent="#f59e0b">
              <div className="px-4 pb-3">
                <div className="text-[28px] font-black leading-none" style={{ ...MONO, color: "#f59e0b" }}>
                  ₹{fmt(data.charges.total)}
                </div>
                <div className="text-[10px] mt-0.5" style={{ ...MONO, color: subtext }}>Total Charges</div>
              </div>
              <div className="border-t grid grid-cols-2" style={{ borderColor: isDark ? "#1e293b" : "#e2e8f0" }}>
                {/* Col 1 — 4 items */}
                <div className="border-r flex flex-col" style={{ borderColor: isDark ? "#1e293b" : "#e2e8f0" }}>
                  {([
                    ["Brokerage",         data.charges.brokerage],
                    ["STT",               data.charges.stt],
                    ["Exchange Turnover", data.charges.exchange],
                    ["SEBI Turnover",     data.charges.sebi],
                  ] as [string, number][]).map(([l, v], i) => (
                    <div key={l}
                      className={`flex items-center justify-between px-3 py-2 ${i < 3 ? "border-b" : ""}`}
                      style={{ borderColor: isDark ? "#1e293b" : "#f1f5f9" }}>
                      <span className="text-[9px]" style={{ ...MONO, color: subtext }}>{l}</span>
                      <span className="text-[10px] font-bold" style={{ ...MONO, color: muted }}>₹{fmt(v)}</span>
                    </div>
                  ))}
                </div>
                {/* Col 2 — 2 items */}
                <div className="flex flex-col">
                  {([
                    ["GST",        data.charges.gst],
                    ["Stamp Duty", data.charges.stampDuty],
                  ] as [string, number][]).map(([l, v], i) => (
                    <div key={l}
                      className={`flex items-center justify-between px-3 py-2 ${i === 0 ? "border-b" : ""}`}
                      style={{ borderColor: isDark ? "#1e293b" : "#f1f5f9" }}>
                      <span className="text-[9px]" style={{ ...MONO, color: subtext }}>{l}</span>
                      <span className="text-[10px] font-bold" style={{ ...MONO, color: muted }}>₹{fmt(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </SCard>

            {/* ── Overall P&L ── */}
            <SCard title="Overall P&L" icon={<IconChartBar size={16} />} accent="#ea580c">
              {(() => {
                const net = +(data.pnl.unrealised - data.charges.total).toFixed(2);
                return (
                  <>
                    <div className="px-4 pb-3">
                      <div className="text-[28px] font-black leading-none"
                        style={{ ...MONO, color: data.pnl.total >= 0 ? "#16a34a" : "#e11d48" }}>
                        {data.pnl.total >= 0 ? "+" : ""}₹{fmt(data.pnl.total)}
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ ...MONO, color: subtext }}>Gross P&amp;L (Today)</div>
                    </div>
                    <div className="border-t" style={{ borderColor: isDark ? "#1e293b" : "#e2e8f0" }}>
                      {([
                        { label: "Realised",   val: data.pnl.realised,   sign: true },
                        { label: "Unrealised", val: data.pnl.unrealised, sign: true },
                        { label: "Charges",    val: -data.charges.total, sign: false, display: `-₹${fmt(data.charges.total)}` },
                      ] as { label: string; val: number; sign: boolean; display?: string }[]).map(({ label, val, sign, display }) => (
                        <div key={label}
                          className="flex items-center justify-between px-4 py-2 border-b"
                          style={{ borderColor: isDark ? "#1e293b" : "#f1f5f9" }}>
                          <span className="text-[10px]" style={{ ...MONO, color: subtext }}>{label}</span>
                          <span className="text-[11px] font-bold"
                            style={{ ...MONO, color: val >= 0 ? (sign ? "#16a34a" : "#e11d48") : "#e11d48" }}>
                            {display ?? `${val >= 0 && sign ? "+" : ""}₹${fmt(Math.abs(val))}`}
                          </span>
                        </div>
                      ))}
                      {/* Net row — highlighted */}
                      <div className="flex items-center justify-between px-4 py-3"
                        style={{ background: net >= 0 ? "#16a34a12" : "#e11d4812" }}>
                        <div className="flex items-center gap-1.5">
                          <IconPercentage size={11} style={{ color: net >= 0 ? "#16a34a" : "#e11d48" }} />
                          <span className="text-[10px] font-bold" style={{ ...MONO, color: net >= 0 ? "#16a34a" : "#e11d48" }}>
                            Net (after charges)
                          </span>
                        </div>
                        <span className="text-[13px] font-black" style={{ ...MONO, color: net >= 0 ? "#16a34a" : "#e11d48" }}>
                          {net >= 0 ? "+" : ""}₹{fmt(net)}
                        </span>
                      </div>
                    </div>
                  </>
                );
              })()}
            </SCard>
          </div>

          {/* ── Win rate stats ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              { label: "Total Trades",  val: data.stats.totalTrades, color: muted,      suffix: "" },
              { label: "Win Rate",      val: data.stats.winRate,      color: data.stats.winRate >= 50 ? "#16a34a" : "#e11d48", suffix: "%" },
              { label: "Winners",       val: data.stats.winners,      color: "#16a34a",  suffix: "" },
              { label: "Losers",        val: data.stats.losers,       color: "#e11d48",  suffix: "" },
            ].map(({ label, val, color, suffix }) => (
              <div key={label} className="rounded-xl border p-3 flex flex-col gap-1"
                style={{ background: isDark ? "#0f172a" : "#fff", borderColor: isDark ? "#1e293b" : "#e2e8f0" }}>
                <span className="text-[8px] font-bold tracking-[1.5px] uppercase" style={{ ...MONO, color: subtext }}>{label}</span>
                <span className="text-[20px] font-black leading-tight" style={{ ...MONO, color }}>
                  {val}{suffix}
                </span>
              </div>
            ))}
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
            <div className="flex flex-col items-center justify-center py-10 gap-2 rounded-xl border"
              style={{ borderColor: border, background: isDark ? "#0f172a" : "#fff" }}>
              <span className="text-3xl" style={{ color: isDark ? "#1e293b" : "#e2e8f0" }}>◈</span>
              <span className="text-[11px]" style={{ ...MONO, color: subtext }}>No positions today</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-5">
              {data.positions.map((p, i) => <PositionCard key={i} p={p} />)}
            </div>
          )}

          {/* ── Report downloader ── */}
          <ReportDownloader todayData={data} />

          {/* ── Order Book ── */}
          <div className="flex items-center gap-1.5 mb-3">
            <IconList size={12} style={{ color: subtext }} />
            <span className="text-[10px] font-bold tracking-[1.5px] uppercase" style={{ ...MONO, color: subtext }}>
              Order Book
            </span>
            <span className="text-[10px] ml-auto" style={{ ...MONO, color: subtext }}>
              {data.orderBook.length} order{data.orderBook.length !== 1 ? "s" : ""}
            </span>
          </div>

          {data.orderBook.length === 0 ? (
            <div className="flex items-center justify-center py-8 rounded-xl border"
              style={{ borderColor: border, background: isDark ? "#0f172a" : "#fff" }}>
              <span className="text-[11px]" style={{ ...MONO, color: subtext }}>No orders today</span>
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden mb-4"
              style={{ borderColor: border, background: isDark ? "#0f172a" : "#fff" }}>
              {data.orderBook.map((o, i) => {
                const isBuy    = o.transaction_type === "BUY";
                const isComplete = o.status === "COMPLETE";
                const isReject = o.status === "REJECTED" || o.status === "CANCELLED";
                const statusColor = isComplete ? "#16a34a" : isReject ? "#e11d48" : "#f59e0b";
                return (
                  <div key={o.order_id}
                    className={`flex items-center gap-3 px-3 py-2.5 ${i > 0 ? "border-t" : ""}`}
                    style={{ borderColor: border }}>
                    {/* B/S pill */}
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded flex-shrink-0"
                      style={{
                        ...MONO,
                        background: isBuy ? "#16a34a18" : "#e11d4818",
                        color: isBuy ? "#16a34a" : "#e11d48",
                      }}>
                      {o.transaction_type}
                    </span>
                    {/* Symbol */}
                    <span className="flex-1 text-[10px] font-bold truncate" style={{ ...MONO, color: text }}>
                      {formatSymbol(o.tradingsymbol)}
                    </span>
                    {/* Qty + price */}
                    <span className="text-[10px] flex-shrink-0" style={{ ...MONO, color: muted }}>
                      {o.quantity} × {o.price > 0 ? `₹${fmt(o.price)}` : (o.trigger_price > 0 ? `SL ₹${fmt(o.trigger_price)}` : "MKT")}
                    </span>
                    {/* Status */}
                    <span className="text-[9px] font-bold flex-shrink-0" style={{ ...MONO, color: statusColor }}>
                      {o.status}
                    </span>
                    {/* Time */}
                    <span className="text-[9px] flex-shrink-0" style={{ ...MONO, color: subtext }}>
                      {o.time ?? "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

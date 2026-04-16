"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { accountApi } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { IconRefresh, IconWallet, IconReceipt, IconChartBar, IconList, IconDownload, IconClock,
         IconArrowUpRight, IconArrowDownLeft, IconPercentage, IconX, IconPower, IconXboxX } from "@tabler/icons-react";

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

// ─── Bottom Sheet Modal ───────────────────────────────────────────
function CardModal({ title, icon, accent, onClose, children }: {
  title: string; icon: React.ReactNode; accent: string; onClose: () => void; children: React.ReactNode;
}) {
  const { theme } = useTheme();
  const isDark  = theme === "dark";
  const bg      = isDark ? "#0f172a" : "#fff";
  const border  = isDark ? "#1e293b" : "#e2e8f0";
  const subtext = isDark ? "#64748b" : "#94a3b8";

  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => setIsOpen(true));
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleClose = () => {
    setIsOpen(false);
    setTimeout(onClose, 300);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 transition-opacity duration-300"
        style={{ background: "rgba(0,0,0,0.45)", opacity: isOpen ? 1 : 0 }}
        onClick={handleClose}
      />
      <div
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-out rounded-t-[20px]"
        style={{
          background: bg,
          borderTop: `1px solid ${border}`,
          transform: isOpen ? "translateY(0)" : "translateY(100%)",
          maxHeight: "85vh",
        }}
      >
        <div className="w-full flex justify-center pt-3 pb-2 flex-shrink-0">
          <div className="w-10 h-1.5 rounded-full" style={{ background: isDark ? "#1e293b" : "#e2e8f0" }} />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0"
          style={{ borderColor: border }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: `${accent}15` }}>
              <span style={{ color: accent }}>{icon}</span>
            </div>
            <span className="text-[11px] font-bold tracking-[2px] uppercase"
              style={{ ...MONO, color: isDark ? "#e2e8f0" : "#1e293b" }}>{title}</span>
          </div>
          <button onClick={handleClose}
            className="p-1.5 rounded-full active:scale-95 transition-transform flex-shrink-0"
            style={{ background: isDark ? "#1e293b" : "#f1f5f9" }}>
            <IconXboxX size={16} style={{ color: subtext }} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto pb-4 overscroll-contain">
          {children}
        </div>
      </div>
    </>
  );
}

// ─── Compact mobile summary card ─────────────────────────────────────────────
function MobileCompactCard({ title, icon, accent, onClick, children }: {
  title: string; icon: React.ReactNode; accent: string; onClick: () => void; children: React.ReactNode;
}) {
  const { theme } = useTheme();
  const isDark  = theme === "dark";
  const bg      = isDark ? "#0f172a" : "#fff";
  const border  = isDark ? "#1e293b" : "#e2e8f0";
  const subtext = isDark ? "#64748b" : "#94a3b8";
  return (
    <button onClick={onClick}
      className="rounded-xl border flex flex-col overflow-hidden w-full text-left active:scale-95 transition-transform"
      style={{ background: bg, borderColor: border, borderTop: `2px solid ${accent}` }}>
      <div className="flex items-center gap-1 px-2 pt-2.5 pb-1">
        <div className="w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${accent}22` }}>
          <span style={{ color: accent, display: "flex" }}>{icon}</span>
        </div>
        <span className="text-[7px] font-bold tracking-[1px] uppercase truncate"
          style={{ ...MONO, color: subtext }}>{title}</span>
      </div>
      <div className="px-2 pb-2.5">{children}</div>
    </button>
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

// ─── Parse Kite symbol → Zerodha-style human-readable ────────────────────────
// Output: "NIFTY 17 Apr ₹23800 Call" / "SENSEX 18 Apr ₹83000 Put"
function formatSymbol(sym: string): string {
  const type = sym.slice(-2); // CE or PE
  if (type !== "CE" && type !== "PE") return sym;
  const label = type === "CE" ? "Call" : "Put";
  const base  = sym.slice(0, -2);
  const MON_CODE: Record<string, string> = {
    "1":"Jan","2":"Feb","3":"Mar","4":"Apr","5":"May","6":"Jun",
    "7":"Jul","8":"Aug","9":"Sep","A":"Oct","B":"Nov","C":"Dec",
  };
  const MON_STR: Record<string, string> = {
    JAN:"Jan",FEB:"Feb",MAR:"Mar",APR:"Apr",MAY:"May",JUN:"Jun",
    JUL:"Jul",AUG:"Aug",SEP:"Sep",OCT:"Oct",NOV:"Nov",DEC:"Dec",
  };
  // Weekly: NIFTY2641723800CE → NIFTY 17 Apr ₹23800 Call
  const weekly = base.match(/^([A-Z]+)(\d{2})([1-9ABC])(\d{2})(\d+)$/);
  if (weekly) {
    const [, index, , m, dd, strike] = weekly;
    const mon = MON_CODE[m] ?? m;
    return `${index} ${parseInt(dd)} ${mon} ₹${strike} ${label}`;
  }
  // Monthly: NIFTY26APR23800CE → NIFTY Apr ₹23800 Call
  const monthly = base.match(/^([A-Z]+)(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d+)$/);
  if (monthly) {
    const [, index, , mon, strike] = monthly;
    return `${index} ${MON_STR[mon] ?? mon} ₹${strike} ${label}`;
  }
  return sym;
}

// ─── Index logo (NIFTY 50 / SENSEX) ─────────────────────────────────────────
function IndexLogo({ symbol, optType }: { symbol: string; optType: "CE" | "PE" }) {
  const isSensex  = symbol.startsWith("SENSEX");
  const typeColor = optType === "CE" ? "#16a34a" : "#e11d48";
  const src       = isSensex ? "/sensex-logo.avif" : "/nifty-logo.png";

  return (
    <div className="w-11 h-11 rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center"
      style={{ border: `2px solid ${typeColor}`, background: "#111" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={isSensex ? "SENSEX" : "NIFTY 50"}
        className="w-full h-full object-cover" />
    </div>
  );
}

// ─── Position card — exact Zerodha/Kite style ────────────────────────────────
function PositionCard({ p, onExit, isExiting }: {
  p: Position;
  onExit?: () => void;
  isExiting?: boolean;
}) {
  const { theme } = useTheme();
  const isDark  = theme === "dark";
  const border  = isDark ? "#1e293b" : "#e8edf2";
  const subtext = isDark ? "#94a3b8" : "#8a9bb0";
  const text    = isDark ? "#e2e8f0" : "#1a2332";
  const cardBg  = isDark ? "#0f172a" : "#ffffff";
  const gridBg  = isDark ? "#0b1322" : "#f5f7fa";

  const isOpen   = p.status === "OPEN";
  const optType  = (p.direction === "CE" ? "CE" : "PE") as "CE" | "PE";
  const pnlVal   = p.pnl;
  const pnlColor = pnlVal > 0 ? "#16a34a" : pnlVal < 0 ? "#e11d48" : subtext;

  const pricePct = p.buyPrice > 0 ? ((p.currentPrice - p.buyPrice) / p.buyPrice * 100) : 0;
  const pctUp    = pricePct >= 0;

  // Days to expiry
  function daysLeft(): number | null {
    try {
      const sym  = p.tradingsymbol;
      const type = sym.slice(-2);
      const base = sym.slice(0, -2);
      const MON: Record<string,number> = {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
      // monthly
      const mo = base.match(/^[A-Z]+(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d+)$/);
      if (mo) {
        const yr   = 2000 + parseInt(mo[1]);
        const mnth = MON[mo[2]];
        // last Thursday/Friday of month ~ day 28
        const exp  = new Date(yr, mnth, 28);
        return Math.max(0, Math.ceil((exp.getTime() - Date.now()) / 86400000));
      }
      // weekly
      const wk = base.match(/^[A-Z]+\d{2}[1-9ABC](\d{2})(\d+)$/);
      if (wk) {
        // approximate from symbol chars — just show duration instead
        return null;
      }
    } catch {}
    return null;
  }

  // SL/TP state
  const [showDetail, setShowDetail] = useState(false);
  const [showSLTP,   setShowSLTP]   = useState(false);
  const [slInput,    setSlInput]    = useState("");
  const [tpInput,    setTpInput]    = useState("");
  const [slSet,      setSlSet]      = useState<number | null>(null);
  const [tpSet,      setTpSet]      = useState<number | null>(null);

  function confirmSLTP() {
    const sl = parseFloat(slInput);
    const tp = parseFloat(tpInput);
    if (!isNaN(sl) && sl > 0) setSlSet(sl);
    if (!isNaN(tp) && tp > 0) setTpSet(tp);
    setShowSLTP(false);
  }

  const displayName  = formatSymbol(p.tradingsymbol);
  const days         = daysLeft();
  const triggeredRef = useRef(false);
  const onExitRef    = useRef(onExit);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);

  // ── Auto-exit when price hits SL or TP ──────────────────────────────────────
  useEffect(() => {
    if (!isOpen || triggeredRef.current) return;
    const cmp = p.currentPrice;
    if (cmp <= 0) return;

    const hitSL = slSet !== null && cmp <= slSet;
    const hitTP = tpSet !== null && cmp >= tpSet;

    if ((hitSL || hitTP) && onExitRef.current) {
      triggeredRef.current = true;
      onExitRef.current();
    }
  // onExit intentionally excluded — use ref to avoid re-running on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.currentPrice, slSet, tpSet, isOpen]);

  // Reset trigger flag when SL/TP values are changed
  useEffect(() => { triggeredRef.current = false; }, [slSet, tpSet]);

  // 2 × 3 detail grid rows
  const gridRows = [
    [
      { label: "CMP",         value: p.currentPrice > 0 ? `₹${fmt(p.currentPrice)}` : "—" },
      { label: "Entry Price", value: p.buyPrice > 0     ? `₹${fmt(p.buyPrice)}`     : "—" },
      { label: "Exit Price",  value: p.sellPrice > 0    ? `₹${fmt(p.sellPrice)}`    : "—" },
    ],
    [
      { label: "Entry Time", value: p.entryTime ?? "—"           },
      { label: "Exit Time",  value: p.exitTime  ?? "—"           },
      { label: "Duration",   value: fmtDuration(p.durationSecs)  },
    ],
  ];

  return (
    <div className="rounded-2xl overflow-hidden flex flex-col"
      style={{ background: cardBg, border: `1px solid ${border}`,
               boxShadow: isDark ? "none" : "0 2px 10px rgba(0,0,0,0.06)" }}>

      {/* ── Header ── */}
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <IndexLogo symbol={p.tradingsymbol} optType={optType} />
        <div className="flex-1 min-w-0">
          {/* Name row */}
          <div className="flex items-start justify-between gap-2">
            <span className="text-[14px] font-bold leading-snug flex-1 min-w-0" style={{ color: text }}>
              {displayName}
            </span>
            {/* QTY — top right */}
            <span className="flex items-center gap-1 text-[11px] font-semibold flex-shrink-0 mt-0.5"
              style={{ color: isDark ? "#64748b" : "#6b7a90" }}>
              <span style={{ fontSize: 13 }}>🧳</span>
              {p.quantity} QTY
            </span>
          </div>
          {/* Price + % */}
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[12px]" style={{ color: subtext }}>Price:</span>
            <span className="text-[13px] font-bold" style={{ color: text }}>
              ₹{fmt(p.currentPrice || p.buyPrice)}
            </span>
            {p.buyPrice > 0 && (
              <span className="text-[12px] font-bold flex items-center gap-0.5"
                style={{ color: pctUp ? "#16a34a" : "#e11d48" }}>
                {pctUp ? "▲" : "▼"} {Math.abs(pricePct).toFixed(2)}%
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Divider ── */}
      <div style={{ height: 1, background: border, marginBottom: 2 }} />

      {/* ── Stats row: Avg Price | Days to expiry | Gain/Loss ── */}
      <div className="grid grid-cols-3 px-4 py-3 gap-2">
        <div>
          <div className="text-[11px] mb-0.5" style={{ color: subtext }}>Avg. Price</div>
          <div className="text-[15px] font-bold" style={{ color: text }}>₹{fmt(p.buyPrice)}</div>
        </div>
        <div>
          <div className="text-[11px] mb-0.5" style={{ color: subtext }}>Days to expiry</div>
          <div className="text-[15px] font-bold" style={{ color: text }}>
            {days !== null ? days : (p.durationSecs !== null ? fmtDuration(p.durationSecs) : "—")}
          </div>
        </div>
        <div>
          <div className="text-[11px] mb-0.5" style={{ color: subtext }}>Gain/Loss</div>
          <div className="text-[15px] font-bold" style={{ color: pnlColor }}>
            {pnlVal >= 0 ? "+" : ""}₹{fmt(pnlVal)}
          </div>
        </div>
      </div>

      {/* ── More details chevron toggle ── */}
      <button
        onClick={() => setShowDetail(v => !v)}
        className="flex items-center justify-center gap-1 py-1.5 w-full text-[10px] font-semibold border-t transition-colors"
        style={{ borderColor: border, color: subtext,
                 background: isDark ? "#0a1220" : "#f8fafc" }}>
        {showDetail ? "Less details" : "More details"}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          style={{ transition: "transform 0.2s", transform: showDetail ? "rotate(180deg)" : "rotate(0deg)" }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* ── 2 × 3 detail grid (collapsible) ── */}
      {showDetail && (
        <div className="mx-3 mb-3 mt-1 rounded-xl overflow-hidden border" style={{ borderColor: border }}>
          {gridRows.map((row, ri) => (
            <div key={ri}
              className={`grid grid-cols-3 ${ri < gridRows.length - 1 ? "border-b" : ""}`}
              style={{ borderColor: border, background: ri % 2 === 0 ? gridBg : cardBg }}>
              {row.map((cell, ci) => (
                <div key={cell.label}
                  className={`flex flex-col px-3 py-2 ${ci < row.length - 1 ? "border-r" : ""}`}
                  style={{ borderColor: border }}>
                  <span className="text-[8px] font-bold uppercase tracking-[0.7px] mb-0.5"
                    style={{ ...MONO, color: subtext }}>{cell.label}</span>
                  <span className="text-[11px] font-bold leading-tight"
                    style={{ ...MONO, color: text }}>{cell.value}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── SL/TP chips ── */}
      {(slSet !== null || tpSet !== null) && (
        <div className="flex items-center gap-2 px-3 pb-3 flex-wrap">
          {/* monitoring badge */}
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold"
            style={{ background: "#f59e0b18", color: "#f59e0b" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: "#f59e0b" }} />
            MONITORING
          </span>
          {slSet !== null && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-bold"
              style={{ background: "#e11d4815", color: "#e11d48" }}>
              SL ₹{fmt(slSet)}
              <button onClick={() => { setSlSet(null); triggeredRef.current = false; }}
                className="ml-0.5 opacity-60 hover:opacity-100">×</button>
            </span>
          )}
          {tpSet !== null && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-bold"
              style={{ background: "#16a34a15", color: "#16a34a" }}>
              TP ₹{fmt(tpSet)}
              <button onClick={() => { setTpSet(null); triggeredRef.current = false; }}
                className="ml-0.5 opacity-60 hover:opacity-100">×</button>
            </span>
          )}
          <button onClick={() => setShowSLTP(true)} className="ml-auto text-[9px] font-bold underline"
            style={{ color: subtext }}>edit</button>
        </div>
      )}

      {/* ── SL/TP input panel ── */}
      {showSLTP && (
        <div className="mx-3 mb-3 rounded-xl p-3 flex flex-col gap-2"
          style={{ background: isDark ? "#1e293b" : "#f8fafc", border: `1px solid ${border}` }}>
          <div className="flex gap-2">
            <div className="flex-1">
              <div className="text-[8px] font-bold mb-1" style={{ color: subtext }}>Stop Loss ₹</div>
              <input type="number" value={slInput} onChange={e => setSlInput(e.target.value)}
                placeholder={p.buyPrice > 0 ? fmt(p.buyPrice * 0.88) : "0.00"}
                className="w-full rounded-lg px-2 py-1.5 text-[11px] font-bold outline-none"
                style={{ background: isDark ? "#0f172a" : "#fff", color: text,
                         border: `1px solid ${border}`, ...MONO }} />
            </div>
            <div className="flex-1">
              <div className="text-[8px] font-bold mb-1" style={{ color: subtext }}>Target ₹</div>
              <input type="number" value={tpInput} onChange={e => setTpInput(e.target.value)}
                placeholder={p.buyPrice > 0 ? fmt(p.buyPrice * 1.24) : "0.00"}
                className="w-full rounded-lg px-2 py-1.5 text-[11px] font-bold outline-none"
                style={{ background: isDark ? "#0f172a" : "#fff", color: text,
                         border: `1px solid ${border}`, ...MONO }} />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowSLTP(false)}
              className="flex-1 py-1.5 rounded-lg text-[10px] font-bold"
              style={{ background: isDark ? "#0f172a" : "#e2e8f0", color: subtext }}>Cancel</button>
            <button onClick={confirmSLTP}
              className="flex-1 py-1.5 rounded-lg text-[10px] font-bold text-white"
              style={{ background: "#16a34a" }}>Set</button>
          </div>
        </div>
      )}

      {/* ── Action buttons ── */}
      {isOpen && (
        <div className="grid grid-cols-2 border-t" style={{ borderColor: border }}>
          <button onClick={onExit} disabled={isExiting}
            className="flex items-center justify-center gap-2 py-3.5 text-[13px] font-semibold border-r disabled:opacity-50"
            style={{ color: "#1d6ff5", borderColor: border,
                     background: isDark ? "#0a1628" : "#ebf3ff" }}>
            {isExiting
              ? <span className="w-3.5 h-3.5 border-2 border-[#1d6ff5]/30 border-t-[#1d6ff5] rounded-full animate-spin" />
              : <IconArrowDownLeft size={15} />}
            {isExiting ? "Exiting…" : "Instant Exit"}
          </button>
          <button onClick={() => setShowSLTP(v => !v)}
            className="flex items-center justify-center gap-2 py-3.5 text-[13px] font-semibold"
            style={{ color: "#16a34a", background: isDark ? "#071a0e" : "#ecfdf5" }}>
            <IconPercentage size={15} />
            {slSet || tpSet ? "Edit SL/Target" : "Add SL/Target"}
          </button>
        </div>
      )}

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

  const [data,          setData]          = useState<AccountData | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState("");
  const [livePositions, setLivePositions] = useState<AccountData["positions"] | null>(null);
  const [exitingSet,    setExitingSet]    = useState<Set<string>>(new Set());
  const [exitAllBusy,   setExitAllBusy]   = useState(false);
  const [exitError,     setExitError]     = useState("");
  const [activeModal,   setActiveModal]   = useState<"wallet" | "charges" | "pnl" | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try   { setData(await accountApi.get()); }
    catch (e: any) { setError(e.message || "Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── 500ms wallet / charges / P&L polling ──────────────────────────────────
  useEffect(() => {
    let active  = true;
    let running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const d = await accountApi.get();
        if (active) setData(d);
      } catch {}
      finally { running = false; }
    };
    const id = setInterval(poll, 500);
    return () => { active = false; clearInterval(id); };
  }, []);

  // ── 500ms live positions polling ───────────────────────────────────────────
  useEffect(() => {
    let active  = true;
    let running = false;

    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const res = await accountApi.livePositions();
        if (active) setLivePositions(res.positions);
      } catch {}
      finally { running = false; }
    };

    poll();
    const id = setInterval(poll, 500);
    return () => { active = false; clearInterval(id); };
  }, []);

  const displayPositions = [...(livePositions ?? data?.positions ?? [])].reverse();

  // ── Exit a single position ─────────────────────────────────────────────────
  async function handleExit(tradingsymbol: string, quantity: number) {
    setExitError("");
    setExitingSet(prev => new Set([...prev, tradingsymbol]));
    try {
      await accountApi.exitPosition(tradingsymbol, quantity);
      load();
    } catch (e: any) {
      setExitError(`Exit failed: ${e.message}`);
    } finally {
      setExitingSet(prev => { const n = new Set(prev); n.delete(tradingsymbol); return n; });
    }
  }

  // ── Exit all open positions ────────────────────────────────────────────────
  async function handleExitAll() {
    setExitError("");
    setExitAllBusy(true);
    try {
      await accountApi.exitAll();
      load();
    } catch (e: any) {
      setExitError(`Exit All failed: ${e.message}`);
    } finally {
      setExitAllBusy(false);
    }
  }

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

          {/* Mobile: compact 3-col row (tap to open full modal) */}
          <div className="grid grid-cols-3 gap-2 mb-5 md:hidden">
            <MobileCompactCard title="Wallet" icon={<IconWallet size={12} />} accent="#16a34a" onClick={() => setActiveModal("wallet")}>
              <div className="text-[12px] font-black leading-tight truncate" style={{ ...MONO, color: "#16a34a" }}>
                ₹{fmt(data.wallet.available)}
              </div>
              <div className="text-[7px] mt-0.5" style={{ ...MONO, color: subtext }}>Available</div>
            </MobileCompactCard>
            <MobileCompactCard title="Charges" icon={<IconReceipt size={12} />} accent="#f59e0b" onClick={() => setActiveModal("charges")}>
              <div className="text-[12px] font-black leading-tight truncate" style={{ ...MONO, color: "#f59e0b" }}>
                ₹{fmt(data.charges.total)}
              </div>
              <div className="text-[7px] mt-0.5" style={{ ...MONO, color: subtext }}>Total</div>
            </MobileCompactCard>
            <MobileCompactCard title="P&L" icon={<IconChartBar size={12} />} accent="#ea580c" onClick={() => setActiveModal("pnl")}>
              {(() => {
                const net = +(data.pnl.unrealised - data.charges.total).toFixed(2);
                return (
                  <>
                    <div className="text-[12px] font-black leading-tight truncate"
                      style={{ ...MONO, color: net >= 0 ? "#16a34a" : "#e11d48" }}>
                      {net >= 0 ? "+" : ""}₹{fmt(Math.abs(net))}
                    </div>
                    <div className="text-[7px] mt-0.5" style={{ ...MONO, color: isDark ? "#64748b" : "#94a3b8" }}>Net</div>
                  </>
                );
              })()}
            </MobileCompactCard>
          </div>

          {/* Desktop: full cards (unchanged) */}
          <div className="hidden md:grid md:grid-cols-3 gap-3 mb-5">

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
                        {/* {data.pnl.total >= 0 ? "+" : ""}₹{fmt(data.pnl.total)} */}
                         {net >= 0 ? "+" : ""}₹{fmt(net)}
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

          {/* Mobile full-screen modals */}
          {activeModal === "wallet" && (
            <CardModal title="Wallet" icon={<IconWallet size={16} />} accent="#16a34a" onClose={() => setActiveModal(null)}>
              <div className="px-4 py-5 border-b" style={{ borderColor: border }}>
                <div className="text-[8px] uppercase tracking-[1.5px] mb-1.5" style={{ ...MONO, color: subtext }}>Available Balance</div>
                <div className="text-[24px] font-black leading-none tracking-tight" style={{ ...MONO, color: "#16a34a" }}>
                  ₹{fmt(data.wallet.available)}
                </div>
              </div>
              <div className="flex flex-col py-1">
                {([
                  { label: "Used Margin", val: `₹${fmt(data.wallet.used)}`,  color: "#f59e0b" },
                  { label: "Net Balance", val: `₹${fmt(data.wallet.net)}`,   color: text     },
                ] as { label: string; val: string; color: string }[]).map(({ label, val, color }) => (
                  <div key={label} className="flex items-center justify-between px-4 py-2.5 border-b border-dashed"
                    style={{ borderColor: isDark ? "#1e293b" : "#e2e8f0" }}>
                    <span className="text-[9px] uppercase tracking-[1px]" style={{ ...MONO, color: subtext }}>{label}</span>
                    <span className="text-[12px] font-bold" style={{ ...MONO, color }}>{val}</span>
                  </div>
                ))}
                
                <div className="flex items-center px-4 py-3 border-b border-dashed" style={{ borderColor: isDark ? "#1e293b" : "#e2e8f0" }}>
                  <div className="flex-1 flex flex-col gap-1 pr-3 border-r border-dashed" style={{ borderColor: isDark ? "#1e293b" : "#e2e8f0" }}>
                    <div className="flex items-center gap-1.5">
                      <IconArrowDownLeft size={11} color="#16a34a" />
                      <span className="text-[8px] uppercase tracking-[1px]" style={{ ...MONO, color: subtext }}>Deposit</span>
                    </div>
                    <span className="text-[12px] font-bold"
                      style={{ ...MONO, color: data.wallet.deposit > 0 ? "#16a34a" : muted }}>
                      ₹{fmt(data.wallet.deposit)}
                    </span>
                  </div>
                  <div className="flex-1 flex flex-col gap-1 pl-3">
                    <div className="flex items-center gap-1.5">
                      <IconArrowUpRight size={11} color="#e11d48" />
                      <span className="text-[8px] uppercase tracking-[1px]" style={{ ...MONO, color: subtext }}>Withdraw</span>
                    </div>
                    <span className="text-[12px] font-bold"
                      style={{ ...MONO, color: data.wallet.withdrawal > 0 ? "#e11d48" : muted }}>
                      ₹{fmt(data.wallet.withdrawal)}
                    </span>
                  </div>
                </div>

                {(() => {
                  const total    = data.wallet.used + data.wallet.available;
                  const pct      = total > 0 ? Math.min(100, +(data.wallet.used / total * 100).toFixed(1)) : 0;
                  const barColor = pct > 80 ? "#e11d48" : pct > 50 ? "#f59e0b" : "#16a34a";
                  return (
                    <div className="px-4 py-4 flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[8px] uppercase tracking-[1px]" style={{ ...MONO, color: subtext }}>Margin Utilisation</span>
                        <span className="text-[10px] font-black" style={{ ...MONO, color: barColor }}>{pct}%</span>
                      </div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: isDark ? "#1e293b" : "#f1f5f9" }}>
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: barColor }} />
                      </div>
                    </div>
                  );
                })()}
              </div>
            </CardModal>
          )}

          {activeModal === "charges" && (
            <CardModal title="Charges" icon={<IconReceipt size={16} />} accent="#f59e0b" onClose={() => setActiveModal(null)}>
              <div className="px-4 py-5 border-b" style={{ borderColor: border }}>
                <div className="text-[8px] uppercase tracking-[1.5px] mb-1.5" style={{ ...MONO, color: subtext }}>Total Charges</div>
                <div className="text-[24px] font-black leading-none tracking-tight" style={{ ...MONO, color: "#f59e0b" }}>
                  ₹{fmt(data.charges.total)}
                </div>
              </div>
              <div className="flex flex-col py-1">
                {([
                  ["Brokerage",         data.charges.brokerage],
                  ["STT",               data.charges.stt],
                  ["Exchange Turnover", data.charges.exchange],
                  ["SEBI Turnover",     data.charges.sebi],
                  ["GST",               data.charges.gst],
                  ["Stamp Duty",        data.charges.stampDuty],
                ] as [string, number][]).map(([l, v], i, arr) => (
                  <div key={l}
                    className={`flex items-center justify-between px-4 py-2.5 ${i < arr.length - 1 ? "border-b border-dashed" : ""}`}
                    style={{ borderColor: isDark ? "#1e293b" : "#e2e8f0" }}>
                    <span className="text-[9px] uppercase tracking-[1px]" style={{ ...MONO, color: subtext }}>{l}</span>
                    <span className="text-[12px] font-bold" style={{ ...MONO, color: text }}>₹{fmt(v)}</span>
                  </div>
                ))}
              </div>
            </CardModal>
          )}

          {activeModal === "pnl" && (
            <CardModal title="Overall P&L" icon={<IconChartBar size={16} />} accent="#ea580c" onClose={() => setActiveModal(null)}>
              {(() => {
                const net = +(data.pnl.unrealised - data.charges.total).toFixed(2);
                return (
                  <>
                    <div className="px-4 py-5 border-b" style={{ borderColor: border }}>
                      <div className="text-[8px] uppercase tracking-[1.5px] mb-1.5" style={{ ...MONO, color: subtext }}>Gross P&amp;L (Today)</div>
                      <div className="text-[24px] font-black leading-none tracking-tight"
                        style={{ ...MONO, color: data.pnl.total >= 0 ? "#16a34a" : "#e11d48" }}>
                        {data.pnl.total >= 0 ? "+" : ""}₹{fmt(data.pnl.total)}
                      </div>
                    </div>
                    <div className="flex flex-col py-1">
                      {([
                        { label: "Realised",   val: data.pnl.realised,   sign: true },
                        { label: "Unrealised", val: data.pnl.unrealised, sign: true },
                        { label: "Charges",    val: -data.charges.total, sign: false, display: `-₹${fmt(data.charges.total)}` },
                      ] as { label: string; val: number; sign: boolean; display?: string }[]).map(({ label, val, sign, display }, i) => (
                        <div key={label} className="flex items-center justify-between px-4 py-2.5 border-b border-dashed"
                          style={{ borderColor: isDark ? "#1e293b" : "#e2e8f0" }}>
                          <span className="text-[9px] uppercase tracking-[1px]" style={{ ...MONO, color: subtext }}>{label}</span>
                          <span className="text-[12px] font-bold"
                            style={{ ...MONO, color: val >= 0 ? (sign ? "#16a34a" : "#e11d48") : "#e11d48" }}>
                            {display ?? `${val >= 0 && sign ? "+" : ""}₹${fmt(Math.abs(val))}`}
                          </span>
                        </div>
                      ))}
                      
                      <div className="mx-4 mt-4 mb-2 px-4 py-3 rounded-xl flex flex-col gap-1.5"
                        style={{ background: net >= 0 ? "#16a34a12" : "#e11d4812", border: `1px solid ${net >= 0 ? "#16a34a33" : "#e11d4833"}` }}>
                        <div className="flex items-center gap-1.5">
                          <IconPercentage size={11} style={{ color: net >= 0 ? "#16a34a" : "#e11d48" }} />
                          <span className="text-[9px] font-bold uppercase tracking-[1px]" style={{ ...MONO, color: net >= 0 ? "#16a34a" : "#e11d48" }}>
                            Net (After Charges)
                          </span>
                        </div>
                        <span className="text-[20px] font-black tracking-tight" style={{ ...MONO, color: net >= 0 ? "#16a34a" : "#e11d48" }}>
                          {net >= 0 ? "+" : ""}₹{fmt(net)}
                        </span>
                      </div>
                    </div>
                  </>
                );
              })()}
            </CardModal>
          )}

          {/* ── Win rate stats — single card ── */}
          <div className="rounded-xl border mb-5 overflow-hidden"
            style={{ background: isDark ? "#0f172a" : "#fff", borderColor: isDark ? "#1e293b" : "#e2e8f0" }}>
            <div className="grid grid-cols-3 divide-x" style={{ borderColor: isDark ? "#1e293b" : "#e2e8f0" }}>
              {[
                { label: "Trades",   val: data.stats.totalTrades, color: muted      },
                { label: "Winners",  val: data.stats.winners,     color: "#16a34a"  },
                { label: "Losers",   val: data.stats.losers,      color: "#e11d48"  },
              ].map(({ label, val, color }) => (
                <div key={label} className="flex flex-col items-center py-3 gap-0.5"
                  style={{ borderColor: isDark ? "#1e293b" : "#e2e8f0" }}>
                  <span className="text-[7px] font-bold tracking-[1.5px] uppercase" style={{ ...MONO, color: subtext }}>{label}</span>
                  <span className="text-[22px] font-black leading-tight" style={{ ...MONO, color }}>{val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Positions header ── */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-[1.5px] uppercase" style={{ ...MONO, color: subtext }}>
                Today's Positions
              </span>
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded"
                style={{ ...MONO, background: "#16a34a22", color: "#16a34a" }}>
                LIVE
              </span>
            </div>
            <div className="flex items-center gap-2">
              {displayPositions.some(p => p.status === "OPEN") && (
                <button
                  onClick={handleExitAll}
                  disabled={exitAllBusy}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[9px] font-black tracking-[1px] uppercase disabled:opacity-50"
                  style={{ ...MONO, background: "#e11d48", color: "#fff" }}
                >
                  {exitAllBusy
                    ? <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                    : <IconPower size={11} />}
                  Exit All
                </button>
              )}
              <span className="text-[10px]" style={{ ...MONO, color: subtext }}>
                {displayPositions.length} position{displayPositions.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {exitError && (
            <div className="mb-3 px-3 py-2 rounded-lg text-[10px]"
              style={{ background: "#e11d4815", border: "1px solid #e11d4840", ...MONO, color: "#e11d48" }}>
              {exitError}
            </div>
          )}

          {displayPositions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 rounded-xl border mb-3"
              style={{ borderColor: border, background: isDark ? "#0f172a" : "#fff" }}>
              <span className="text-3xl" style={{ color: isDark ? "#1e293b" : "#e2e8f0" }}>◈</span>
              <span className="text-[11px]" style={{ ...MONO, color: subtext }}>No positions today</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-5">
              {displayPositions.map((p, i) => (
                <PositionCard
                  key={i}
                  p={p}
                  onExit={p.status === "OPEN" ? () => handleExit(p.tradingsymbol, p.quantity) : undefined}
                  isExiting={exitingSet.has(p.tradingsymbol)}
                />
              ))}
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
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded flex-shrink-0 w-9 flex justify-center items-center"
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

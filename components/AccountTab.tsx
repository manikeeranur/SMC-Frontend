"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { accountApi, settingsApi, type AccountDefaults } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { IconRefresh, IconWallet, IconReceipt, IconChartBar, IconList, IconDownload, IconClock,
         IconArrowUpRight, IconArrowDownLeft, IconPercentage, IconX, IconPower, IconXboxX } from "@tabler/icons-react";

const MONO = { fontFamily: "'Space Mono', monospace" } as const;

// ─── SL/TP/Lock persistence (survives page refresh) ──────────────────────────
type SLTPStore = { sl: number | null; tp: number | null; lockPts: number | null; lockDir: "up" | "down" | null };
const EMPTY_SLTP: SLTPStore = { sl: null, tp: null, lockPts: null, lockDir: null };

function sltpKey(tradingsymbol: string) { return `algo:sltp:${tradingsymbol}`; }

function loadSLTP(tradingsymbol: string): SLTPStore {
  if (typeof window === "undefined") return EMPTY_SLTP;
  try {
    const raw = window.localStorage.getItem(sltpKey(tradingsymbol));
    return raw ? { ...EMPTY_SLTP, ...JSON.parse(raw) } : EMPTY_SLTP;
  } catch { return EMPTY_SLTP; }
}

function saveSLTP(tradingsymbol: string, patch: Partial<SLTPStore>) {
  if (typeof window === "undefined") return;
  try {
    const next = { ...loadSLTP(tradingsymbol), ...patch };
    if (next.sl == null && next.tp == null && next.lockPts == null) {
      window.localStorage.removeItem(sltpKey(tradingsymbol));
    } else {
      window.localStorage.setItem(sltpKey(tradingsymbol), JSON.stringify(next));
    }
  } catch {}
}

type AccountData = Awaited<ReturnType<typeof accountApi.get>>;
type Position    = AccountData["positions"][number];

function fmt(n: number, d = 2) {
  return n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
}

// Kite's raw order rejection/cancellation messages embed plain decimal amounts
// (e.g. "Margin required: 1745760.90") — reformat those into ₹17,45,760.90
// style without touching non-currency numbers (order IDs, quantities, etc.,
// which don't carry a decimal point in these messages).
function formatKiteMessage(msg: string): string {
  return msg.replace(/\d+\.\d+/g, match => `₹${fmt(parseFloat(match))}`);
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

// ─── Modern segmented toggle — replaces native <select> for small option sets
function SegmentToggle<T extends string | number>({ options, value, onChange, activeColor }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  activeColor: string;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  return (
    <div className="inline-flex rounded-lg p-0.5 gap-0.5 flex-wrap"
      style={{ background: isDark ? "#1e293b" : "#eef1f6" }}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <button key={String(opt.value)} type="button" onClick={() => onChange(opt.value)}
            className="px-2.5 py-1 rounded-md text-[10px] font-bold transition-all duration-150 active:scale-95"
            style={{
              background: active ? activeColor : "transparent",
              color:      active ? "#fff" : (isDark ? "#94a3b8" : "#64748b"),
              ...MONO,
            }}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Toggle-switch row — one exact, shared design used for "Lock All", Lock
// Points, Stop Loss, and Target: a full-width card, toggle + label on the
// left, an input that stretches to fill the row, a "Set All" button, and an
// "active" badge — so every one of these settings looks and behaves identically.
function ToggleField({ label, show, onToggle, value, input, setInput, onApply, activeColor }: {
  label: string;
  show: boolean;
  onToggle: () => void;
  value: number | null;
  input: string;
  setInput: (v: string) => void;
  onApply: () => void;
  activeColor: string;
}) {
  const { theme } = useTheme();
  const isDark  = theme === "dark";
  const text    = isDark ? "#e2e8f0" : "#1a2332";

  return (
    <div className="flex items-center gap-2.5 flex-wrap px-3.5 py-2.5 rounded-2xl transition-colors duration-200"
      style={{ background: isDark ? "#0f172a" : "#f8f8ff",
               border: `1px solid ${show ? `${activeColor}50` : (isDark ? "#1e293b" : "#e2e8f0")}`,
               boxShadow: show ? `0 0 0 3px ${activeColor}12` : "none" }}>
      <button onClick={onToggle} className="flex items-center gap-2 flex-shrink-0 active:scale-95 transition-transform">
        <div className="relative w-10 h-[22px] rounded-full transition-colors duration-200"
          style={{ background: show ? activeColor : (isDark ? "#334155" : "#cbd5e1") }}>
          <div className="absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
            style={{ transform: show ? "translateX(20px)" : "translateX(3px)" }} />
        </div>
        <span className="text-[11px] font-bold flex items-center gap-1" style={{ color: show ? activeColor : text }}>
          {label}
        </span>
      </button>

      {show && (
        <>
          <input
            type="number" min="1" value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && onApply()} placeholder="pts e.g. 10"
            className="flex-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold outline-none min-w-[90px]"
            style={{ background: isDark ? "#1e293b" : "#fff", color: text, border: `1px solid ${activeColor}40`, ...MONO }}
          />
          <button onClick={onApply} className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-white flex-shrink-0 active:scale-95 transition-transform"
            style={{ background: activeColor }}>
            Set All
          </button>
          {value != null && (
            <span className="text-[9px] font-bold flex-shrink-0 whitespace-nowrap px-2 py-1 rounded-lg"
              style={{ background: `${activeColor}15`, color: activeColor }}>
              +{value} pts active
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ─── Toast notifications — transient confirmation for every settings change ──
type ToastKind = "success" | "error";
type ToastItem = { id: number; text: string; kind: ToastKind };

function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed left-1/2 bottom-5 z-[999] flex flex-col items-center gap-2 px-4"
      style={{ transform: "translateX(-50%)" }}>
      {toasts.map(t => (
        <div key={t.id}
          className="toast-pop flex items-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-bold"
          style={{
            background: t.kind === "success" ? "#16a34a" : "#e11d48",
            color: "#fff", ...MONO,
            boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
            maxWidth: "min(90vw, 360px)",
          }}>
          <span>{t.kind === "success" ? "✓" : "✕"}</span>
          <span className="truncate">{t.text}</span>
        </div>
      ))}
      <style jsx>{`
        .toast-pop { animation: toastPop 0.22s ease-out; }
        @keyframes toastPop {
          from { opacity: 0; transform: translateY(10px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

// ─── Uppercase the am/pm in backend-formatted times ("10:15:32 am" → "10:15:32 AM")
function fmtClock(t: string | null): string {
  if (!t) return "—";
  return t.replace(/\s?(am|pm)$/i, m => m.toUpperCase());
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
function PositionCard({ p, onExit, isExiting, defaultLockPts, accountDefaults }: {
  p: Position;
  onExit?: () => void;
  isExiting?: boolean;
  defaultLockPts?: number | null;
  accountDefaults?: AccountDefaults | null;
}) {
  const { theme } = useTheme();
  const isDark  = theme === "dark";
  const border  = isDark ? "#1e293b" : "#e8edf2";
  const subtext = isDark ? "#94a3b8" : "#8a9bb0";
  const text    = isDark ? "#e2e8f0" : "#1a2332";
  const cardBg  = isDark ? "#0f172a" : "#ffffff";

  const isOpen   = p.status === "OPEN";
  const optType  = (p.direction === "CE" ? "CE" : "PE") as "CE" | "PE";
  const pnlVal   = p.pnl;
  const pnlColor = pnlVal > 0 ? "#16a34a" : pnlVal < 0 ? "#e11d48" : subtext;

  const pricePct = p.buyPrice > 0 ? ((p.currentPrice - p.buyPrice) / p.buyPrice * 100) : 0;
  const pctUp    = pricePct >= 0;

  // SL/TP state — hydrated from localStorage (once, on mount) so it survives a page refresh
  const [showSLTP,   setShowSLTP]   = useState(false);
  const [slInput,    setSlInput]    = useState(() => { const v = loadSLTP(p.tradingsymbol).sl; return v != null ? String(v) : ""; });
  const [tpInput,    setTpInput]    = useState(() => { const v = loadSLTP(p.tradingsymbol).tp; return v != null ? String(v) : ""; });
  const [slSet,      setSlSet]      = useState<number | null>(() => loadSLTP(p.tradingsymbol).sl);
  const [tpSet,      setTpSet]      = useState<number | null>(() => loadSLTP(p.tradingsymbol).tp);

  // Lock Points state
  const [lockInput,  setLockInput]  = useState(() => { const v = loadSLTP(p.tradingsymbol).lockPts; return v != null ? String(v) : ""; });
  const [lockSet,    setLockSet]    = useState<number | null>(() => loadSLTP(p.tradingsymbol).lockPts);
  const [lockDir,    setLockDir]    = useState<"up" | "down" | null>(() => loadSLTP(p.tradingsymbol).lockDir);
  const lockTarget = lockSet !== null && p.buyPrice > 0 ? p.buyPrice + lockSet : null;

  function confirmSLTP() {
    const sl = parseFloat(slInput);
    const tp = parseFloat(tpInput);
    const patch: Partial<SLTPStore> = {};
    if (!isNaN(sl) && sl > 0) { setSlSet(sl); patch.sl = sl; }
    if (!isNaN(tp) && tp > 0) { setTpSet(tp); patch.tp = tp; }
    if (Object.keys(patch).length) saveSLTP(p.tradingsymbol, patch);
    setShowSLTP(false);
  }

  function applyLockPoints() {
    const pts = parseFloat(lockInput);
    if (!isNaN(pts) && pts > 0) {
      const target = p.buyPrice + pts;
      // CMP above lock target → price must fall DOWN to trigger
      // CMP below lock target → price must rise UP to trigger
      const dir = p.currentPrice >= target ? "down" : "up";
      setLockDir(dir);
      setLockSet(pts);
      saveSLTP(p.tradingsymbol, { lockPts: pts, lockDir: dir });
    }
  }

  // Per-unit points move — Gain/Loss (₹) is always this × quantity.
  const movePts = +((isOpen ? p.currentPrice : p.sellPrice) - p.buyPrice).toFixed(2);

  const displayName  = formatSymbol(p.tradingsymbol);
  const triggeredRef = useRef(false);
  const onExitRef    = useRef(onExit);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);

  // ── Auto-exit when price hits SL, TP, or Lock Target ───────────────────────
  useEffect(() => {
    if (!isOpen || triggeredRef.current) return;
    const cmp = p.currentPrice;
    if (cmp <= 0) return;

    const hitSL   = slSet      !== null && cmp <= slSet;
    const hitTP   = tpSet      !== null && cmp >= tpSet;
    const hitLock = lockTarget !== null && (
      lockDir === "down" ? cmp <= lockTarget   // profit case: price fell back to lock level
                         : cmp >= lockTarget   // loss case: price recovered up to lock level
    );

    if ((hitSL || hitTP || hitLock) && onExitRef.current) {
      triggeredRef.current = true;
      onExitRef.current();
    }
  // onExit intentionally excluded — use ref to avoid re-running on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.currentPrice, slSet, tpSet, lockTarget, isOpen]);

  // Reset trigger flag when SL/TP/Lock values are changed
  useEffect(() => { triggeredRef.current = false; }, [slSet, tpSet, lockSet, lockDir]);

  // Trade closed (exited) — drop its stored SL/TP/Lock so a future trade on
  // the same symbol doesn't inherit stale targets.
  useEffect(() => {
    if (!isOpen) saveSLTP(p.tradingsymbol, { sl: null, tp: null, lockPts: null, lockDir: null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // One-time seed from the Accounts-tab account defaults: only for a genuinely
  // new auto-trade-opened position (p.atStatus set, no existing localStorage
  // entry yet) — mirrors the real broker SL/Target the backend already set at
  // entry (see autoTrade.js/vwap930AutoTrade.js executeEntry) purely for
  // on-screen visibility; does not itself touch the broker order. Runs before
  // the "Lock All" global-toggle effect below so an active global toggle wins
  // if both apply.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !accountDefaults || p.atStatus == null || p.buyPrice <= 0) return;
    const existing = loadSLTP(p.tradingsymbol);
    if (existing.sl != null || existing.tp != null || existing.lockPts != null) { seededRef.current = true; return; }
    seededRef.current = true;

    const patch: Partial<SLTPStore> = {};
    if (accountDefaults.stopLoss != null) {
      const sl = +(p.buyPrice - accountDefaults.stopLoss).toFixed(2);
      setSlSet(sl); setSlInput(String(sl)); patch.sl = sl;
    }
    if (accountDefaults.target != null) {
      const tp = +(p.buyPrice + accountDefaults.target).toFixed(2);
      setTpSet(tp); setTpInput(String(tp)); patch.tp = tp;
    }
    if (accountDefaults.lockPoints != null) {
      const target = p.buyPrice + accountDefaults.lockPoints;
      const dir = p.currentPrice >= target ? "down" : "up";
      setLockSet(accountDefaults.lockPoints); setLockInput(String(accountDefaults.lockPoints)); setLockDir(dir);
      patch.lockPts = accountDefaults.lockPoints; patch.lockDir = dir;
    }
    if (Object.keys(patch).length) saveSLTP(p.tradingsymbol, patch);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountDefaults, p.atStatus]);

  // Apply default lock points from global toggle. Only clears a card's lock
  // when the global toggle transitions off (prevDefaultLockPts was set) —
  // not on mount — so a per-card lock hydrated from storage isn't wiped out
  // just because the global toggle happens to be off on page load.
  const prevDefaultLockPts = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevDefaultLockPts.current;
    prevDefaultLockPts.current = defaultLockPts;
    if (defaultLockPts != null && defaultLockPts > 0 && p.buyPrice > 0) {
      const target = p.buyPrice + defaultLockPts;
      const dir = p.currentPrice >= target ? "down" : "up";
      setLockDir(dir);
      setLockSet(defaultLockPts);
      setLockInput(String(defaultLockPts));
      saveSLTP(p.tradingsymbol, { lockPts: defaultLockPts, lockDir: dir });
    } else if (defaultLockPts == null && prev != null) {
      setLockSet(null);
      setLockDir(null);
      setLockInput("");
      saveSLTP(p.tradingsymbol, { lockPts: null, lockDir: null });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultLockPts]);

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
            {isOpen ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold flex-shrink-0 mt-0.5"
                style={{ color: isDark ? "#64748b" : "#6b7a90" }}>
                <span style={{ fontSize: 13 }}>🧳</span>
                {p.quantity} QTY
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[11px] font-bold flex-shrink-0 mt-0.5 px-1.5 py-0.5 rounded"
                style={{ color: "#16a34a", background: "#16a34a15" }}>
                <span style={{ fontSize: 11 }}>✓</span>
                {p.quantity} QTY Traded
              </span>
            )}
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
            <div className="text-[10px] font-semibold ms-auto" style={{ ...MONO, color: pnlColor }}>
            {movePts >= 0 ? "+" : ""}{fmt(movePts)} × {p.quantity}
            </div>       
          </div>
        </div>
      </div>

      {/* ── Divider ── */}
      <div style={{ height: 1, background: border, marginBottom: 2 }} />

      {/* ── Entry → Exit timeline (exact time, with seconds) ── */}
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-1 flex-wrap">
        <IconClock size={12} style={{ color: subtext, flexShrink: 0 }} />
        <span className="text-[10px] font-bold" style={{ ...MONO, color: text }}>{fmtClock(p.entryTime)}</span>
        <span style={{ color: subtext }}>→</span>
        <span className="text-[10px] font-bold" style={{ ...MONO, color: isOpen ? "#16a34a" : text }}>
          {isOpen ? "Live" : fmtClock(p.exitTime)}
        </span>
        <span className="ml-auto text-[9.5px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0"
          style={{ ...MONO, background: isDark ? "#1e293b" : "#f1f5f9", color: subtext }}>
          {fmtDuration(p.durationSecs)}
        </span>
      </div>

      {/* ── Stats row: Entry Price | Exit Price | Gain/Loss ── */}
      <div className="grid grid-cols-3 px-4 pt-2 pb-3 gap-2">
        <div>
          <div className="text-[11px] mb-0.5" style={{ color: subtext }}>Entry Price</div>
          <div className="text-[14px] font-bold" style={{ color: text }}>₹{fmt(p.buyPrice)}</div>
        </div>
        <div>
          <div className="text-[11px] mb-0.5" style={{ color: subtext }}>Exit Price</div>
          <div className="text-[14px] font-bold" style={{ color: text }}>
            {p.sellPrice > 0 ? `₹${fmt(p.sellPrice)}` : "—"}
          </div>
        </div>
        <div className="text-end">
          <div className="text-[11px] mb-0.5" style={{ color: subtext }}>Gain/Loss</div>
          <div className="text-[14px] font-bold" style={{ color: pnlColor }}>
            {pnlVal >= 0 ? "+" : ""}₹{fmt(pnlVal)}
          </div>
        </div>
      </div>

      {/* ── Lock Points input (open trades only) ── */}
      {isOpen && (
        <div className="mx-3 mb-2 rounded-xl px-3 py-2 flex items-center gap-2"
          style={{ background: isDark ? "#1a1f35" : "#f0f1ff", border: `1px solid #6366f130` }}>
          <span className="text-[10px] font-bold flex-shrink-0" style={{ color: "#6366f1" }}>
            🔒 Lock Pts
          </span>
          <input
            type="number"
            min="1"
            value={lockInput}
            onChange={e => setLockInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && applyLockPoints()}
            placeholder="e.g. 10"
            className="flex-1 rounded-lg px-2 py-1 text-[11px] font-bold outline-none min-w-0"
            style={{ background: isDark ? "#0f172a" : "#fff", color: text,
                     border: `1px solid #6366f140`, ...MONO }}
          />
          {p.buyPrice > 0 && lockInput && !isNaN(parseFloat(lockInput)) && parseFloat(lockInput) > 0 && (
            <span className="text-[10px] font-bold flex-shrink-0 whitespace-nowrap" style={{ color: "#6366f1" }}>
              → ₹{fmt(p.buyPrice + parseFloat(lockInput))}
            </span>
          )}
          <button
            onClick={applyLockPoints}
            disabled={!lockInput || isNaN(parseFloat(lockInput)) || parseFloat(lockInput) <= 0}
            className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-white flex-shrink-0 disabled:opacity-40"
            style={{ background: "#6366f1" }}>
            Set
          </button>
        </div>
      )}

      {/* ── SL/TP/Lock chips ── */}
      {(slSet !== null || tpSet !== null || lockTarget !== null) && (
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
              <button onClick={() => { setSlSet(null); saveSLTP(p.tradingsymbol, { sl: null }); triggeredRef.current = false; }}
                className="ml-0.5 opacity-60 hover:opacity-100">×</button>
            </span>
          )}
          {tpSet !== null && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-bold"
              style={{ background: "#16a34a15", color: "#16a34a" }}>
              TP ₹{fmt(tpSet)}
              <button onClick={() => { setTpSet(null); saveSLTP(p.tradingsymbol, { tp: null }); triggeredRef.current = false; }}
                className="ml-0.5 opacity-60 hover:opacity-100">×</button>
            </span>
          )}
          {lockTarget !== null && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-bold"
              style={{ background: "#6366f115", color: "#6366f1" }}>
              🔒 +{lockSet}pts → ₹{fmt(lockTarget)}
              <button onClick={() => { setLockSet(null); setLockDir(null); setLockInput(""); saveSLTP(p.tradingsymbol, { lockPts: null, lockDir: null }); triggeredRef.current = false; }}
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
export function AccountTab({ onOpenPositionChange }: { onOpenPositionChange?: (hasOpen: boolean) => void } = {}) {
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

  // Toasts — every settings change below confirms (or reports failure) here
  // instead of a static inline error line.
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  function showToast(text: string, kind: ToastKind = "success") {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, text, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2800);
  }

  // Global lock points — DB-backed via /api/settings so laptop/phone/any
  // device agree on the same value (previously localStorage-only, which is
  // why it could show 100 on one device and something else on another).
  const [globalLockOn,    setGlobalLockOn]    = useState(false);
  const [globalLockInput, setGlobalLockInput] = useState("");
  const [globalLockPts,   setGlobalLockPts]   = useState<number | null>(null);

  async function applyGlobalLock() {
    const pts = parseFloat(globalLockInput);
    if (isNaN(pts) || pts <= 0) return;
    const prevOn = globalLockOn, prevPts = globalLockPts;
    setGlobalLockOn(true); setGlobalLockPts(pts);
    try {
      await settingsApi.updateGlobalLock({ on: true, pts });
      showToast(`Lock All set to +${pts} pts`);
    } catch (e: any) {
      setGlobalLockOn(prevOn); setGlobalLockPts(prevPts);
      showToast(`Failed to save Lock All — ${e.message}`, "error");
    }
  }

  async function toggleGlobalLock() {
    const prevOn = globalLockOn, prevPts = globalLockPts, prevInput = globalLockInput;
    if (globalLockOn) {
      setGlobalLockOn(false); setGlobalLockPts(null); setGlobalLockInput("");
      try { await settingsApi.updateGlobalLock({ on: false, pts: null }); showToast("Lock All disabled"); }
      catch (e: any) {
        setGlobalLockOn(prevOn); setGlobalLockPts(prevPts); setGlobalLockInput(prevInput);
        showToast(`Failed to update Lock All — ${e.message}`, "error");
      }
    } else {
      setGlobalLockOn(true);
      try { await settingsApi.updateGlobalLock({ on: true, pts: globalLockPts }); showToast("Lock All enabled"); }
      catch (e: any) {
        setGlobalLockOn(prevOn);
        showToast(`Failed to update Lock All — ${e.message}`, "error");
      }
    }
  }

  // Account defaults — Quantity/Product Type/Trading Mode/default Lock Points/
  // SL/Target for future auto-trade entries. DB-backed via /api/settings so
  // they survive refresh/restart/other devices; falls back to today's
  // hardcoded backend constants if the fetch fails.
  const [accountDefaults, setAccountDefaults] = useState<AccountDefaults | null>(null);
  const [defLockInput,    setDefLockInput]    = useState("");
  const [defSlInput,      setDefSlInput]      = useState("");
  const [defTargetInput,  setDefTargetInput]  = useState("");

  // Whether each field's toggle is open (input visible) — same on/off pattern
  // as "Lock All", so the whole panel is one consistent toggle-switch UI.
  const [showDefLock,   setShowDefLock]   = useState(false);
  const [showDefSl,     setShowDefSl]     = useState(false);
  const [showDefTarget, setShowDefTarget] = useState(false);

  useEffect(() => {
    settingsApi.get()
      .then(s => {
        setAccountDefaults(s.accountDefaults);
        setDefLockInput(s.accountDefaults.lockPoints != null ? String(s.accountDefaults.lockPoints) : "");
        setDefSlInput(s.accountDefaults.stopLoss   != null ? String(s.accountDefaults.stopLoss)   : "");
        setDefTargetInput(s.accountDefaults.target != null ? String(s.accountDefaults.target)     : "");
        setShowDefLock(s.accountDefaults.lockPoints != null);
        setShowDefSl(s.accountDefaults.stopLoss     != null);
        setShowDefTarget(s.accountDefaults.target   != null);
        setGlobalLockOn(s.globalLock?.on ?? false);
        setGlobalLockPts(s.globalLock?.pts ?? null);
        setGlobalLockInput(s.globalLock?.pts != null ? String(s.globalLock.pts) : "");
      })
      .catch(() => setAccountDefaults({
        lockPoints: null, stopLoss: null, target: null,
        quantity: 10, productType: "MIS", tradingMode: "PAPER",
      }));
  }, []);

  async function updateAccountDefaults(patch: Partial<AccountDefaults>, label: string) {
    const prev = accountDefaults;
    setAccountDefaults(d => (d ? { ...d, ...patch } : d));
    try {
      const updated = await settingsApi.updateAccountDefaults(patch);
      setAccountDefaults(updated.accountDefaults);
      showToast(label);
    } catch (e: any) {
      setAccountDefaults(prev);
      showToast(`Failed to save — ${e.message}`, "error");
    }
  }

  function saveDefLock() {
    const v = defLockInput === "" ? null : parseFloat(defLockInput);
    if (v === null || (!isNaN(v) && v > 0)) updateAccountDefaults({ lockPoints: v }, v === null ? "Default Lock Points cleared" : `Default Lock Points set to ${v}`);
  }
  function saveDefSl() {
    const v = defSlInput === "" ? null : parseFloat(defSlInput);
    if (v === null || (!isNaN(v) && v > 0)) updateAccountDefaults({ stopLoss: v }, v === null ? "Default Stop Loss cleared" : `Default Stop Loss set to ${v} pts`);
  }
  function saveDefTarget() {
    const v = defTargetInput === "" ? null : parseFloat(defTargetInput);
    if (v === null || (!isNaN(v) && v > 0)) updateAccountDefaults({ target: v }, v === null ? "Default Target cleared" : `Default Target set to ${v} pts`);
  }

  function toggleDefLock() {
    if (showDefLock) { setShowDefLock(false); setDefLockInput(""); updateAccountDefaults({ lockPoints: null }, "Default Lock Points disabled"); }
    else setShowDefLock(true);
  }
  function toggleDefSl() {
    if (showDefSl) { setShowDefSl(false); setDefSlInput(""); updateAccountDefaults({ stopLoss: null }, "Default Stop Loss disabled"); }
    else setShowDefSl(true);
  }
  function toggleDefTarget() {
    if (showDefTarget) { setShowDefTarget(false); setDefTargetInput(""); updateAccountDefaults({ target: null }, "Default Target disabled"); }
    else setShowDefTarget(true);
  }

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try   { setData(await accountApi.get()); }
    catch (e: any) { setError(e.message || "Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Wallet / charges / P&L polling — charges come from Kite's own charge
  // engine (getvirtualContractNote), one of its slower endpoints, so this
  // runs far less often than the lightweight live-positions poll below.
  // Hitting it every 500ms was needlessly loading Kite's API and could stall
  // faster, unrelated calls (like a manual exit) behind it.
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
    const id = setInterval(poll, 5000);
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

  // Report open-position state up to the page — the browser-tab favicon/title
  // indicator lives there since it also needs scan/WS status this component
  // doesn't have. Keyed off a derived boolean, not the `displayPositions`
  // array itself, since that array gets a new reference on every 500ms poll
  // tick — keying off it directly would fire the callback twice a second.
  const hasOpenPosition = displayPositions.some(p => p.status === "OPEN");
  useEffect(() => {
    onOpenPositionChange?.(hasOpenPosition);
  }, [hasOpenPosition, onOpenPositionChange]);

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
          <div className="flex items-center justify-between mb-2">
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

          {/* ── Lock All / Lock Points / SL / Target — one shared toggle-row
              design, shown one by one (each its own full-width row) ── */}
          <div className="flex flex-col gap-2.5 mb-3">
            <ToggleField label="🔒 Lock All" show={globalLockOn} onToggle={toggleGlobalLock}
              value={globalLockPts} input={globalLockInput} setInput={setGlobalLockInput}
              onApply={applyGlobalLock} activeColor="#6366f1" />

            <ToggleField label="🔒 Lock Points" show={showDefLock} onToggle={toggleDefLock}
              value={accountDefaults?.lockPoints ?? null} input={defLockInput} setInput={setDefLockInput}
              onApply={saveDefLock} activeColor="#6366f1" />

            <ToggleField label="🛑 Stop Loss" show={showDefSl} onToggle={toggleDefSl}
              value={accountDefaults?.stopLoss ?? null} input={defSlInput} setInput={setDefSlInput}
              onApply={saveDefSl} activeColor="#e11d48" />

            <ToggleField label="🎯 Target" show={showDefTarget} onToggle={toggleDefTarget}
              value={accountDefaults?.target ?? null} input={defTargetInput} setInput={setDefTargetInput}
              onApply={saveDefTarget} activeColor="#16a34a" />
          </div>

          {/* ── Auto-trade account defaults (persisted to DB) ── */}
          <div className="flex flex-col gap-3 mb-3 px-3.5 py-3.5 rounded-2xl"
            style={{ background: isDark ? "#0f172a" : "#f8f8ff", border: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}` }}>
            <span className="text-[9px] font-bold uppercase tracking-[1px]" style={{ ...MONO, color: subtext }}>
              ⚙ Auto-Trade Defaults
            </span>

            {/* One control per row on mobile (flex-col — easier to tap, no
                cramped wrapping); a single line on large screens. */}
            <div className="flex flex-col lg:flex-row lg:flex-nowrap lg:items-center gap-2.5 lg:gap-4 lg:overflow-x-auto">
              <div className="flex items-center justify-between lg:justify-start w-full lg:w-auto gap-2 flex-shrink-0">
                <span className="text-[10px] font-semibold" style={{ color: subtext }}>Qty</span>
                <SegmentToggle
                  options={[5, 10, 15, 20].map(q => ({ value: q, label: String(q) }))}
                  value={accountDefaults?.quantity ?? 10}
                  activeColor="#6366f1"
                  onChange={v => updateAccountDefaults({ quantity: v as 5 | 10 | 15 | 20 }, `Quantity set to ${v} lots`)}
                />
              </div>

              <div className="flex items-center justify-between lg:justify-start w-full lg:w-auto gap-2 flex-shrink-0">
                <span className="text-[10px] font-semibold" style={{ color: subtext }}>Product</span>
                <SegmentToggle
                  options={[{ value: "MIS", label: "MIS" }, { value: "NRML", label: "NRML" }]}
                  value={accountDefaults?.productType ?? "MIS"}
                  activeColor="#0284c7"
                  onChange={v => updateAccountDefaults({ productType: v as "MIS" | "NRML" }, `Product set to ${v}`)}
                />
              </div>

              <div className="flex items-center justify-between lg:justify-start w-full lg:w-auto gap-2 flex-shrink-0">
                <span className="text-[10px] font-semibold" style={{ color: subtext }}>Mode</span>
                <SegmentToggle
                  options={[{ value: "LIVE", label: "LIVE" }, { value: "PAPER", label: "PAPER" }]}
                  value={accountDefaults?.tradingMode ?? "PAPER"}
                  activeColor={accountDefaults?.tradingMode === "PAPER" ? "#f59e0b" : "#16a34a"}
                  onChange={v => updateAccountDefaults(
                    { tradingMode: v as "LIVE" | "PAPER" },
                    v === "PAPER" ? "PAPER mode enabled — orders will be simulated" : "LIVE mode enabled — real orders will be placed"
                  )}
                />
              </div>
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
              {displayPositions.map((p) => (
                <PositionCard
                  key={p.tradingsymbol}
                  p={p}
                  onExit={p.status === "OPEN" ? () => handleExit(p.tradingsymbol, p.quantity) : undefined}
                  isExiting={exitingSet.has(p.tradingsymbol)}
                  defaultLockPts={globalLockOn ? globalLockPts : null}
                  accountDefaults={accountDefaults}
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
                    className={`px-3 py-2.5 ${i > 0 ? "border-t" : ""}`}
                    style={{ borderColor: border }}>
                    <div className="flex items-center gap-3">
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
                    {/* Rejection/cancellation reason — only shown when Kite provides one */}
                    {isReject && o.status_message && (
                      <div className="text-[9px] mt-1 pl-12 truncate" style={{ ...MONO, color: "#e11d48" }} title={formatKiteMessage(o.status_message)}>
                        ⚠ {formatKiteMessage(o.status_message)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      <ToastStack toasts={toasts} />
    </div>
  );
}

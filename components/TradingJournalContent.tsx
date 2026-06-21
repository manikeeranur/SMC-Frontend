"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";
import { LOT_SIZE, NUM_LOTS, MARKET_HOLIDAYS_MAP } from "@/lib/constants";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";

const API    = process.env.NEXT_PUBLIC_API_URL || "http://13.61.175.6:4000";
const MONO   = { fontFamily: "'Space Mono', monospace" } as const;
const BEBAS  = { fontFamily: "'Bebas Neue', sans-serif" } as const;
const ACCENT = "#7c3aed";

const MONTH_NAMES  = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_SHORT  = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const DAY_NAMES    = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
// Lot qty — always use the constant at module level (SSR-safe).
// Components that need the adjustable version read it reactively via useEffect.
const LOT_QTY = LOT_SIZE * NUM_LOTS;

type DaySummary = { date: string; totalPnL: number; trades: number; wins: number };
type ViewType   = "month" | "year" | "overall";

// Generic bar-chart entry (pre-computed, view-agnostic)
type BarEntry = {
  key: string;
  label: string;      // main x-axis label  e.g. "5 MAR" | "JAN" | "2024"
  lot: number;        // already-computed lot P&L
  trades: number;
  wins: number;
  tipLine2?: string;  // optional 2nd tooltip line  e.g. "5 MAR 2026" | "JAN 2026" | "2024"
};

// ─── Formatters ───────────────────────────────────────────────────────────────

function pnlColor(n: number) { return n >= 0 ? "#16a34a" : "#e11d48"; }

function fmtAmt(n: number) {
  const abs = Math.abs(n);
  const s   = n >= 0 ? "+" : "−";
  if (abs >= 100000) return `${s}₹${(abs / 100000).toFixed(1)}L`;
  if (abs >= 1000)   return `${s}₹${(abs / 1000).toFixed(1)}K`;
  return `${s}₹${abs.toFixed(0)}`;
}

function fmtAmtRounded(n: number) {
  const sign = n >= 0 ? "+" : "−";
  const int  = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}₹${int}`;
}

// Indian comma: 1,00,000.00
function fmtIndianFull(n: number): string {
  const sign       = n >= 0 ? "+" : "−";
  const [int, dec] = Math.abs(n).toFixed(2).split(".");
  let grouped: string;
  if (int.length <= 3) {
    grouped = int;
  } else {
    const last3 = int.slice(-3);
    const rest  = int.slice(0, int.length - 3);
    grouped     = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  }
  return `${sign}₹${grouped}.${dec}`;
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

// ─── Donut Chart ──────────────────────────────────────────────────────────────

function polar(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + r * Math.cos(angle - Math.PI / 2), y: cy + r * Math.sin(angle - Math.PI / 2) };
}
function arcPath(cx: number, cy: number, R: number, ri: number, a1: number, a2: number) {
  const o1 = polar(cx, cy, R,  a1); const o2 = polar(cx, cy, R,  a2);
  const i1 = polar(cx, cy, ri, a2); const i2 = polar(cx, cy, ri, a1);
  const lg = a2 - a1 > Math.PI ? 1 : 0;
  return `M${o1.x},${o1.y} A${R},${R},0,${lg},1,${o2.x},${o2.y} L${i1.x},${i1.y} A${ri},${ri},0,${lg},0,${i2.x},${i2.y}Z`;
}

function DonutChart({ profit, loss, isDark, label = "Total P&L" }: {
  profit: number; loss: number; isDark: boolean; label?: string;
}) {
  const cx = 100, cy = 100, R = 82, ri = 50;
  const net   = profit + loss;
  const total = profit + Math.abs(loss);
  const muted = isDark ? "#4a6080" : "#94a3b8";
  const bg    = isDark ? "#0d1420" : "#f8fafc";

  if (total < 0.01) {
    return (
      <div className="flex items-center justify-center" style={{ height: 200 }}>
        <span style={{ ...MONO, color: muted, fontSize: 10 }}>No trades</span>
      </div>
    );
  }
  const profitFrac = profit / total;
  const GAP        = 0.05;
  const onlyProfit = Math.abs(loss) < 0.01;
  const onlyLoss   = profit < 0.01;
  const pPct       = total > 0 ? ((profit / total) * 100).toFixed(0) : "0";
  const lPct       = total > 0 ? ((Math.abs(loss) / total) * 100).toFixed(0) : "0";

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* Donut SVG — no in-SVG labels, clean and compact */}
      <svg viewBox="0 0 200 200" style={{ width: "min(190px, 100%)", height: "auto", display: "block" }}>
        {onlyProfit && <><circle cx={cx} cy={cy} r={R} fill="#16a34a" /><circle cx={cx} cy={cy} r={ri} fill={bg} /></>}
        {onlyLoss   && <><circle cx={cx} cy={cy} r={R} fill="#e11d48" /><circle cx={cx} cy={cy} r={ri} fill={bg} /></>}
        {!onlyProfit && !onlyLoss && <>
          {profit > 0 && <path d={arcPath(cx, cy, R, ri, GAP / 2, profitFrac * 2 * Math.PI - GAP / 2)} fill="#16a34a" />}
          {Math.abs(loss) > 0 && <path d={arcPath(cx, cy, R, ri, profitFrac * 2 * Math.PI + GAP / 2, 2 * Math.PI - GAP / 2)} fill="#e11d48" />}
        </>}
        {/* Center: label + net P&L */}
        <text x={cx} y={cy - 11} textAnchor="middle" fontSize="8" fontWeight="700"
          fontFamily="'Space Mono',monospace" fill={muted} letterSpacing="1.5">{label.toUpperCase()}</text>
        <text x={cx} y={cy + 11} textAnchor="middle" fontSize="16" fontWeight="bold"
          fontFamily="'Bebas Neue',sans-serif" fill={pnlColor(net)}>{fmtIndianFull(net)}</text>
      </svg>

      {/* HTML legend — replaces clipped SVG labels */}
      <div className="flex gap-5 justify-center w-full flex-wrap">
        {profit > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: "#16a34a" }} />
            <div>
              <div className="text-[7px] font-bold tracking-[1px]" style={{ ...MONO, color: muted }}>
                PROFIT · {pPct}%
              </div>
              <div className="text-[10px] font-bold" style={{ ...MONO, color: "#16a34a" }}>
                {fmtIndianFull(profit)}
              </div>
            </div>
          </div>
        )}
        {Math.abs(loss) > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: "#e11d48" }} />
            <div>
              <div className="text-[7px] font-bold tracking-[1px]" style={{ ...MONO, color: muted }}>
                LOSS · {lPct}%
              </div>
              <div className="text-[10px] font-bold" style={{ ...MONO, color: "#e11d48" }}>
                {fmtIndianFull(loss)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Calendar Heatmap ────────────────────────────────────────────────────────

function CalHeatmap({ year, month, summaryMap, isDark, border, color, muted }: {
  year: number; month: number;
  summaryMap: Record<string, DaySummary>;
  isDark: boolean; border: string; color: string; muted: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const cells = buildCalendar(year, month);

  const maxAbs = Math.max(
    1,
    ...cells.filter(Boolean).map(d => {
      const ds = `${year}-${String(month).padStart(2, "0")}-${String(d as number).padStart(2, "0")}`;
      const s  = summaryMap[ds];
      return s ? Math.abs(s.totalPnL * LOT_QTY) : 0;
    })
  );

  const hovDs   = hovered
    ? `${year}-${String(month).padStart(2, "0")}-${String(hovered).padStart(2, "0")}`
    : null;
  const hovData = hovDs ? summaryMap[hovDs] : null;

  return (
    <div>
      {/* Day name row */}
      <div className="grid grid-cols-7 mb-1" style={{ gap: 4 }}>
        {DAY_NAMES.map(d => (
          <div key={d} className="text-center text-[8px] font-bold py-1"
            style={{ ...MONO, color: muted, letterSpacing: "1px" }}>{d.slice(0, 1)}</div>
        ))}
      </div>

      {/* Heatmap grid */}
      <div className="grid grid-cols-7" style={{ gap: 4 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} style={{ aspectRatio: "1" }} />;
          const ds      = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const data    = summaryMap[ds];
          const lot     = data ? data.totalPnL * LOT_QTY : null;
          const isToday = ds === new Date().toISOString().slice(0, 10);
          const holiday = MARKET_HOLIDAYS_MAP[ds];
          const isHol   = !!holiday && !data;
          const isHov   = hovered === day;

          let bg: string, bc: string, dayClr: string;
          if (data && lot !== null) {
            const intensity = 0.18 + 0.65 * (Math.abs(lot) / maxAbs);
            bg     = lot >= 0 ? `rgba(22,163,74,${intensity})` : `rgba(225,29,72,${intensity})`;
            bc     = lot >= 0 ? `rgba(22,163,74,${Math.min(1, intensity + 0.2)})` : `rgba(225,29,72,${Math.min(1, intensity + 0.2)})`;
            dayClr = lot >= 0 ? (isDark ? "#86efac" : "#15803d") : (isDark ? "#fca5a5" : "#b91c1c");
          } else if (isHol) {
            bg = "rgba(251,191,36,0.22)"; bc = "rgba(251,191,36,0.55)"; dayClr = "#b45309";
          } else {
            bg     = isDark ? "rgba(15,25,35,0.9)" : "rgba(248,250,252,1)";
            bc     = isDark ? "#1e2a3a" : "#e2e8f0";
            dayClr = isDark ? "#4a6080" : "#94a3b8";
          }

          return (
            <div key={i}
              onMouseEnter={() => setHovered(day)}
              onMouseLeave={() => setHovered(null)}
              className="rounded-md flex flex-col items-center justify-center select-none"
              style={{
                aspectRatio: "1",
                background: bg,
                border: `${isToday ? "2px" : "1px"} solid ${isToday ? ACCENT : (isHov ? (isDark ? "#64748b" : "#94a3b8") : bc)}`,
                transform: isHov ? "scale(1.06)" : "scale(1)",
                transition: "transform 0.1s",
                cursor: "default",
                padding: 2,
              }}>
              <span className="text-[9px] sm:text-[11px] font-bold leading-none"
                style={{ ...MONO, color: isToday ? ACCENT : dayClr }}>{day}</span>
              {data && lot !== null && (
                <span className="text-[6px] sm:text-[7px] font-bold mt-0.5 leading-none text-center"
                  style={{ ...MONO, color: lot >= 0 ? "#16a34a" : "#e11d48" }}>
                  {fmtAmt(lot)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Hover detail strip */}
      <div className="mt-2 h-9 px-3 rounded-lg flex items-center"
        style={{ background: isDark ? "#0d1420" : "#f8fafc", border: `1px solid ${border}` }}>
        {hovDs ? (
          hovData ? (
            <div className="flex items-center gap-4 w-full text-[8px] flex-wrap">
              <span className="font-bold" style={{ ...MONO, color }}>
                {(() => { const dc = fmtDateCell(hovDs); return `${dc.top} ${dc.bot}`; })()}
              </span>
              <span className="font-bold" style={{ ...MONO, color: pnlColor(hovData.totalPnL * LOT_QTY) }}>
                {fmtIndianFull(hovData.totalPnL * LOT_QTY)}
              </span>
              <span style={{ ...MONO, color: muted }}>{hovData.trades}T</span>
              <span className="font-bold" style={{ ...MONO, color: "#16a34a" }}>{hovData.wins}W</span>
              <span className="font-bold" style={{ ...MONO, color: "#e11d48" }}>{hovData.trades - hovData.wins}L</span>
              {hovData.trades > 0 && (
                <span className="font-bold ml-auto" style={{
                  ...MONO,
                  color: hovData.wins / hovData.trades >= 0.7 ? "#16a34a" : "#e11d48",
                }}>
                  {((hovData.wins / hovData.trades) * 100).toFixed(0)}% WR
                </span>
              )}
            </div>
          ) : (
            <span className="text-[8px]" style={{ ...MONO, color: muted }}>
              {MARKET_HOLIDAYS_MAP[hovDs] ? `Holiday: ${MARKET_HOLIDAYS_MAP[hovDs]}` : "No trades this day"}
            </span>
          )
        ) : (
          <span className="text-[8px]" style={{ ...MONO, color: muted }}>Hover a day to see details</span>
        )}
      </div>
    </div>
  );
}

// ─── Bar Chart (generic BarEntry[]) ──────────────────────────────────────────

function BarChart({ data, isDark }: { data: BarEntry[]; isDark: boolean }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const muted = isDark ? "#64748b" : "#94a3b8";

  if (!data.length) {
    return (
      <div className="flex items-center justify-center w-full" style={{ height: 240 }}>
        <span style={{ ...MONO, color: muted, fontSize: 10 }}>No trades</span>
      </div>
    );
  }

  const maxAbs  = Math.max(...data.map(d => Math.abs(d.lot)), 1);
  const BAR_W   = 46, GAP = 12, PAD_L = 10, PAD_R = 10;
  const HALF_H  = 90, PAD_TOP = 56, PAD_BOT = 48;
  const ZERO_Y  = PAD_TOP + HALF_H;
  const SVG_W   = PAD_L + data.length * (BAR_W + GAP) - GAP + PAD_R;
  const SVG_H   = PAD_TOP + HALF_H * 2 + PAD_BOT;
  const TIP_W   = 142, TIP_H = 46;

  return (
    <div style={{ overflowX: "auto", width: "100%" }}>
      <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} width={Math.max(SVG_W, 300)} height={SVG_H}
        style={{ display: "block", minWidth: 300 }}>
        <line x1={0} y1={ZERO_Y} x2={SVG_W} y2={ZERO_Y}
          stroke={isDark ? "#2a3a4a" : "#cbd5e1"} strokeWidth="1" />

        {data.map((d, i) => {
          const x      = PAD_L + i * (BAR_W + GAP);
          const barH   = Math.max((Math.abs(d.lot) / maxAbs) * HALF_H - 2, 2);
          const isP    = d.lot >= 0;
          const clr    = isP ? "#16a34a" : "#e11d48";
          const barY   = isP ? ZERO_Y - barH : ZERO_Y;
          const lbl    = fmtAmt(d.lot);
          const lblY   = isP ? Math.max(barY - 5, 11) : Math.min(barY + barH + 13, SVG_H - PAD_BOT + 6);
          const isHov  = hoveredIdx === i;

          return (
            <g key={d.key}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{ cursor: "default" }}>
              {isHov && (
                <rect x={x - 3} y={PAD_TOP - 4} width={BAR_W + 6} height={HALF_H * 2 + 8}
                  rx={4} fill={clr} opacity={0.07} />
              )}
              <rect x={x} y={barY} width={BAR_W} height={barH} fill={clr} rx={3} opacity={isHov ? 1 : 0.85} />
              <text x={x + BAR_W / 2} y={lblY} textAnchor="middle" fontSize="9" fontWeight="bold"
                fontFamily="'Space Mono',monospace" fill={clr}>{lbl}</text>
              <text x={x + BAR_W / 2} y={ZERO_Y + HALF_H + 17} textAnchor="middle" fontSize="9"
                fontWeight="600" fontFamily="'Space Mono',monospace" fill={muted}>{d.label}</text>
              <text x={x + BAR_W / 2} y={ZERO_Y + HALF_H + 31} textAnchor="middle" fontSize="7"
                fontFamily="'Space Mono',monospace" fill={isDark ? "#4a6080" : "#b0bec5"}>{d.trades}T</text>
            </g>
          );
        })}

        {/* Tooltip */}
        {hoveredIdx !== null && (() => {
          const d    = data[hoveredIdx];
          const isP  = d.lot >= 0;
          const clr  = isP ? "#16a34a" : "#e11d48";
          const bx   = PAD_L + hoveredIdx * (BAR_W + GAP);
          const barH = Math.max((Math.abs(d.lot) / maxAbs) * HALF_H - 2, 2);
          const barY = isP ? ZERO_Y - barH : ZERO_Y;
          const tx   = Math.min(Math.max(bx + BAR_W / 2 - TIP_W / 2, 2), SVG_W - TIP_W - 2);
          const ty   = isP ? barY - TIP_H - 10 : barY + barH + 10;
          const losses = d.trades - d.wins;
          return (
            <g pointerEvents="none">
              <rect x={tx} y={ty} width={TIP_W} height={TIP_H} rx={5}
                fill={isDark ? "#0f1923" : "#fff"} stroke={clr} strokeWidth="1.2"
                style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.25))" }} />
              <text x={tx + TIP_W / 2} y={ty + 13} textAnchor="middle" fontSize="10" fontWeight="bold"
                fontFamily="'Space Mono',monospace" fill={clr}>{fmtIndianFull(d.lot)}</text>
              {d.tipLine2 && (
                <text x={tx + TIP_W / 2} y={ty + 26} textAnchor="middle" fontSize="8"
                  fontFamily="'Space Mono',monospace" fill={isDark ? "#64748b" : "#94a3b8"}>{d.tipLine2}</text>
              )}
              <text x={tx + TIP_W / 2} y={ty + (d.tipLine2 ? 39 : 30)} textAnchor="middle" fontSize="8"
                fontFamily="'Space Mono',monospace" fill={isDark ? "#4a6080" : "#94a3b8"}>
                {d.trades}T · {d.wins}W · {losses}L
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

// ─── Reusable stats footer row ────────────────────────────────────────────────

function StatsRow({ cols, isDark, border }: {
  cols: { label: string; val: string; color: string }[];
  isDark: boolean;
  border: string;
}) {
  return (
    <div className={`grid border-t`} style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)`, gap: "1px", background: border }}>
      {cols.map(({ label, val, color: c }) => (
        <div key={label} className="px-3 py-2.5" style={{ background: isDark ? "#0a0f16" : "#fff" }}>
          <div className="text-[7px] tracking-[1.5px] uppercase mb-1"
            style={{ ...MONO, color: isDark ? "#4a6080" : "#64748b" }}>{label}</div>
          <div className="text-[14px] font-bold leading-tight" style={{ ...MONO, color: c }}>{val}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Charts side-by-side panel ────────────────────────────────────────────────

function ChartsPanel({
  profit, loss, barData, donutLabel,
  donutFooter, barFooter, isDark, border, barHeader,
}: {
  profit: number; loss: number;
  barData: BarEntry[];
  donutLabel?: string;
  donutFooter: { label: string; val: string; color: string }[];
  barFooter:   { label: string; val: string; color: string }[];
  barHeader?: string;
  isDark: boolean;
  border: string;
}) {
  const cardBg = isDark ? "#0d1420" : "#f8fafc";
  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Donut */}
      <div className="flex-1 min-w-0 rounded-xl border flex flex-col overflow-hidden"
        style={{ borderColor: border, background: cardBg }}>
        <div className="px-4 py-2.5 border-b" style={{ borderColor: border }}>
          <span className="text-[9px] font-bold tracking-[1.5px]"
            style={{ ...MONO, color: isDark ? "#94a3b8" : "#64748b" }}>PROFIT vs LOSS</span>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <DonutChart profit={profit} loss={loss} isDark={isDark} label={donutLabel} />
        </div>
        {donutFooter.length > 0 && <StatsRow cols={donutFooter} isDark={isDark} border={border} />}
      </div>

      {/* Bar */}
      <div className="flex-1 min-w-0 rounded-xl border flex flex-col overflow-hidden"
        style={{ borderColor: border, background: cardBg }}>
        <div className="px-4 py-2.5 border-b flex items-center justify-between" style={{ borderColor: border }}>
          <span className="text-[9px] font-bold tracking-[1.5px]"
            style={{ ...MONO, color: isDark ? "#94a3b8" : "#64748b" }}>
            {barHeader ?? "DATE-WISE P&L"}
          </span>
        </div>
        <div className="flex-1 p-3 overflow-x-auto flex items-center">
          <BarChart data={barData} isDark={isDark} />
        </div>
        {barFooter.length > 0 && <StatsRow cols={barFooter} isDark={isDark} border={border} />}
      </div>
    </div>
  );
}

// ─── Trades table helpers ────────────────────────────────────────────────────

type Row = Record<string, string>;

const STATUS_COLOR: Record<string, string> = {
  TARGET: "#22c55e", TIME_PROFIT: "#22c55e", SL: "#ef4444",
  TIME_EXIT: "#ef4444", EOD: "#94a3b8", ACTIVE: "#60a5fa",
};

function dirColor(d: string) { return d === "CE" ? "#0284c7" : "#e11d48"; }

function fmtTime(t: string) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const hr = h % 12 || 12;
  return `${String(hr).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function fmtFull(n: number) {
  const [int, dec] = Math.abs(n).toFixed(2).split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${dec}`;
}

function calcCharges(entry: number, exit: number, qty: number): number {
  const to  = (entry + exit) * qty;
  const br  = 40;
  const stt = exit * qty * 0.000625;
  const exc = to * 0.00053;
  const clr = to * 0.00003;
  const gst = (br + exc + clr) * 0.18;
  return br + stt + exc + clr + gst + to * 0.000001 + entry * qty * 0.00003;
}

// ─── Analytics helpers ────────────────────────────────────────────────────────

type CurvePoint  = { idx: number; label: string; cumLot: number; pnl: number };
type ConceptStat = { concept: string; trades: number; wins: number; losses: number; pnl: number };
type HourStat    = { hour: number; label: string; trades: number; wins: number; pnl: number };

function tradeIsWin(r: Row)  { const p = parseFloat(r.PnL) || 0; return r.Status === "TARGET" || r.Status === "TIME_PROFIT" || (r.Status === "TIME_EXIT" && p >= 0); }
function tradeIsLoss(r: Row) { const p = parseFloat(r.PnL) || 0; return r.Status === "SL"     || (r.Status === "TIME_EXIT" && p < 0); }

function computeEquityCurve(rows: Row[]): CurvePoint[] {
  const sorted = [...rows].sort((a, b) => {
    const dc = (a._date ?? "").localeCompare(b._date ?? "");
    return dc !== 0 ? dc : (a.EntryTime ?? "").localeCompare(b.EntryTime ?? "");
  });
  let cum = 0;
  return sorted.map((r, i) => {
    const pnl = (parseFloat(r.PnL) || 0) * LOT_QTY;
    cum += pnl;
    const dc = r._date ? fmtDateCell(r._date) : null;
    return { idx: i, label: dc ? dc.top : `#${i + 1}`, cumLot: cum, pnl };
  });
}

function computeConceptStats(rows: Row[]): ConceptStat[] {
  const map = new Map<string, ConceptStat>();
  for (const r of rows) {
    const pnl    = (parseFloat(r.PnL) || 0) * LOT_QTY;
    const isW    = tradeIsWin(r), isL = tradeIsLoss(r);
    const cs     = r.Concepts ? r.Concepts.split(",").map((c: string) => c.trim()).filter(Boolean) : ["—"];
    for (const c of cs) {
      if (!map.has(c)) map.set(c, { concept: c, trades: 0, wins: 0, losses: 0, pnl: 0 });
      const s = map.get(c)!; s.trades++; if (isW) s.wins++; if (isL) s.losses++; s.pnl += pnl;
    }
  }
  return [...map.values()].sort((a, b) => b.trades - a.trades);
}

function computeStreaks(rows: Row[]) {
  const res = [...rows]
    .sort((a, b) => { const dc = (a._date ?? "").localeCompare(b._date ?? ""); return dc !== 0 ? dc : (a.EntryTime ?? "").localeCompare(b.EntryTime ?? ""); })
    .filter(r => r.Status !== "ACTIVE")
    .map(r => (parseFloat(r.PnL) || 0) >= 0 ? "W" : "L");
  if (!res.length) return { current: 0, currentType: "N" as "W"|"L"|"N", bestWin: 0, bestLoss: 0 };
  let bestWin = 0, bestLoss = 0, cur = 1;
  for (let i = 1; i < res.length; i++) {
    if (res[i] === res[i - 1]) { cur++; }
    else { if (res[i - 1] === "W") bestWin = Math.max(bestWin, cur); else bestLoss = Math.max(bestLoss, cur); cur = 1; }
  }
  if (res[res.length - 1] === "W") bestWin = Math.max(bestWin, cur); else bestLoss = Math.max(bestLoss, cur);
  let current = 1; const lastType = res[res.length - 1] as "W"|"L";
  for (let i = res.length - 2; i >= 0; i--) { if (res[i] === lastType) current++; else break; }
  return { current, currentType: lastType, bestWin, bestLoss };
}

function computeTimeAnalysis(rows: Row[]): HourStat[] {
  const map = new Map<number, { trades: number; wins: number; pnl: number }>();
  for (const r of rows) {
    if (!r.EntryTime) continue;
    const hour = parseInt(r.EntryTime.split(":")[0], 10); if (isNaN(hour)) continue;
    const pnl  = (parseFloat(r.PnL) || 0) * LOT_QTY;
    if (!map.has(hour)) map.set(hour, { trades: 0, wins: 0, pnl: 0 });
    const s = map.get(hour)!; s.trades++; if (tradeIsWin(r)) s.wins++; s.pnl += pnl;
  }
  return [...map.entries()].sort(([a], [b]) => a - b).map(([hour, s]) => {
    const h = hour % 12 || 12, ampm = hour >= 12 ? "PM" : "AM";
    return { hour, label: `${h}${ampm}`, ...s };
  });
}

function exportToCSV(rows: Row[]) {
  const heads = ["Date","EntryTime","ExitTime","Direction","Strike","Entry","SL","T1","T2","Status","PnL(premium)","PnL(lot)","PnL%","Concepts","MaxPoints"];
  const lines = [heads.join(","), ...rows.map(r => {
    const pnl = parseFloat(r.PnL) || 0;
    return [r._date ?? "", r.EntryTime ?? "", r.ExitTime ?? "", r.Direction ?? "", r.Strike ?? "",
      r.Entry ?? "", r.SL ?? "", r.Target1 ?? "", r.Target2 ?? "", r.Status ?? "",
      pnl.toFixed(2), (pnl * LOT_QTY).toFixed(2), r.PnLPct ?? "",
      `"${(r.Concepts ?? "").replace(/"/g, '""')}"`, r.MaxPoints ?? ""].join(",");
  })];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url  = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = `smc_trades_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function exportToJSON(rows: Row[], stats: { wins: number; losses: number; lotPnL: number; wr: string | null }) {
  const payload = {
    exportDate: new Date().toISOString(),
    totalTrades: rows.length,
    stats,
    trades: rows.map(r => ({ ...r, lotPnL: (parseFloat(r.PnL) || 0) * LOT_QTY })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = `smc_snapshot_${new Date().toISOString().slice(0, 10)}.json`; a.click();
  URL.revokeObjectURL(url);
}

// ─── Risk Metrics ─────────────────────────────────────────────────────────────

type RiskMetrics = {
  profitFactor: number; sharpe: number; sortino: number;
  avgWin: number; avgLoss: number; expectancy: number;
  rMultiples: { bucket: string; count: number }[];
};

function computeRiskMetrics(rows: Row[]): RiskMetrics {
  const closed  = rows.filter(r => r.Status !== "ACTIVE");
  const returns = closed.map(r => (parseFloat(r.PnL) || 0) * LOT_QTY);
  const wins    = returns.filter(v => v > 0);
  const losses  = returns.filter(v => v < 0);
  const gProfit = wins.reduce((s, v) => s + v, 0);
  const gLoss   = losses.reduce((s, v) => s + v, 0);
  const profitFactor = Math.abs(gLoss) > 0 ? gProfit / Math.abs(gLoss) : gProfit > 0 ? 999 : 0;
  const mean = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
  const std  = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
  const avgRet  = mean(returns), stdAll = std(returns), stdDown = std(returns.filter(v => v < 0));
  const sharpe  = stdAll  > 0 ? (avgRet / stdAll)  * Math.sqrt(252) : 0;
  const sortino = stdDown > 0 ? (avgRet / stdDown) * Math.sqrt(252) : 0;
  const avgWin  = mean(wins), avgLoss = mean(losses);
  const wr      = closed.length > 0 ? wins.length / closed.length : 0;
  const expectancy = wr * avgWin + (1 - wr) * Math.abs(avgLoss);
  const oneR    = Math.abs(avgLoss) || 1;
  const BUCKETS = ["-3+","-2","-1","0","1","2","3","4","5+"];
  const cnt: Record<string, number> = {}; for (const b of BUCKETS) cnt[b] = 0;
  for (const v of returns) {
    const r = v / oneR;
    if      (r <= -2.5) cnt["-3+"]++;
    else if (r <= -1.5) cnt["-2"]++;
    else if (r <= -0.5) cnt["-1"]++;
    else if (r <=  0.5) cnt["0"]++;
    else if (r <=  1.5) cnt["1"]++;
    else if (r <=  2.5) cnt["2"]++;
    else if (r <=  3.5) cnt["3"]++;
    else if (r <=  4.5) cnt["4"]++;
    else                cnt["5+"]++;
  }
  return { profitFactor, sharpe, sortino, avgWin, avgLoss, expectancy, rMultiples: BUCKETS.map(b => ({ bucket: b, count: cnt[b] })) };
}

// ─── R-Multiple Chart ─────────────────────────────────────────────────────────

function RMultipleChart({ metrics, isDark }: { metrics: RiskMetrics; isDark: boolean }) {
  const muted = isDark ? "#64748b" : "#94a3b8";
  const { rMultiples } = metrics;
  const maxCount = Math.max(...rMultiples.map(b => b.count), 1);
  const BAR_W = 30, GAP = 6, PAD_L = 8, PAD_R = 8, PAD_TOP = 24, PAD_BOT = 28, SVG_H = 120;
  const BAR_MAX_H = SVG_H - PAD_TOP - PAD_BOT;
  const SVG_W = PAD_L + rMultiples.length * (BAR_W + GAP) - GAP + PAD_R;
  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} width={Math.max(SVG_W, 300)} height={SVG_H} style={{ display: "block" }}>
        {rMultiples.map((b, i) => {
          const x    = PAD_L + i * (BAR_W + GAP);
          const barH = b.count > 0 ? Math.max((b.count / maxCount) * BAR_MAX_H - 2, 3) : 0;
          const barY = PAD_TOP + BAR_MAX_H - barH;
          const isPos = b.bucket === "0" ? false : !b.bucket.startsWith("-");
          const clr   = b.bucket === "0" ? "#64748b" : isPos ? "#16a34a" : "#e11d48";
          return (
            <g key={b.bucket}>
              {b.count > 0 && <rect x={x} y={barY} width={BAR_W} height={barH} fill={clr} rx={3} opacity={0.85} />}
              {b.count > 0 && <text x={x + BAR_W / 2} y={barY - 4} textAnchor="middle" fontSize="8" fontWeight="bold" fontFamily="'Space Mono',monospace" fill={clr}>{b.count}</text>}
              <text x={x + BAR_W / 2} y={SVG_H - 8} textAnchor="middle" fontSize="8" fontFamily="'Space Mono',monospace" fill={muted}>{b.bucket}R</text>
            </g>
          );
        })}
        <line x1={PAD_L} y1={PAD_TOP + BAR_MAX_H} x2={SVG_W - PAD_R} y2={PAD_TOP + BAR_MAX_H} stroke={isDark ? "#2a3a4a" : "#cbd5e1"} strokeWidth="1" />
      </svg>
    </div>
  );
}

// ─── Risk Calculator ──────────────────────────────────────────────────────────

function RiskCalculator({ isDark, border, color, muted }: { isDark: boolean; border: string; color: string; muted: string }) {
  const [acct, setAcct]    = useState<number>(() => { try { return parseFloat(localStorage.getItem("smc_acct_size") ?? "0") || 0; } catch { return 0; } });
  const [riskPct, setRisk] = useState(1);
  const maxRisk   = acct > 0 ? acct * (riskPct / 100) : 0;
  const slPerLot  = 20 * LOT_QTY; // typical 20pt SL × lot qty
  const maxLots   = maxRisk > 0 ? Math.floor(maxRisk / slPerLot) : 0;
  const save = (v: number) => { setAcct(v); localStorage.setItem("smc_acct_size", String(v)); };
  const cardBg = isDark ? "#0d1420" : "#f8fafc";
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: border, background: cardBg }}>
      <div className="px-4 py-2 border-b" style={{ borderColor: border }}>
        <span className="text-[9px] font-bold tracking-[1.5px]" style={{ ...MONO, color: muted }}>POSITION SIZING CALCULATOR</span>
      </div>
      <div className="p-4 flex flex-wrap gap-4 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[7px] font-bold tracking-[1.5px]" style={{ ...MONO, color: muted }}>ACCOUNT SIZE (₹)</label>
          <input type="number" value={acct || ""} placeholder="e.g. 500000"
            onChange={e => save(parseFloat(e.target.value) || 0)}
            className="w-36 text-[9px] px-2 py-1.5 rounded-sm outline-none"
            style={{ ...MONO, background: isDark ? "#0f1923" : "#fff", border: `1px solid ${isDark ? "#2a3a4a" : "#cbd5e1"}`, color }} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[7px] font-bold tracking-[1.5px]" style={{ ...MONO, color: muted }}>RISK PER TRADE</label>
          <div className="flex gap-1">
            {[0.5, 1, 1.5, 2, 3].map(r => (
              <button key={r} onClick={() => setRisk(r)}
                className="px-2 py-1 text-[8px] font-bold rounded-sm cursor-pointer border"
                style={{ ...MONO, background: riskPct === r ? ACCENT : "transparent", borderColor: riskPct === r ? ACCENT : (isDark ? "#2a3a4a" : "#cbd5e1"), color: riskPct === r ? "#fff" : muted }}>
                {r}%
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1 ml-auto">
          <div className="text-[7px] font-bold tracking-[1.5px]" style={{ ...MONO, color: muted }}>MAX LOSS</div>
          <div className="text-[14px] font-bold" style={{ ...MONO, color: maxRisk > 0 ? "#e11d48" : muted }}>{maxRisk > 0 ? fmtIndianFull(-maxRisk) : "—"}</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-[7px] font-bold tracking-[1.5px]" style={{ ...MONO, color: muted }}>SAFE LOTS (20pt SL)</div>
          <div className="text-[22px] font-bold" style={{ ...BEBAS, color: maxLots > 0 ? "#16a34a" : muted }}>{maxLots > 0 ? `${maxLots} LOT${maxLots > 1 ? "S" : ""}` : "—"}</div>
        </div>
      </div>
      {acct > 0 && (
        <div className="px-4 pb-3 text-[7px] flex flex-wrap gap-3" style={{ ...MONO, color: muted }}>
          <span>{riskPct}% of ₹{(acct / 1000).toFixed(0)}K = {fmtIndianFull(-maxRisk)} max risk</span>
          <span>· Lot qty: {LOT_QTY}</span>
          <span>· 20pt SL = {fmtIndianFull(-slPerLot)}/lot</span>
        </div>
      )}
    </div>
  );
}

// ─── Equity Curve Chart ───────────────────────────────────────────────────────

function EquityCurveChart({ data, isDark }: { data: CurvePoint[]; isDark: boolean }) {
  const [hov, setHov] = useState<number | null>(null);
  const muted = isDark ? "#64748b" : "#94a3b8";
  if (!data.length) return <div style={{ height: 130, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ ...MONO, color: muted, fontSize: 10 }}>No data</span></div>;
  const PL = 8, PR = 20, PT = 24, PB = 24, W = 600, H = 160, gW = W - PL - PR, gH = H - PT - PB;
  const n = data.length, ys = data.map(d => d.cumLot);
  const minY = Math.min(0, ...ys), maxY = Math.max(0, ...ys), rng = maxY - minY || 1;
  const px = (i: number) => PL + (i / Math.max(n - 1, 1)) * gW;
  const py = (v: number) => PT + (1 - (v - minY) / rng) * gH;
  const zY  = py(0), pts = data.map((d, i) => `${px(i).toFixed(1)},${py(d.cumLot).toFixed(1)}`).join(" ");
  const last = data[n - 1], lineClr = (last?.cumLot ?? 0) >= 0 ? "#16a34a" : "#e11d48";
  const maxDD = (() => { let peak = -Infinity, dd = 0; for (const { cumLot: v } of data) { if (v > peak) peak = v; const d = peak - v; if (d > dd) dd = d; } return dd; })();
  const hovPt = hov !== null ? data[hov] : null;
  return (
    <div style={{ overflowX: "auto", width: "100%" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block", minWidth: 280 }} onMouseLeave={() => setHov(null)}>
        <line x1={PL} y1={zY.toFixed(1)} x2={W - PR} y2={zY.toFixed(1)} stroke={isDark ? "#2a3a4a" : "#cbd5e1"} strokeWidth="1" strokeDasharray="4,3" />
        <polygon points={`${PL},${zY} ${pts} ${px(n - 1)},${zY}`} fill={lineClr} opacity={0.07} />
        <polyline points={pts} fill="none" stroke={lineClr} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((_, i) => <rect key={i} x={px(i) - 8} y={PT} width={16} height={gH} fill="transparent" onMouseEnter={() => setHov(i)} />)}
        {hovPt && hov !== null && <>
          <line x1={px(hov).toFixed(1)} y1={PT} x2={px(hov).toFixed(1)} y2={PT + gH} stroke={lineClr} strokeWidth="1" strokeDasharray="2,2" opacity={0.5} />
          <circle cx={px(hov).toFixed(1)} cy={py(hovPt.cumLot).toFixed(1)} r={4} fill={lineClr} stroke={isDark ? "#080b0f" : "#fff"} strokeWidth="1.5" />
          {(() => {
            const tx = Math.min(Math.max(px(hov) - 62, 2), W - 126);
            const ty = py(hovPt.cumLot) < PT + 48 ? py(hovPt.cumLot) + 12 : py(hovPt.cumLot) - 48;
            return <g pointerEvents="none">
              <rect x={tx} y={ty} width={124} height={40} rx={5} fill={isDark ? "#0f1923" : "#fff"} stroke={lineClr} strokeWidth="1" style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,.22))" }} />
              <text x={tx + 62} y={ty + 14} textAnchor="middle" fontSize="9.5" fontWeight="bold" fontFamily="'Space Mono',monospace" fill={lineClr}>{fmtIndianFull(hovPt.cumLot)}</text>
              <text x={tx + 62} y={ty + 29} textAnchor="middle" fontSize="7" fontFamily="'Space Mono',monospace" fill={muted}>#{hov + 1} · {hovPt.label} · trade {fmtIndianFull(hovPt.pnl)}</text>
            </g>;
          })()}
        </>}
        <text x={PL} y={H - 5} fontSize="7" fontFamily="'Space Mono',monospace" fill={muted}>#1</text>
        <text x={W - PR} y={H - 5} textAnchor="end" fontSize="7" fontFamily="'Space Mono',monospace" fill={muted}>#{n}</text>
        <text x={W - PR} y={PT - 7} textAnchor="end" fontSize="8" fontWeight="bold" fontFamily="'Space Mono',monospace" fill={lineClr}>{fmtIndianFull(last?.cumLot ?? 0)}</text>
        {maxDD > 0 && <text x={PL} y={PT - 7} fontSize="7" fontFamily="'Space Mono',monospace" fill="#e11d48">DD {fmtIndianFull(-maxDD)}</text>}
      </svg>
    </div>
  );
}

// ─── Analytics Panel ──────────────────────────────────────────────────────────

function AnalyticsPanel({ rows, isDark, border, color, muted }: {
  rows: Row[]; isDark: boolean; border: string; color: string; muted: string;
}) {
  const cardBg   = isDark ? "#0d1420" : "#f8fafc";
  const curve    = useMemo(() => computeEquityCurve(rows), [rows]);
  const concepts = useMemo(() => computeConceptStats(rows), [rows]);
  const streaks  = useMemo(() => computeStreaks(rows), [rows]);
  const hours    = useMemo(() => computeTimeAnalysis(rows), [rows]);
  const rMetrics = useMemo(() => computeRiskMetrics(rows), [rows]);
  const dirStats = useMemo(() => (["CE", "PE"] as const).map(dir => {
    const dr = rows.filter(r => r.Direction === dir);
    const pnl = dr.reduce((s, r) => s + (parseFloat(r.PnL) || 0) * LOT_QTY, 0);
    const wins = dr.filter(tradeIsWin).length;
    return { dir, count: dr.length, pnl, wins, clr: dir === "CE" ? "#0284c7" : "#e11d48" };
  }), [rows]);
  const peak  = useMemo(() => Math.max(...curve.map(d => d.cumLot), 0), [curve]);
  const maxDD = useMemo(() => { let p = -Infinity, dd = 0; for (const { cumLot: v } of curve) { if (v > p) p = v; const d = p - v; if (d > dd) dd = d; } return dd; }, [curve]);

  if (!rows.length) return null;
  const H = (t: string, s?: string) => (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-[9px] font-bold tracking-[2px]" style={{ ...MONO, color: ACCENT }}>▶</span>
      <span className="text-[9px] font-bold tracking-[1.5px]" style={{ ...MONO, color: muted }}>{t}</span>
      {s && <span className="text-[8px]" style={{ ...MONO, color: muted }}>· {s}</span>}
    </div>
  );
  const tblHdr = (...cols: string[]) => (
    <tr style={{ background: isDark ? "#080d14" : "#f0f4f8", borderBottom: `2px solid ${border}` }}>
      {cols.map(c => <th key={c} className="px-3 py-2 text-left text-[7px] font-bold tracking-[1.5px]" style={{ ...MONO, color: muted }}>{c}</th>)}
    </tr>
  );

  return (
    <div className="flex flex-col gap-5 pt-2">

      {/* ── Equity Curve ── */}
      <div>
        {H("EQUITY CURVE", `${rows.length} trades · hover to inspect`)}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: border, background: cardBg }}>
          <div className="p-3 pb-1"><EquityCurveChart data={curve} isDark={isDark} /></div>
          <StatsRow isDark={isDark} border={border} cols={[
            { label: "PEAK P&L",      val: fmtIndianFull(peak),                                              color: "#16a34a"  },
            { label: "MAX DRAWDOWN",  val: maxDD > 0 ? fmtIndianFull(-maxDD) : "—",                         color: "#e11d48"  },
            { label: "FINAL P&L",     val: fmtIndianFull(curve[curve.length - 1]?.cumLot ?? 0),              color: pnlColor(curve[curve.length - 1]?.cumLot ?? 0) },
            { label: "RECOVERY RATE", val: peak > 0 && maxDD > 0 ? `${((peak / (peak + maxDD)) * 100).toFixed(0)}%` : "—", color: "#b45309" },
          ]} />
        </div>
      </div>

      {/* ── Risk Metrics ── */}
      <div>
        {H("RISK METRICS", "profit factor · sharpe · sortino · expectancy")}
        <StatsRow isDark={isDark} border={border} cols={[
          { label: "PROFIT FACTOR",  val: rMetrics.profitFactor >= 999 ? "∞" : rMetrics.profitFactor.toFixed(2), color: rMetrics.profitFactor >= 1.5 ? "#16a34a" : "#e11d48" },
          { label: "SHARPE RATIO",   val: rMetrics.sharpe.toFixed(2),  color: rMetrics.sharpe >= 1 ? "#16a34a" : rMetrics.sharpe >= 0 ? "#d97706" : "#e11d48" },
          { label: "SORTINO RATIO",  val: rMetrics.sortino.toFixed(2), color: rMetrics.sortino >= 1.5 ? "#16a34a" : rMetrics.sortino >= 0 ? "#d97706" : "#e11d48" },
          { label: "EXPECTANCY",     val: fmtIndianFull(rMetrics.expectancy), color: pnlColor(rMetrics.expectancy) },
          { label: "AVG WIN",        val: rMetrics.avgWin  > 0 ? fmtIndianFull(rMetrics.avgWin)  : "—", color: "#16a34a" },
          { label: "AVG LOSS",       val: rMetrics.avgLoss < 0 ? fmtIndianFull(rMetrics.avgLoss) : "—", color: "#e11d48" },
        ]} />
      </div>

      {/* ── Streaks + CE/PE ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Streaks */}
        <div>
          {H("STREAK TRACKER")}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: border, background: cardBg }}>
            <div className="grid grid-cols-2" style={{ gap: "1px", background: border }}>
              {[
                { label: "CURRENT STREAK", val: streaks.currentType === "N" ? "—" : `${streaks.current} ${streaks.currentType}`, color: streaks.currentType === "W" ? "#16a34a" : streaks.currentType === "L" ? "#e11d48" : muted, sub: streaks.currentType === "W" ? "🔥 on fire" : streaks.currentType === "L" ? "❄️ cold" : "no trades" },
                { label: "BEST WIN RUN",   val: `${streaks.bestWin}W`,  color: "#16a34a", sub: "consecutive wins"   },
                { label: "WORST LOSS RUN", val: `${streaks.bestLoss}L`, color: "#e11d48", sub: "consecutive losses" },
                { label: "CLOSED TRADES",  val: `${rows.filter(r => r.Status !== "ACTIVE").length}`, color: isDark ? "#94a3b8" : "#475569", sub: "excl. active" },
              ].map(({ label, val, color: c, sub }) => (
                <div key={label} className="px-3 py-2.5" style={{ background: isDark ? "#0a0f16" : "#fff" }}>
                  <div className="text-[7px] tracking-[1.5px] mb-1 uppercase" style={{ ...MONO, color: muted }}>{label}</div>
                  <div className="text-[18px] font-bold leading-tight" style={{ ...BEBAS, color: c }}>{val}</div>
                  <div className="text-[7px] mt-0.5" style={{ ...MONO, color: muted }}>{sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CE vs PE */}
        <div>
          {H("CE vs PE SPLIT")}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: border, background: cardBg }}>
            <div className="grid grid-cols-2" style={{ gap: "1px", background: border }}>
              {dirStats.map(({ dir, count, pnl, wins, clr }) => (
                <div key={dir} className="px-3 py-3 flex flex-col gap-1" style={{ background: isDark ? "#0a0f16" : "#fff" }}>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-sm inline-flex w-fit mb-1"
                    style={{ ...MONO, background: `${clr}18`, color: clr, border: `1px solid ${clr}30` }}>{dir}</span>
                  <div className="text-[16px] font-bold" style={{ ...BEBAS, color: pnlColor(pnl) }}>{fmtIndianFull(pnl)}</div>
                  <div className="text-[8px]" style={{ ...MONO, color: muted }}>{count} trades · {wins}W / {count - wins}L</div>
                  <div className="text-[9px] font-bold" style={{ ...MONO, color: count > 0 && wins / count >= 0.7 ? "#16a34a" : "#e11d48" }}>
                    {count > 0 ? `${((wins / count) * 100).toFixed(0)}% WR` : "—"}
                  </div>
                </div>
              ))}
            </div>
            <StatsRow isDark={isDark} border={border} cols={[
              { label: "BEST DIRECTION", val: (() => { const [a, b] = dirStats; if (!a.count && !b.count) return "—"; if (!a.count) return b.dir; if (!b.count) return a.dir; return a.pnl >= b.pnl ? a.dir : b.dir; })(), color: (() => { const [a, b] = dirStats; return a.pnl >= b.pnl ? a.clr : b.clr; })() },
              { label: "CE TRADES",  val: `${dirStats[0].count}`, color: "#0284c7"  },
              { label: "PE TRADES",  val: `${dirStats[1].count}`, color: "#e11d48"  },
              { label: "CE:PE RATIO", val: dirStats[1].count > 0 ? `${(dirStats[0].count / dirStats[1].count).toFixed(1)}:1` : "—", color: isDark ? "#94a3b8" : "#475569" },
            ]} />
          </div>
        </div>
      </div>

      {/* ── Concept Performance ── */}
      <div>
        {H("CONCEPT PERFORMANCE", `${concepts.length} concepts`)}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: border, background: cardBg }}>
          <div className="overflow-x-auto">
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
              <thead>{tblHdr("CONCEPT", "TRADES", "WIN", "LOSS", "WIN %", "AVG P&L", "NET LOT P&L")}</thead>
              <tbody>
                {concepts.map((cs, i) => {
                  const wr = cs.trades > 0 ? (cs.wins / cs.trades) * 100 : 0;
                  const avg = cs.trades > 0 ? cs.pnl / cs.trades : 0;
                  return (
                    <tr key={cs.concept} style={{ background: i % 2 === 0 ? (isDark ? "#0a0f16" : "#fff") : (isDark ? "#0d1420" : "#fafafa"), borderBottom: `1px solid ${isDark ? "#0f1923" : "#f1f5f9"}` }}>
                      <td className="px-3 py-2"><span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm" style={{ ...MONO, background: `${ACCENT}15`, color: ACCENT }}>{cs.concept}</span></td>
                      <td className="px-3 py-2 text-[10px] font-bold" style={{ ...MONO, color }}>{cs.trades}</td>
                      <td className="px-3 py-2 text-[10px] font-bold" style={{ ...MONO, color: "#16a34a" }}>{cs.wins}</td>
                      <td className="px-3 py-2 text-[10px] font-bold" style={{ ...MONO, color: "#e11d48" }}>{cs.losses}</td>
                      <td className="px-3 py-2 text-[10px] font-bold" style={{ ...MONO, color: wr >= 70 ? "#16a34a" : "#e11d48" }}>{wr.toFixed(0)}%</td>
                      <td className="px-3 py-2 text-[9px] font-bold" style={{ ...MONO, color: pnlColor(avg) }}>{fmtIndianFull(avg)}</td>
                      <td className="px-3 py-2 text-[10px] font-bold" style={{ ...MONO, color: pnlColor(cs.pnl) }}>{fmtIndianFull(cs.pnl)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── R-Multiple Distribution ── */}
      <div>
        {H("R-MULTIPLE DISTRIBUTION", "1R = avg loss · positive = profit multiples")}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: border, background: cardBg }}>
          <div className="p-3 pb-1"><RMultipleChart metrics={rMetrics} isDark={isDark} /></div>
          <StatsRow isDark={isDark} border={border} cols={[
            { label: "AVG R (WINS)",  val: rMetrics.avgWin  > 0 && rMetrics.avgLoss < 0 ? `${(rMetrics.avgWin / Math.abs(rMetrics.avgLoss)).toFixed(1)}R` : "—", color: "#16a34a" },
            { label: "RISK:REWARD",   val: rMetrics.avgWin  > 0 && rMetrics.avgLoss < 0 ? `1 : ${(rMetrics.avgWin / Math.abs(rMetrics.avgLoss)).toFixed(1)}` : "—", color: "#0284c7" },
            { label: "EXPECTANCY/R",  val: rMetrics.avgLoss < 0 ? `${(rMetrics.expectancy / Math.abs(rMetrics.avgLoss)).toFixed(2)}R` : "—", color: pnlColor(rMetrics.expectancy) },
          ]} />
        </div>
      </div>

      {/* ── Time Analysis ── */}
      <div>
        {H("ENTRY TIME ANALYSIS", "best hours to trade")}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: border, background: cardBg }}>
          <div className="overflow-x-auto">
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 400 }}>
              <thead>{tblHdr("ENTRY", "TRADES", "WIN", "LOSS", "WIN %", "NET LOT P&L")}</thead>
              <tbody>
                {hours.map((ts, i) => {
                  const wr    = ts.trades > 0 ? (ts.wins / ts.trades) * 100 : 0;
                  const maxAb = Math.max(...hours.map(h => Math.abs(h.pnl)), 1);
                  const barW  = (Math.abs(ts.pnl) / maxAb) * 100;
                  return (
                    <tr key={ts.hour} style={{ background: i % 2 === 0 ? (isDark ? "#0a0f16" : "#fff") : (isDark ? "#0d1420" : "#fafafa"), borderBottom: `1px solid ${isDark ? "#0f1923" : "#f1f5f9"}` }}>
                      <td className="px-3 py-2 text-[10px] font-bold" style={{ ...MONO, color }}>{ts.label}</td>
                      <td className="px-3 py-2 text-[10px] font-bold" style={{ ...MONO, color }}>{ts.trades}</td>
                      <td className="px-3 py-2 text-[10px] font-bold" style={{ ...MONO, color: "#16a34a" }}>{ts.wins}</td>
                      <td className="px-3 py-2 text-[10px] font-bold" style={{ ...MONO, color: "#e11d48" }}>{ts.trades - ts.wins}</td>
                      <td className="px-3 py-2 text-[10px] font-bold" style={{ ...MONO, color: wr >= 70 ? "#16a34a" : "#e11d48" }}>{wr.toFixed(0)}%</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-2 rounded-full overflow-hidden flex-1" style={{ background: isDark ? "#1e2a3a" : "#e2e8f0", minWidth: 60 }}>
                            <div style={{ width: `${barW}%`, height: "100%", background: pnlColor(ts.pnl), borderRadius: 9999 }} />
                          </div>
                          <span className="text-[9px] font-bold whitespace-nowrap" style={{ ...MONO, color: pnlColor(ts.pnl) }}>{fmtIndianFull(ts.pnl)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Position Sizing Calculator ── */}
      <div>
        {H("RISK CALCULATOR", "position sizing based on account size")}
        <RiskCalculator isDark={isDark} border={border} color={color} muted={muted} />
      </div>

    </div>
  );
}

type DirFilter    = "ALL" | "CE" | "PE";
type ResultFilter = "ALL" | "T1" | "T2" | "PROFIT" | "LOSS";
type MaxPtsFilter = "ALL" | "5" | "10" | "15" | "20" | "25" | "30";
const MAX_PTS_OPTIONS: MaxPtsFilter[] = ["ALL", "5", "10", "15", "20", "25", "30"];

const COL_DEFS = [
  { key: "date",     label: "DATE",    w: "70px"  },
  { key: "time",     label: "TIME",    w: "120px" },
  { key: "concepts", label: "CONCEPTS",w: "1fr"   },
  { key: "strike",   label: "STRIKE",  w: "78px"  },
  { key: "entry",    label: "ENTRY",   w: "60px"  },
  { key: "sl",       label: "SL",      w: "58px"  },
  { key: "t1",       label: "T1",      w: "68px"  },
  { key: "t2",       label: "T2",      w: "68px"  },
  { key: "result",   label: "RESULT",  w: "128px" },
  { key: "maxpts",   label: "MAX PTS", w: "72px"  },
  { key: "charges",  label: "CHARGES", w: "76px"  },
  { key: "pnl",      label: "P&L",     w: "128px" },
] as const;
type ColKey = typeof COL_DEFS[number]["key"];

function fmtDateCell(d: string) {
  const [y, m, day] = d.split("-");
  return { top: `${parseInt(day)} ${MONTH_SHORT[parseInt(m) - 1]}`, bot: y };
}

function JournalTradesSection({ isDark, border, color, muted }: {
  isDark: boolean; border: string; color: string; muted: string;
}) {
  const [tradeDates, setTradeDates] = useState<string[]>([]);
  const [allRows,    setAllRows]    = useState<Row[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [progress,   setProgress]   = useState({ done: 0, total: 0 });
  const [monthFilter, setMonthF]   = useState("ALL");
  const [dirFilter,   setDirF]     = useState<DirFilter>("ALL");
  const [resFilter,   setResF]     = useState<ResultFilter>("ALL");
  const [page,        setPage]     = useState(1);
  const [openDrop,    setOpenDrop] = useState<"month"|"type"|"result"|"maxpts"|"cols"|null>(null);
  const [maxPtsFilter, setMaxPtsF] = useState<MaxPtsFilter>("ALL");
  const [visCols,     setVisCols]  = useState<Set<ColKey>>(new Set(COL_DEFS.map(c => c.key)));
  const [pageSize,    setPageSz]   = useState(10);
  const [showAnalytics, setShowAnalytics] = useState(false);
  // SSR-safe: init empty, read localStorage after mount to avoid hydration mismatch
  const [notes, setNotes]           = useState<Record<string, string>>({});
  const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    try { setNotes(JSON.parse(localStorage.getItem("smc_trade_notes")   ?? "{}")); } catch {}
    try { setPinnedKeys(new Set(JSON.parse(localStorage.getItem("smc_pinned_trades") ?? "[]"))); } catch {}
  }, []);
  const [editingNote, setEditingNote]   = useState<string | null>(null);
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);

  const noteKey = (r: Row) => `${r._date ?? ""}_${r.EntryTime ?? ""}_${r.Strike ?? ""}_${r.Direction ?? ""}`;
  const saveNote = (key: string, val: string) => {
    const next = { ...notes, [key]: val };
    setNotes(next);
    localStorage.setItem("smc_trade_notes", JSON.stringify(next));
  };
  const togglePin = (key: string) => {
    setPinnedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem("smc_pinned_trades", JSON.stringify([...next]));
      return next;
    });
  };
  const filterRef = useRef<HTMLDivElement>(null);

  const dynTCOLS = "30px " + COL_DEFS.filter(c => visCols.has(c.key)).map(c => c.w).join(" ");

  const cardBg  = isDark ? "#0d1420" : "#f8fafc";
  const rowEven = isDark ? "#0a0f16" : "#fff";
  const rowOdd  = isDark ? "#0d1420" : "#fafafa";

  // ── Fetch ALL live dates, then load ALL their trades in parallel ──────────────
  useEffect(() => {
    setLoading(true);
    fetch(`${API}/api/results`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        const live = (d.live ?? []) as string[];
        setTradeDates(live);
        if (!live.length) { setLoading(false); return; }
        setProgress({ done: 0, total: live.length });
        let done = 0;
        Promise.all(
          live.map(date =>
            fetch(`${API}/api/results?type=live&date=${date}`, { cache: "no-store" })
              .then(r => r.json())
              .then(data => ({ date, rows: (data.rows ?? []) as Row[] }))
              .catch(() => ({ date, rows: [] as Row[] }))
              .finally(() => setProgress(p => ({ ...p, done: ++done })))
          )
        ).then(results => {
          const combined: Row[] = [];
          for (const { date, rows } of results)
            for (const row of rows) combined.push({ ...row, _date: date });
          // sort newest date first, then by entry time within day
          combined.sort((a, b) => {
            const dc = b._date.localeCompare(a._date);
            return dc !== 0 ? dc : (a.EntryTime ?? "").localeCompare(b.EntryTime ?? "");
          });
          setAllRows(combined);
        }).finally(() => setLoading(false));
      })
      .catch(() => setLoading(false));
  }, []);

  const months = useMemo(() => {
    const ms = [...new Set(tradeDates.map(d => d.slice(0, 7)))].sort().reverse();
    return ["ALL", ...ms];
  }, [tradeDates]);

  const filtered = useMemo(() => allRows.filter(r => {
    if (showPinnedOnly && !pinnedKeys.has(noteKey(r)))                        return false;
    if (monthFilter !== "ALL" && !r._date?.startsWith(monthFilter))          return false;
    if (dirFilter !== "ALL" && r.Direction !== dirFilter)                     return false;
    if (resFilter === "T1"     && r.T1Hit !== "Y")                            return false;
    if (resFilter === "T2"     && r.Status !== "TARGET")                      return false;
    if (resFilter === "PROFIT" && (parseFloat(r.PnL) || 0) < 0)              return false;
    if (resFilter === "LOSS"   && (parseFloat(r.PnL) || 0) >= 0)             return false;
    if (maxPtsFilter !== "ALL" && (parseFloat(r.MaxPoints) || 0) < parseFloat(maxPtsFilter)) return false;
    return true;
  }), [allRows, monthFilter, dirFilter, resFilter, maxPtsFilter]);

  const wins    = filtered.filter(r => r.Status === "TARGET" || r.Status === "TIME_PROFIT" || (r.Status === "TIME_EXIT" && (parseFloat(r.PnL) || 0) >= 0)).length;
  const losses  = filtered.filter(r => r.Status === "SL" || (r.Status === "TIME_EXIT" && (parseFloat(r.PnL) || 0) < 0)).length;
  const eod     = filtered.filter(r => r.Status === "EOD").length;
  const closed  = wins + losses;
  const wr      = closed > 0 ? ((wins / closed) * 100).toFixed(1) : null;
  const totPnL  = filtered.reduce((s, r) => s + (parseFloat(r.PnL) || 0), 0);
  const lotPnL  = totPnL * LOT_QTY;
  const wrClr   = wr && Number(wr) >= 70 ? "#16a34a" : "#e11d48";

  const totCharges = useMemo(() =>
    filtered.reduce((s, r) => {
      const e = parseFloat(r.Entry) || 0;
      const p = parseFloat(r.PnL)   || 0;
      return s + calcCharges(e, e + p, LOT_QTY);
    }, 0),
  [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows   = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [monthFilter, dirFilter, resFilter, maxPtsFilter, pageSize]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[9px] font-bold tracking-[2px]" style={{ ...MONO, color: ACCENT }}>▶ LIVE</span>
        <span className="text-[9px] font-bold tracking-[1.5px]" style={{ ...MONO, color: muted }}>
          ALL TRADES {!loading && allRows.length > 0 && `· ${allRows.length} total`}
        </span>
      </div>

      {/* ── Toolbar: per-filter funnel dropdowns ── */}
      {(() => {
        const monthActive  = monthFilter   !== "ALL";
        const typeActive   = dirFilter     !== "ALL";
        const resActive    = resFilter     !== "ALL";
        const maxPtsActive = maxPtsFilter  !== "ALL";
        const colsActive   = visCols.size  < COL_DEFS.length;
        const anyActive    = monthActive || typeActive || resActive || maxPtsActive || colsActive;

        const mkBtn = (id: typeof openDrop, label: string, active: boolean) => (
          <button
            onClick={() => setOpenDrop(prev => prev === id ? null : id)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border cursor-pointer transition-colors"
            style={{
              ...MONO,
              background: openDrop === id ? `${ACCENT}15` : (isDark ? "#0f1923" : "#f1f5f9"),
              borderColor: active ? ACCENT : border,
              color: active ? ACCENT : muted,
            }}>
            <IconAdjustmentsHorizontal size={12} color={active ? ACCENT : muted} />
            <span className="text-[7px] font-bold">{label}{active ? " ●" : ""}</span>
          </button>
        );

        const dropBase: React.CSSProperties = {
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 50,
          minWidth: 220, background: isDark ? "#0d1420" : "#fff",
          border: `1px solid ${border}`, borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.24)", padding: 12,
        };

        return (
          <div ref={filterRef} className="flex flex-wrap items-center gap-2 mb-2">

            {/* ── MONTH ── */}
            <div className="relative">
              {mkBtn("month", monthActive ? `MONTH: ${monthFilter}` : "MONTH", monthActive)}
              {openDrop === "month" && (
                <div style={dropBase}>
                  <div className="text-[7px] font-bold tracking-[1.5px] mb-2" style={{ ...MONO, color: muted }}>SELECT MONTH</div>
                  <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                    {months.map(m => (
                      <button key={m} onClick={() => { setMonthF(m); setOpenDrop(null); }}
                        className="text-left px-2 py-1.5 rounded-sm text-[8px] font-bold cursor-pointer transition-colors"
                        style={{ ...MONO, background: monthFilter === m ? `${ACCENT}18` : "transparent", color: monthFilter === m ? ACCENT : color, borderLeft: monthFilter === m ? `2px solid ${ACCENT}` : "2px solid transparent" }}>
                        {m === "ALL" ? "All months" : m}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── OPTION TYPE ── */}
            <div className="relative">
              {mkBtn("type", typeActive ? `TYPE: ${dirFilter}` : "TYPE", typeActive)}
              {openDrop === "type" && (
                <div style={dropBase}>
                  <div className="text-[7px] font-bold tracking-[1.5px] mb-2" style={{ ...MONO, color: muted }}>OPTION TYPE</div>
                  <div className="flex rounded-sm overflow-hidden border" style={{ borderColor: border }}>
                    {(["ALL", "CE", "PE"] as DirFilter[]).map(f => (
                      <button key={f} onClick={() => { setDirF(f); setOpenDrop(null); }}
                        className="flex-1 py-1.5 text-[8px] font-bold cursor-pointer transition-colors"
                        style={{
                          ...MONO,
                          background: dirFilter === f ? (f === "CE" ? "#0284c7" : f === "PE" ? "#e11d48" : ACCENT) : "transparent",
                          color: dirFilter === f ? "#fff" : muted,
                        }}>{f === "ALL" ? "All" : f}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── RESULT ── */}
            <div className="relative">
              {mkBtn("result", resActive ? `RESULT: ${resFilter === "T1" ? "T1 HIT" : resFilter === "T2" ? "T2 HIT" : resFilter}` : "RESULT", resActive)}
              {openDrop === "result" && (
                <div style={dropBase}>
                  <div className="text-[7px] font-bold tracking-[1.5px] mb-2" style={{ ...MONO, color: muted }}>RESULT FILTER</div>
                  <div className="flex flex-wrap gap-1">
                    {(["ALL", "T1", "T2", "PROFIT", "LOSS"] as ResultFilter[]).map(f => {
                      const fc = f === "PROFIT" ? "#16a34a" : f === "LOSS" ? "#e11d48" : f === "T1" ? "#d97706" : f === "T2" ? "#15803d" : ACCENT;
                      const active = resFilter === f;
                      return (
                        <button key={f} onClick={() => { setResF(f); setOpenDrop(null); }}
                          className="px-2.5 py-1 text-[8px] font-bold rounded-sm cursor-pointer border transition-colors"
                          style={{ ...MONO, background: active ? `${fc}18` : "transparent", borderColor: active ? fc : border, color: active ? fc : muted }}>
                          {f === "T1" ? "T1 HIT" : f === "T2" ? "T2 HIT" : f}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── MAX POINTS ── */}
            <div className="relative">
              {mkBtn("maxpts", maxPtsActive ? `MAX PTS ≥${maxPtsFilter}` : "MAX PTS", maxPtsActive)}
              {openDrop === "maxpts" && (
                <div style={dropBase}>
                  <div className="text-[7px] font-bold tracking-[1.5px] mb-2" style={{ ...MONO, color: muted }}>MIN MAX POINTS</div>
                  <div className="flex flex-wrap gap-1">
                    {MAX_PTS_OPTIONS.map(f => {
                      const active = maxPtsFilter === f;
                      return (
                        <button key={f} onClick={() => { setMaxPtsF(f); setOpenDrop(null); }}
                          className="px-2.5 py-1 text-[8px] font-bold rounded-sm cursor-pointer border transition-colors"
                          style={{ ...MONO, background: active ? `${ACCENT}18` : "transparent", borderColor: active ? ACCENT : border, color: active ? ACCENT : muted }}>
                          {f === "ALL" ? "All" : `≥ ${f}`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── COLUMNS ── */}
            <div className="relative">
              {mkBtn("cols", colsActive ? `COLS (${visCols.size}/${COL_DEFS.length})` : "COLUMNS", colsActive)}
              {openDrop === "cols" && (
                <div style={{ ...dropBase, minWidth: 260 }}>
                  <div className="text-[7px] font-bold tracking-[1.5px] mb-2" style={{ ...MONO, color: muted }}>VISIBLE COLUMNS</div>
                  <div className="flex flex-wrap gap-1">
                    {COL_DEFS.map(col => {
                      const vis = visCols.has(col.key);
                      return (
                        <button key={col.key}
                          onClick={() => setVisCols(prev => {
                            const next = new Set(prev);
                            if (vis && next.size > 1) next.delete(col.key); else next.add(col.key);
                            return next;
                          })}
                          className="px-2 py-1 text-[7px] font-bold rounded-sm cursor-pointer border transition-colors"
                          style={{ ...MONO, background: vis ? `${ACCENT}18` : "transparent", borderColor: vis ? ACCENT : border, color: vis ? ACCENT : muted }}>
                          {vis ? "✓ " : ""}{col.label}
                        </button>
                      );
                    })}
                  </div>
                  {colsActive && (
                    <button onClick={() => setVisCols(new Set(COL_DEFS.map(c => c.key)))}
                      className="mt-2 w-full text-[7px] font-bold py-1 rounded-sm border cursor-pointer"
                      style={{ ...MONO, borderColor: ACCENT, color: ACCENT, background: `${ACCENT}10` }}>
                      Show all columns
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ── ROWS PER PAGE ── */}
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border"
              style={{ background: isDark ? "#0f1923" : "#f1f5f9", borderColor: border }}>
              <span className="text-[7px] font-bold" style={{ ...MONO, color: muted }}>ROWS</span>
              <div className="flex gap-0.5">
                {[5, 10, 15, 20].map(n => (
                  <button key={n} onClick={() => { setPageSz(n); setPage(1); }}
                    className="w-6 h-5 text-[7px] font-bold rounded-sm cursor-pointer transition-colors"
                    style={{ ...MONO, background: pageSize === n ? ACCENT : "transparent", color: pageSize === n ? "#fff" : muted }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Clear all ── */}
            {anyActive && (
              <button onClick={() => { setMonthF("ALL"); setDirF("ALL"); setResF("ALL"); setMaxPtsF("ALL"); setVisCols(new Set(COL_DEFS.map(c => c.key))); setOpenDrop(null); }}
                className="text-[7px] font-bold px-2 py-1.5 rounded-lg border cursor-pointer"
                style={{ ...MONO, borderColor: "#e11d48", color: "#e11d48", background: isDark ? "#2d0505" : "#fff5f5" }}>
                ✕ Clear all
              </button>
            )}

            {/* ── Pinned filter ── */}
            {pinnedKeys.size > 0 && (
              <button
                onClick={() => setShowPinnedOnly(v => !v)}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg border cursor-pointer transition-colors flex-shrink-0"
                style={{ ...MONO, background: showPinnedOnly ? "#d97706" + "18" : (isDark ? "#0f1923" : "#f1f5f9"), borderColor: showPinnedOnly ? "#d97706" : border, color: showPinnedOnly ? "#d97706" : muted }}>
                <span className="text-[10px]">📌</span>
                <span className="text-[7px] font-bold">PINNED ({pinnedKeys.size})</span>
              </button>
            )}

            {/* ── Analytics + Export ── */}
            <button
              onClick={() => setShowAnalytics(v => !v)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg border cursor-pointer transition-colors flex-shrink-0"
              style={{ ...MONO, background: showAnalytics ? `${ACCENT}18` : (isDark ? "#0f1923" : "#f1f5f9"), borderColor: showAnalytics ? ACCENT : border, color: showAnalytics ? ACCENT : muted }}>
              <span className="text-[10px]">📊</span>
              <span className="text-[7px] font-bold">{showAnalytics ? "HIDE ANALYTICS" : "ANALYTICS"}</span>
            </button>
            {!loading && allRows.length > 0 && (
              <button
                onClick={() => exportToCSV(filtered)}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg border cursor-pointer transition-colors flex-shrink-0"
                style={{ ...MONO, background: isDark ? "#0f1923" : "#f1f5f9", borderColor: border, color: muted }}>
                <span className="text-[10px]">⬇</span>
                <span className="text-[7px] font-bold">CSV</span>
              </button>
            )}
            {!loading && allRows.length > 0 && (
              <button
                onClick={() => exportToJSON(filtered, { wins, losses, lotPnL, wr })}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg border cursor-pointer transition-colors flex-shrink-0"
                style={{ ...MONO, background: isDark ? "#0f1923" : "#f1f5f9", borderColor: border, color: muted }}>
                <span className="text-[10px]">📋</span>
                <span className="text-[7px] font-bold">JSON</span>
              </button>
            )}

            {/* Summary */}
            {wr !== null && (
              <div className="ml-auto flex items-center gap-3 flex-shrink-0">
                <span className="text-[8px] font-bold px-2 py-1 rounded-sm border"
                  style={{
                    ...MONO,
                    background: isDark ? (Number(wr) >= 70 ? "#052e16" : "#2d0505") : (Number(wr) >= 70 ? "#f0fdf4" : "#fff5f5"),
                    borderColor: Number(wr) >= 70 ? "#166534" : "#991b1b",
                    color: wrClr,
                  }}>
                  {wr}% · <span style={{ color: "#16a34a" }}>{wins}W</span> / <span style={{ color: "#e11d48" }}>{losses}L</span>{eod > 0 ? ` · ${eod}E` : ""}
                </span>
                <span className="text-[15px] font-bold" style={{ ...BEBAS, color: pnlColor(lotPnL) }}>
                  {fmtIndianFull(lotPnL)}
                </span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Loading with progress */}
      {loading && (
        <div className="py-10 flex flex-col items-center gap-2">
          <div className="text-[10px]" style={{ ...MONO, color: muted }}>
            Loading trades… {progress.total > 0 ? `${progress.done} / ${progress.total} dates` : ""}
          </div>
          {progress.total > 0 && (
            <div className="w-48 h-1 rounded-full overflow-hidden" style={{ background: isDark ? "#1e2a3a" : "#e2e8f0" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${(progress.done / progress.total) * 100}%`, background: ACCENT }} />
            </div>
          )}
        </div>
      )}

      {/* Empty */}
      {!loading && allRows.length === 0 && (
        <div className="py-10 text-center text-[10px]" style={{ ...MONO, color: muted }}>No live trades found</div>
      )}
      {!loading && allRows.length > 0 && filtered.length === 0 && (
        <div className="py-8 text-center text-[10px]" style={{ ...MONO, color: muted }}>
          No trades match the selected filters
        </div>
      )}

      {/* ── Mobile cards ── */}
      {!loading && filtered.length > 0 && (
        <div className="md:hidden space-y-3">
          {filtered.map((r, i) => {
            const pnl    = parseFloat(r.PnL) || 0;
            const lPnl   = pnl * LOT_QTY;
            const dc     = dirColor(r.Direction);
            const isTimedExit = r.Status === "TIME_EXIT";
            const isWin  = r.Status === "TARGET" || r.Status === "TIME_PROFIT" || (isTimedExit && pnl >= 0);
            const isLoss = r.Status === "SL" || (isTimedExit && pnl < 0);
            const isEod  = r.Status === "EOD";
            const sc     = isTimedExit ? (pnl >= 0 ? "#22c55e" : "#ef4444") : STATUS_COLOR[r.Status] ?? "#94a3b8";
            const t1Hit  = r.T1Hit === "Y";
            const t2Hit  = r.Status === "TARGET";
            const stIcon = r.Status === "TARGET" ? "🎯" : r.Status === "SL" ? "🛑" : r.Status === "EOD" ? "🕐" : r.Status === "TIME_PROFIT" || isTimedExit ? "⏱" : "⏳";
            const stLbl  = r.Status === "TIME_PROFIT" ? "60M PROFIT" : isTimedExit ? "75M EXIT" : r.Status;
            const dateLbl = r._date ? (() => { const dc2 = fmtDateCell(r._date); return `${dc2.top} ${dc2.bot}`; })() : "";
            return (
              <div key={i} className="rounded-xl overflow-hidden"
                style={{ background: cardBg, border: `1px solid ${isWin ? "#22c55e33" : isLoss ? "#ef444433" : border}`, borderLeft: `3px solid ${isWin ? "#22c55e" : isLoss ? "#e11d48" : dc}` }}>
                <div className="px-3 py-3 flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-xl flex flex-col items-center justify-center flex-shrink-0"
                      style={{ background: `${dc}18`, border: `1.5px solid ${dc}40` }}>
                      <span className="text-[7px] font-bold" style={{ ...MONO, color: muted }}>NI</span>
                      <span className="text-[12px] font-bold" style={{ ...BEBAS, color: dc }}>{r.Direction}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-bold" style={{ ...BEBAS, color }}>NIFTY {r.Strike} {r.Direction === "CE" ? "Call" : "Put"}</div>
                      <div className="text-[8px] mt-0.5" style={{ ...MONO, color: muted }}>{fmtTime(r.EntryTime)}{r.ExitTime ? ` → ${fmtTime(r.ExitTime)}` : " → ACTIVE"}</div>
                      <div className="text-[8px] font-bold mt-0.5" style={{ ...MONO, color: ACCENT }}>{dateLbl}</div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    {/* WIN / LOSS badge */}
                    <span className="text-[7px] font-bold px-2 py-0.5 rounded-sm"
                      style={{
                        ...MONO,
                        background: isWin ? (isDark ? "#052e16" : "#dcfce7") : isLoss ? (isDark ? "#2d0505" : "#fee2e2") : (isDark ? "#1c1500" : "#fef9c3"),
                        color: isWin ? "#16a34a" : isLoss ? "#e11d48" : "#b45309",
                        border: `1px solid ${isWin ? "#16a34a55" : isLoss ? "#e11d4855" : "#b4530955"}`,
                      }}>
                      {isWin ? "● WIN" : isLoss ? "● LOSS" : isEod ? "● EOD" : "● OPEN"}
                    </span>
                    <span className="text-[8px] font-bold px-2 py-0.5 rounded-full"
                      style={{ ...MONO, background: `${sc}18`, color: sc, border: `1px solid ${sc}40` }}>
                      {stIcon} {stLbl}
                    </span>
                    <div className="flex gap-1">
                      {([["T1", t1Hit, "#d97706"], ["T2", t2Hit, "#15803d"]] as [string, boolean, string][]).map(([lbl, hit, clr]) => (
                        <span key={lbl} className="text-[7px] px-1.5 py-0.5 rounded-sm font-bold"
                          style={{ ...MONO, background: hit ? (isDark ? "#052e16" : "#dcfce7") : (isDark ? "#0f1923" : "#f1f5f9"), color: hit ? clr : muted }}>
                          {lbl}{hit ? "✓" : "✗"}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="px-3 py-1.5 flex items-center gap-3 border-t"
                  style={{ background: isDark ? "#080b0f" : "#fff", borderColor: border }}>
                  <span className="text-[9px] font-bold" style={{ ...MONO, color: "#d97706" }}>T1 ₹{r.Target1 ?? "—"}{t1Hit ? " ✓" : ""}</span>
                  <span className="text-[9px] font-bold" style={{ ...MONO, color: "#16a34a" }}>T2 ₹{r.Target2 ?? "—"}{t2Hit ? " ✓" : ""}</span>
                  {r.MaxPoints && parseFloat(r.MaxPoints) > 0 && <span className="text-[9px] font-bold" style={{ ...MONO, color: ACCENT }}>MAX +{r.MaxPoints}</span>}
                </div>
                <div className="grid grid-cols-3 border-t" style={{ gap: "1px", background: border }}>
                  {[
                    { label: "ENTRY",   val: `₹${r.Entry}`, color: dc },
                    { label: "SL",      val: `₹${r.SL}`,    color: "#e11d48" },
                    { label: "LOT P&L", val: fmtIndianFull(lPnl), color: pnlColor(lPnl) },
                  ].map(({ label, val, color: c }) => (
                    <div key={label} className="px-3 py-2" style={{ background: cardBg }}>
                      <div className="text-[7px] mb-0.5" style={{ ...MONO, color: muted }}>{label}</div>
                      <div className="text-[11px] font-bold tabular-nums" style={{ ...MONO, color: c }}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Desktop table ── */}
      {!loading && filtered.length > 0 && (
        <div className="hidden md:block rounded-xl border overflow-hidden" style={{ borderColor: border }}>

          {/* Scrollable area with sticky header */}
          <div className="overflow-auto" style={{ maxHeight: 540 }}>
            <div style={{ minWidth: 960 }}>

              {/* ── Sticky header ── */}
              <div className="grid border-b-2 sticky top-0 z-10"
                style={{ gridTemplateColumns: dynTCOLS, borderColor: isDark ? "#1e2a3a" : "#cbd5e1", background: isDark ? "#080d14" : "#f0f4f8" }}>
                <div className="px-2 py-2 text-[8px] font-bold tracking-[1.5px]" style={{ ...MONO, color: muted }}>#</div>
                {COL_DEFS.filter(c => visCols.has(c.key)).map(col => (
                  <div key={col.key} className="px-2 py-2 text-[8px] font-bold tracking-[1.5px] whitespace-nowrap"
                    style={{ ...MONO, color: muted }}>
                    {col.key === "pnl" ? `P&L (${LOT_QTY}×)` : col.label}
                  </div>
                ))}
              </div>

              {/* ── Rows (current page only) ── */}
              {pageRows.map((r, i) => {
                const absIdx = (page - 1) * pageSize + i + 1;
                const pnl    = parseFloat(r.PnL) || 0;
                const lPnl   = pnl * LOT_QTY;
                const pnlPct = parseFloat(r.PnLPct) || 0;
                const isTimedExit2 = r.Status === "TIME_EXIT";
                const isWin  = r.Status === "TARGET" || r.Status === "TIME_PROFIT" || (isTimedExit2 && pnl >= 0);
                const isLoss = r.Status === "SL" || (isTimedExit2 && pnl < 0);
                const isEod  = r.Status === "EOD";
                const dc     = dirColor(r.Direction);
                const stClr  = isWin ? "#16a34a" : isLoss ? "#e11d48" : isEod ? "#b45309" : "#0284c7";
                const t1Hit  = r.T1Hit === "Y";
                const t2Hit  = r.Status === "TARGET";
                const entry  = parseFloat(r.Entry) || 0;
                const chg    = calcCharges(entry, entry + pnl, LOT_QTY);
                const rowBg  = i % 2 === 0 ? rowEven : rowOdd;
                const dc2    = r._date ? fmtDateCell(r._date) : null;

                return (
                  <div key={i} className="grid border-b items-center"
                    style={{ gridTemplateColumns: dynTCOLS, background: rowBg, borderColor: isDark ? "#0f1923" : "#f1f5f9", minHeight: 36 }}>

                    {/* # always visible */}
                    <div className="px-2 text-[9px] tabular-nums flex items-center gap-1" style={{ ...MONO, color: muted }}>
                      {absIdx}
                      {(() => {
                        const nk = noteKey(r);
                        const hasNote = !!notes[nk];
                        const isPinned = pinnedKeys.has(nk);
                        return (
                          <>
                            <button
                              title={hasNote ? notes[nk] : "Add note"}
                              onClick={() => setEditingNote(editingNote === nk ? null : nk)}
                              style={{ fontSize: 10, opacity: hasNote ? 1 : 0.35, cursor: "pointer", background: "none", border: "none", padding: 0, lineHeight: 1 }}>
                              {hasNote ? "📝" : "✎"}
                            </button>
                            <button
                              title={isPinned ? "Unpin trade" : "Pin trade"}
                              onClick={() => togglePin(nk)}
                              style={{ fontSize: 9, opacity: isPinned ? 1 : 0.25, cursor: "pointer", background: "none", border: "none", padding: 0, lineHeight: 1, color: "#d97706" }}>
                              📌
                            </button>
                          </>
                        );
                      })()}
                    </div>
                    {editingNote === noteKey(r) && (
                      <div style={{ gridColumn: `1 / -1`, padding: "4px 8px 6px", background: isDark ? "#0a0f16" : "#f8fafc" }}>
                        <textarea
                          autoFocus
                          rows={2}
                          value={notes[noteKey(r)] ?? ""}
                          onChange={e => saveNote(noteKey(r), e.target.value)}
                          placeholder="Add trade note…"
                          className="w-full text-[9px] rounded px-2 py-1 outline-none resize-none"
                          style={{ ...MONO, background: isDark ? "#0d1420" : "#fff", border: `1px solid ${ACCENT}50`, color, fontFamily: "'Space Mono',monospace" }}
                        />
                      </div>
                    )}

                    {/* DATE */}
                    {visCols.has("date") && (
                      <div className="px-2 text-[9px] font-bold whitespace-nowrap" style={{ ...MONO, color }}>
                        {dc2 ? `${dc2.top} '${dc2.bot.slice(2)}` : "—"}
                      </div>
                    )}

                    {/* TIME */}
                    {visCols.has("time") && (
                      <div className="px-2 text-[9px] whitespace-nowrap" style={{ ...MONO, color }}>
                        <span className="font-bold">{fmtTime(r.EntryTime)}</span>
                        <span style={{ color: muted }}> → {fmtTime(r.ExitTime)}</span>
                      </div>
                    )}

                    {/* CONCEPTS */}
                    {visCols.has("concepts") && (
                      <div className="px-2 flex items-center gap-1 overflow-hidden">
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm flex-shrink-0"
                          style={{ ...MONO, background: `${dc}18`, color: dc, border: `1px solid ${dc}30` }}>{r.Direction}</span>
                        {r.Concepts && r.Concepts.split(",").slice(0, 2).map((c: string) => (
                          <span key={c} className="text-[7px] px-1 py-0.5 rounded-sm font-bold truncate flex-shrink-0"
                            style={{ ...MONO, background: isDark ? "#1e2a3a" : "#f1f5f9", color: muted }}>{c.trim()}</span>
                        ))}
                      </div>
                    )}

                    {/* STRIKE – "23500 CE" */}
                    {visCols.has("strike") && (
                      <div className="px-2 text-[9px] font-bold whitespace-nowrap tabular-nums" style={{ ...MONO, color: dc }}>
                        {r.Strike} {r.Direction}
                      </div>
                    )}

                    {/* ENTRY */}
                    {visCols.has("entry") && (
                      <div className="px-2 text-[10px] font-bold tabular-nums" style={{ ...MONO, color: dc }}>
                        ₹{r.Entry}
                      </div>
                    )}

                    {/* SL */}
                    {visCols.has("sl") && (
                      <div className="px-2 text-[10px] font-bold tabular-nums" style={{ ...MONO, color: "#e11d48" }}>
                        ₹{r.SL}
                      </div>
                    )}

                    {/* T1 */}
                    {visCols.has("t1") && (
                      <div className="px-2 flex items-center gap-1">
                        <span className="text-[10px] font-bold tabular-nums" style={{ ...MONO, color: "#d97706" }}>₹{r.Target1}</span>
                        <span className="text-[7px] font-bold px-1 py-0.5 rounded-sm flex-shrink-0"
                          style={{ ...MONO, background: t1Hit ? (isDark ? "#052e16" : "#dcfce7") : (isDark ? "#0f1923" : "#f1f5f9"), color: t1Hit ? "#15803d" : muted }}>
                          {t1Hit ? "✓" : "✗"}
                        </span>
                      </div>
                    )}

                    {/* T2 */}
                    {visCols.has("t2") && (
                      <div className="px-2 flex items-center gap-1">
                        <span className="text-[10px] font-bold tabular-nums" style={{ ...MONO, color: "#16a34a" }}>₹{r.Target2}</span>
                        <span className="text-[7px] font-bold px-1 py-0.5 rounded-sm flex-shrink-0"
                          style={{ ...MONO, background: t2Hit ? (isDark ? "#052e16" : "#dcfce7") : (isDark ? "#0f1923" : "#f1f5f9"), color: t2Hit ? "#15803d" : muted }}>
                          {t2Hit ? "✓" : "✗"}
                        </span>
                      </div>
                    )}

                    {/* RESULT */}
                    {visCols.has("result") && (
                      <div className="px-2 flex items-center gap-1 overflow-hidden">
                        <span className="text-[7px] font-bold px-1.5 py-0.5 rounded-sm flex-shrink-0"
                          style={{
                            ...MONO,
                            background: isWin ? (isDark ? "#052e16" : "#dcfce7") : isLoss ? (isDark ? "#2d0505" : "#fee2e2") : (isDark ? "#1c1500" : "#fef9c3"),
                            color: isWin ? "#16a34a" : isLoss ? "#e11d48" : "#b45309",
                            border: `1px solid ${isWin ? "#16a34a44" : isLoss ? "#e11d4844" : "#b4530944"}`,
                          }}>
                          {isWin ? "WIN" : isLoss ? "LOSS" : isEod ? "EOD" : "OPEN"}
                        </span>
                        <span className="text-[9px] flex-shrink-0">{r.Status === "TARGET" ? "🎯" : r.Status === "SL" ? "🛑" : isEod ? "🕐" : r.Status === "TIME_PROFIT" || r.Status === "TIME_EXIT" ? "⏱" : "⏳"}</span>
                        <span className="text-[8px] font-bold truncate" style={{ ...MONO, color: stClr }}>
                          {r.Status === "TIME_PROFIT" ? "60M PROFIT" : r.Status === "TIME_EXIT" ? "75M EXIT" : r.Status}
                        </span>
                      </div>
                    )}

                    {/* MAX PTS */}
                    {visCols.has("maxpts") && (
                      <div className="px-2 text-[10px] font-bold tabular-nums whitespace-nowrap" style={{ ...MONO, color: ACCENT }}>
                        {r.MaxPoints && parseFloat(r.MaxPoints) > 0 ? `+${r.MaxPoints}` : "—"}
                      </div>
                    )}

                    {/* CHARGES – Indian format */}
                    {visCols.has("charges") && (
                      <div className="px-2 text-[10px] font-bold tabular-nums whitespace-nowrap" style={{ ...MONO, color: "#b45309" }}>
                        {fmtIndianFull(-chg)}
                      </div>
                    )}

                    {/* P&L – Indian format (last column) */}
                    {visCols.has("pnl") && (
                      <div className="px-2 flex items-baseline gap-1 overflow-hidden">
                        <span className="text-[10px] font-bold tabular-nums whitespace-nowrap" style={{ ...MONO, color: pnlColor(lPnl) }}>
                          {fmtIndianFull(lPnl)}
                        </span>
                        <span className="text-[8px] tabular-nums" style={{ ...MONO, color: pnlColor(lPnl) }}>
                          {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%
                        </span>
                      </div>
                    )}

                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Pagination bar ── */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t"
            style={{ borderColor: border, background: isDark ? "#080b0f" : "#fff" }}>
            <span className="text-[8px]" style={{ ...MONO, color: muted }}>
              {filtered.length === 0 ? "0 trades" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filtered.length)} of ${filtered.length} trades`}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(1)} disabled={page === 1}
                className="w-6 h-6 flex items-center justify-center rounded text-[10px] font-bold cursor-pointer disabled:opacity-30"
                style={{ ...MONO, background: isDark ? "#0f1923" : "#f1f5f9", color }}>«</button>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="w-6 h-6 flex items-center justify-center rounded text-[11px] font-bold cursor-pointer disabled:opacity-30"
                style={{ ...MONO, background: isDark ? "#0f1923" : "#f1f5f9", color }}>‹</button>
              {/* Page number pills */}
              {Array.from({ length: totalPages }, (_, idx) => idx + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                .reduce<(number | "…")[]>((acc, p, i, arr) => {
                  if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push("…");
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) => p === "…"
                  ? <span key={`e${i}`} className="text-[9px] px-1" style={{ ...MONO, color: muted }}>…</span>
                  : <button key={p} onClick={() => setPage(p as number)}
                      className="w-6 h-6 flex items-center justify-center rounded text-[9px] font-bold cursor-pointer"
                      style={{ ...MONO, background: page === p ? ACCENT : (isDark ? "#0f1923" : "#f1f5f9"), color: page === p ? "#fff" : color }}>
                      {p}
                    </button>
                )}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="w-6 h-6 flex items-center justify-center rounded text-[11px] font-bold cursor-pointer disabled:opacity-30"
                style={{ ...MONO, background: isDark ? "#0f1923" : "#f1f5f9", color }}>›</button>
              <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
                className="w-6 h-6 flex items-center justify-center rounded text-[10px] font-bold cursor-pointer disabled:opacity-30"
                style={{ ...MONO, background: isDark ? "#0f1923" : "#f1f5f9", color }}>»</button>
            </div>
            <span className="text-[8px]" style={{ ...MONO, color: muted }}>
              Page {page} / {totalPages}
            </span>
          </div>

          {/* ── Footer summary stats ── */}
          <div className="border-t" style={{ borderColor: border }}>
            <div className="grid grid-cols-4 sm:grid-cols-7" style={{ gap: "1px", background: border }}>
              {[
                { label: "TRADES",           val: `${filtered.length}`,         color: isDark ? "#94a3b8" : "#475569" },
                { label: "WIN / TARGET",      val: `${wins}`,                    color: "#16a34a" },
                { label: "LOSS / SL",         val: `${losses}`,                  color: "#e11d48" },
                { label: "EOD",               val: `${eod}`,                     color: "#b45309" },
                { label: "WIN RATE",          val: wr ? `${wr}%` : "—",          color: wrClr },
                { label: `LOT P&L (${LOT_QTY}×)`, val: fmtIndianFull(lotPnL), color: pnlColor(lotPnL) },
                { label: "TOTAL CHARGES",     val: fmtIndianFull(-totCharges),   color: "#b45309" },
              ].map(({ label, val, color: c }) => (
                <div key={label} className="px-3 py-2.5" style={{ background: isDark ? "#0a0f16" : "#fff" }}>
                  <div className="text-[7px] tracking-[1.5px] mb-1" style={{ ...MONO, color: muted }}>{label}</div>
                  <div className="text-[13px] font-bold leading-tight" style={{ ...MONO, color: c }}>{val}</div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ── Analytics Panel ── */}
      {showAnalytics && allRows.length > 0 && (
        <AnalyticsPanel rows={filtered.length > 0 ? filtered : allRows} isDark={isDark} border={border} color={color} muted={muted} />
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function TradingJournalContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [viewType, setViewType] = useState<ViewType>("month");
  const [summary, setSummary]   = useState<DaySummary[]>([]);
  const [summaryMap, setSummaryMap] = useState<Record<string, DaySummary>>({});
  const [calMonth, setCalMonth] = useState(() => {
    const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() + 1 };
  });
  const [calYear, setCalYear]   = useState(() => new Date().getFullYear());

  const bg     = isDark ? "#080b0f" : "#fff";
  const color  = isDark ? "#e2e8f0" : "#1e293b";
  const border = isDark ? "#1e2a3a" : "#e2e8f0";
  const muted  = isDark ? "#4a6080" : "#94a3b8";

  useEffect(() => {
    fetch(`${API}/api/results/summary?type=live`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        const arr: DaySummary[] = d.summary ?? [];
        setSummary(arr);
        const m: Record<string, DaySummary> = {};
        for (const s of arr) m[s.date] = s;
        setSummaryMap(m);
      })
      .catch(() => {});
  }, []);

  // ── MONTH view data ────────────────────────────────────────────────────────
  const monthSummary = useMemo(() => {
    const prefix = `${calMonth.year}-${String(calMonth.month).padStart(2, "0")}`;
    return summary.filter(s => s.date.startsWith(prefix)).sort((a, b) => a.date.localeCompare(b.date));
  }, [summary, calMonth]);

  const monthStats = useMemo(() => {
    const totalPnL = monthSummary.reduce((s, d) => s + d.totalPnL * LOT_QTY, 0);
    const trades   = monthSummary.reduce((s, d) => s + d.trades, 0);
    const wins     = monthSummary.reduce((s, d) => s + d.wins, 0);
    const profit   = monthSummary.filter(d => d.totalPnL >= 0).reduce((s, d) => s + d.totalPnL * LOT_QTY, 0);
    const loss     = monthSummary.filter(d => d.totalPnL < 0).reduce((s, d) => s + d.totalPnL * LOT_QTY, 0);
    return { totalPnL, trades, wins, profit, loss, days: monthSummary.length };
  }, [monthSummary]);

  const monthBarData: BarEntry[] = useMemo(() => monthSummary.map(d => {
    const day = parseInt(d.date.slice(8), 10);
    const mon = MONTH_SHORT[parseInt(d.date.slice(5, 7), 10) - 1];
    const yr  = d.date.slice(0, 4);
    return { key: d.date, label: `${day} ${mon}`, lot: d.totalPnL * LOT_QTY, trades: d.trades, wins: d.wins, tipLine2: `${day} ${mon} ${yr}` };
  }), [monthSummary]);

  // ── YEAR view data ─────────────────────────────────────────────────────────
  const yearMonthGrid = useMemo(() =>
    Array.from({ length: 12 }, (_, idx) => {
      const prefix = `${calYear}-${String(idx + 1).padStart(2, "0")}`;
      const days   = summary.filter(s => s.date.startsWith(prefix));
      const lot    = days.reduce((s, d) => s + d.totalPnL * LOT_QTY, 0);
      const trades = days.reduce((s, d) => s + d.trades, 0);
      const wins   = days.reduce((s, d) => s + d.wins, 0);
      return { monthIdx: idx, lot, trades, wins, hasData: trades > 0 };
    }), [summary, calYear]);

  const yearBarData: BarEntry[] = useMemo(() =>
    yearMonthGrid
      .filter(d => d.hasData)
      .map(d => ({
        key: `${calYear}-${d.monthIdx}`,
        label: MONTH_SHORT[d.monthIdx],
        lot: d.lot,
        trades: d.trades,
        wins: d.wins,
        tipLine2: `${MONTH_NAMES[d.monthIdx]} ${calYear}`,
      })), [yearMonthGrid, calYear]);

  const yearStats = useMemo(() => {
    const active = yearMonthGrid.filter(d => d.hasData);
    const totalPnL = active.reduce((s, d) => s + d.lot, 0);
    const trades   = active.reduce((s, d) => s + d.trades, 0);
    const wins     = active.reduce((s, d) => s + d.wins, 0);
    const profit   = active.filter(d => d.lot >= 0).reduce((s, d) => s + d.lot, 0);
    const loss     = active.filter(d => d.lot < 0).reduce((s, d) => s + d.lot, 0);
    return { totalPnL, trades, wins, profit, loss, months: active.length };
  }, [yearMonthGrid]);

  // ── OVERALL view data ──────────────────────────────────────────────────────
  const overallYearData: BarEntry[] = useMemo(() => {
    const years = [...new Set(summary.map(s => s.date.slice(0, 4)))].sort();
    return years.map(yr => {
      const days   = summary.filter(s => s.date.startsWith(yr));
      const lot    = days.reduce((s, d) => s + d.totalPnL * LOT_QTY, 0);
      const trades = days.reduce((s, d) => s + d.trades, 0);
      const wins   = days.reduce((s, d) => s + d.wins, 0);
      return { key: yr, label: yr, lot, trades, wins, tipLine2: yr };
    });
  }, [summary]);

  const overallStats = useMemo(() => {
    const totalPnL = overallYearData.reduce((s, d) => s + d.lot, 0);
    const trades   = overallYearData.reduce((s, d) => s + d.trades, 0);
    const wins     = overallYearData.reduce((s, d) => s + d.wins, 0);
    const profit   = overallYearData.filter(d => d.lot >= 0).reduce((s, d) => s + d.lot, 0);
    const loss     = overallYearData.filter(d => d.lot < 0).reduce((s, d) => s + d.lot, 0);
    return { totalPnL, trades, wins, profit, loss };
  }, [overallYearData]);

  // ── helpers ────────────────────────────────────────────────────────────────
  const winRateFmt = (wins: number, trades: number) =>
    trades > 0 ? `${((wins / trades) * 100).toFixed(0)}%` : "—";
  const winRateColor = (wins: number, trades: number) =>
    trades > 0 && wins / trades >= 0.7 ? "#16a34a" : "#e11d48";

  return (
    <div className="h-full overflow-auto" style={{ background: bg, color }}>
      <div className="px-3 sm:px-5 pb-8 flex flex-col gap-5">

        {/* ── View type selector ── */}
        <div className="flex items-center gap-2 pt-4">
          {(["month", "year", "overall"] as ViewType[]).map(v => (
            <button key={v} onClick={() => setViewType(v)}
              className="px-3 py-1.5 text-[9px] font-bold tracking-[1.5px] rounded-sm border cursor-pointer transition-colors uppercase"
              style={{
                ...MONO,
                background: viewType === v ? ACCENT : (isDark ? "#0f1923" : "#f8fafc"),
                borderColor: viewType === v ? ACCENT : (isDark ? "#2a3a4a" : "#cbd5e1"),
                color: viewType === v ? "#fff" : (isDark ? "#4a6080" : "#64748b"),
              }}>
              {v === "overall" ? "ALL TIME" : v}
            </button>
          ))}

          {/* Inline navigation */}
          <div className="ml-auto flex items-center gap-2">
            {viewType === "month" && <>
              <button onClick={() => setCalMonth(m => { const d = new Date(m.year, m.month - 2, 1); return { year: d.getFullYear(), month: d.getMonth() + 1 }; })}
                className="w-7 h-7 flex items-center justify-center rounded cursor-pointer font-bold"
                style={{ background: isDark ? "#0f1923" : "#f1f5f9", color }}>‹</button>
              <span className="text-[11px] font-bold tracking-[1.5px]"
                style={{ ...MONO, color, minWidth: 120, textAlign: "center" }}>
                {MONTH_SHORT[calMonth.month - 1]} {calMonth.year}
              </span>
              <button onClick={() => setCalMonth(m => { const d = new Date(m.year, m.month, 1); return { year: d.getFullYear(), month: d.getMonth() + 1 }; })}
                className="w-7 h-7 flex items-center justify-center rounded cursor-pointer font-bold"
                style={{ background: isDark ? "#0f1923" : "#f1f5f9", color }}>›</button>
            </>}
            {viewType === "year" && <>
              <button onClick={() => setCalYear(y => y - 1)}
                className="w-7 h-7 flex items-center justify-center rounded cursor-pointer font-bold"
                style={{ background: isDark ? "#0f1923" : "#f1f5f9", color }}>‹</button>
              <span className="text-[11px] font-bold tracking-[1.5px]"
                style={{ ...MONO, color, minWidth: 60, textAlign: "center" }}>{calYear}</span>
              <button onClick={() => setCalYear(y => y + 1)}
                className="w-7 h-7 flex items-center justify-center rounded cursor-pointer font-bold"
                style={{ background: isDark ? "#0f1923" : "#f1f5f9", color }}>›</button>
            </>}
            {viewType === "overall" && (
              <span className="text-[9px] font-bold tracking-[2px] px-2 py-1 rounded-sm"
                style={{ ...MONO, color: ACCENT, background: `${ACCENT}18`, border: `1px solid ${ACCENT}40` }}>
                ▶ LIVE · ALL TIME
              </span>
            )}
          </div>
        </div>

        {/* ══ MONTH VIEW ══ */}
        {viewType === "month" && <>
          {/* Charts */}
          <ChartsPanel
            profit={monthStats.profit} loss={monthStats.loss}
            barData={monthBarData}
            isDark={isDark} border={border}
            donutFooter={monthStats.days > 0 ? [
              { label: "PROFIT DAYS", val: `${monthSummary.filter(d => d.totalPnL >= 0).length}`, color: "#16a34a" },
              { label: "LOSS DAYS",   val: `${monthSummary.filter(d => d.totalPnL < 0).length}`,  color: "#e11d48" },
            ] : []}
            barFooter={monthStats.days > 0 ? [
              { label: "TRADE DAYS",   val: `${monthStats.days}`,  color: isDark ? "#94a3b8" : "#475569" },
              { label: "WIN RATE",     val: winRateFmt(monthStats.wins, monthStats.trades), color: winRateColor(monthStats.wins, monthStats.trades) },
              { label: "NET P&L",      val: fmtIndianFull(monthStats.totalPnL), color: pnlColor(monthStats.totalPnL) },
            ] : []}
          />

          {/* Calendar */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[9px] font-bold tracking-[2px]" style={{ ...MONO, color: ACCENT }}>▶ LIVE</span>
              <span className="text-[9px] font-bold tracking-[1.5px]" style={{ ...MONO, color: muted }}>CALENDAR</span>
            </div>
            <div className="rounded-lg border overflow-hidden" style={{ borderColor: border }}>
              <div className="grid grid-cols-7 gap-px p-1" style={{ background: isDark ? "#1a2332" : "#e2e8f0" }}>
                {DAY_NAMES.map(d => (
                  <div key={d} className="text-center text-[8px] md:text-[11px] font-bold tracking-[1.5px] py-1.5"
                    style={{ ...MONO, color: isDark ? "#94a3b8" : "#475569", background: isDark ? "#1a2332" : "#e2e8f0" }}>{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1 p-1" style={{ background: isDark ? "#080b0f" : "#fff" }}>
                {buildCalendar(calMonth.year, calMonth.month).map((day, i) => {
                  if (!day) return <div key={i} className="min-h-[56px] sm:min-h-[72px]" />;
                  const dateStr   = `${calMonth.year}-${String(calMonth.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const data      = summaryMap[dateStr];
                  const lotPnl    = data ? data.totalPnL * LOT_QTY : null;
                  const hasData   = !!data;
                  const isToday   = dateStr === new Date().toISOString().slice(0, 10);
                  const holiday   = MARKET_HOLIDAYS_MAP[dateStr];
                  const isHoliday = !!holiday && !hasData;
                  const cellBg = hasData ? (lotPnl! >= 0 ? "rgba(22,163,74,0.10)" : "rgba(225,29,72,0.10)")
                    : isHoliday ? "rgba(251,191,36,0.35)" : "rgba(100,116,139,0.07)";
                  const cellBc = isToday ? ACCENT
                    : hasData ? (lotPnl! >= 0 ? "rgba(22,163,74,0.6)" : "rgba(225,29,72,0.6)")
                    : isHoliday ? "rgba(251,191,36,0.6)" : "rgba(100,116,139,0.2)";
                  return (
                    <div key={i} className="rounded-lg p-1.5 sm:p-2 min-h-[56px] sm:min-h-[72px] flex flex-col"
                      style={{ background: cellBg, border: `${isToday ? "2px" : "1px"} solid ${cellBc}` }}>
                      <span className="text-[10px] md:text-[12px] font-bold"
                        style={{ ...MONO, color: isToday ? ACCENT : (isDark ? "#cbd5e1" : "#334155") }}>{day}</span>
                      {isHoliday && <span className="text-[9px] font-bold leading-tight mt-0.5 break-words" style={{ ...MONO, color: "#b45309" }}>{holiday}</span>}
                      {hasData && lotPnl !== null && <>
                        <span className="text-[8px] md:text-[9px] font-bold mt-auto leading-tight break-all"
                          style={{ ...MONO, color: lotPnl >= 0 ? "#16a34a" : "#e11d48" }}>{fmtIndianFull(lotPnl)}</span>
                        <span className="text-[7px] font-bold mt-0.5 flex gap-1 flex-wrap" style={MONO}>
                          <span style={{ color: isDark ? "#94a3b8" : "#475569" }}>{data.trades}T</span>
                          <span style={{ color: "#16a34a" }}>{data.wins}W</span>
                          <span style={{ color: "#e11d48" }}>{data.trades - data.wins}L</span>
                        </span>
                      </>}
                    </div>
                  );
                })}
              </div>
            </div>
            {monthStats.days > 0 ? (
              <div className="mt-3 rounded-xl overflow-hidden border" style={{ borderColor: border, background: isDark ? "#0d1420" : "#f8fafc" }}>
                <StatsRow isDark={isDark} border={border} cols={[
                  { label: "TRADE DAYS", val: `${monthStats.days}`,  color: isDark ? "#94a3b8" : "#475569" },
                  { label: "WIN / LOSS", val: `${monthStats.wins}W · ${monthStats.trades - monthStats.wins}L`, color: winRateColor(monthStats.wins, monthStats.trades) },
                  { label: "WIN RATE",   val: winRateFmt(monthStats.wins, monthStats.trades), color: winRateColor(monthStats.wins, monthStats.trades) },
                  { label: "MONTH P&L",  val: fmtIndianFull(monthStats.totalPnL), color: pnlColor(monthStats.totalPnL) },
                ]} />
              </div>
            ) : (
              <div className="mt-4 text-center text-[10px]" style={{ ...MONO, color: muted }}>
                No live data for {MONTH_NAMES[calMonth.month - 1]} {calMonth.year}
              </div>
            )}
          </div>
        </>}

        {/* ══ YEAR VIEW ══ */}
        {viewType === "year" && <>
          {/* Charts */}
          <ChartsPanel
            profit={yearStats.profit} loss={yearStats.loss}
            barData={yearBarData}
            barHeader="MONTH-WISE P&L"
            isDark={isDark} border={border}
            donutFooter={yearStats.months > 0 ? [
              { label: "PROFIT MONTHS", val: `${yearMonthGrid.filter(d => d.hasData && d.lot >= 0).length}`, color: "#16a34a" },
              { label: "LOSS MONTHS",   val: `${yearMonthGrid.filter(d => d.hasData && d.lot < 0).length}`,  color: "#e11d48" },
            ] : []}
            barFooter={yearStats.months > 0 ? [
              { label: "ACTIVE MONTHS", val: `${yearStats.months}`, color: isDark ? "#94a3b8" : "#475569" },
              { label: "WIN RATE",      val: winRateFmt(yearStats.wins, yearStats.trades), color: winRateColor(yearStats.wins, yearStats.trades) },
              { label: "YEAR P&L",      val: fmtIndianFull(yearStats.totalPnL), color: pnlColor(yearStats.totalPnL) },
            ] : []}
          />

          {/* Month grid */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[9px] font-bold tracking-[2px]" style={{ ...MONO, color: ACCENT }}>▶ LIVE</span>
              <span className="text-[9px] font-bold tracking-[1.5px]" style={{ ...MONO, color: muted }}>MONTHLY BREAKDOWN · {calYear}</span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {yearMonthGrid.map(({ monthIdx, lot, trades, wins, hasData }) => {
                const cellBg = hasData ? (lot >= 0 ? "rgba(22,163,74,0.10)" : "rgba(225,29,72,0.10)") : "rgba(100,116,139,0.07)";
                const cellBc = hasData ? (lot >= 0 ? "rgba(22,163,74,0.5)" : "rgba(225,29,72,0.5)") : "rgba(100,116,139,0.2)";
                return (
                  <div key={monthIdx} className="rounded-lg p-3 flex flex-col gap-0.5"
                    style={{ background: cellBg, border: `1px solid ${cellBc}` }}>
                    <span className="text-[13px] font-bold" style={{ ...BEBAS, color: isDark ? "#cbd5e1" : "#334155" }}>
                      {MONTH_NAMES[monthIdx]}
                    </span>
                    {hasData ? <>
                      <span className="text-[9px] font-bold leading-tight break-all"
                        style={{ ...MONO, color: lot >= 0 ? "#16a34a" : "#e11d48" }}>{fmtIndianFull(lot)}</span>
                      <span className="text-[7px] font-bold mt-0.5 flex gap-1 flex-wrap" style={MONO}>
                        <span style={{ color: isDark ? "#94a3b8" : "#475569" }}>{trades}T</span>
                        <span style={{ color: "#16a34a" }}>{wins}W</span>
                        <span style={{ color: "#e11d48" }}>{trades - wins}L</span>
                        <span style={{ color: winRateColor(wins, trades) }}>{((wins / trades) * 100).toFixed(0)}%</span>
                      </span>
                    </> : (
                      <span className="text-[9px] mt-1" style={{ ...MONO, color: muted }}>— no data</span>
                    )}
                  </div>
                );
              })}
            </div>
            {yearStats.months > 0 && (
              <div className="mt-3 rounded-xl overflow-hidden border" style={{ borderColor: border, background: isDark ? "#0d1420" : "#f8fafc" }}>
                <StatsRow isDark={isDark} border={border} cols={[
                  { label: "ACTIVE MONTHS", val: `${yearStats.months}`,   color: isDark ? "#94a3b8" : "#475569" },
                  { label: "WIN / LOSS",    val: `${yearStats.wins}W · ${yearStats.trades - yearStats.wins}L`, color: winRateColor(yearStats.wins, yearStats.trades) },
                  { label: "WIN RATE",      val: winRateFmt(yearStats.wins, yearStats.trades), color: winRateColor(yearStats.wins, yearStats.trades) },
                  { label: "YEAR P&L",      val: fmtIndianFull(yearStats.totalPnL), color: pnlColor(yearStats.totalPnL) },
                ]} />
              </div>
            )}
            {yearStats.months === 0 && (
              <div className="mt-4 text-center text-[10px]" style={{ ...MONO, color: muted }}>
                No live data for {calYear}
              </div>
            )}
          </div>
        </>}

        {/* ══ OVERALL VIEW ══ */}
        {viewType === "overall" && <>
          {/* Charts */}
          <ChartsPanel
            profit={overallStats.profit} loss={overallStats.loss}
            barData={overallYearData}
            barHeader="YEAR-WISE P&L"
            isDark={isDark} border={border}
            donutLabel="All-Time P&L"
            donutFooter={overallYearData.length > 0 ? [
              { label: "PROFIT YEARS", val: `${overallYearData.filter(d => d.lot >= 0).length}`, color: "#16a34a" },
              { label: "LOSS YEARS",   val: `${overallYearData.filter(d => d.lot < 0).length}`,  color: "#e11d48" },
            ] : []}
            barFooter={overallYearData.length > 0 ? [
              { label: "TOTAL YEARS",  val: `${overallYearData.length}`, color: isDark ? "#94a3b8" : "#475569" },
              { label: "WIN RATE",     val: winRateFmt(overallStats.wins, overallStats.trades), color: winRateColor(overallStats.wins, overallStats.trades) },
              { label: "ALL-TIME P&L", val: fmtIndianFull(overallStats.totalPnL), color: pnlColor(overallStats.totalPnL) },
            ] : []}
          />

          {/* Year cards */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[9px] font-bold tracking-[2px]" style={{ ...MONO, color: ACCENT }}>▶ LIVE</span>
              <span className="text-[9px] font-bold tracking-[1.5px]" style={{ ...MONO, color: muted }}>YEARLY BREAKDOWN</span>
            </div>
            {overallYearData.length > 0 ? <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {overallYearData.map(d => {
                  const cellBg = d.lot >= 0 ? "rgba(22,163,74,0.10)" : "rgba(225,29,72,0.10)";
                  const cellBc = d.lot >= 0 ? "rgba(22,163,74,0.5)"  : "rgba(225,29,72,0.5)";
                  const losses = d.trades - d.wins;
                  return (
                    <div key={d.key} className="rounded-xl p-4 flex flex-col gap-1"
                      style={{ background: cellBg, border: `1px solid ${cellBc}` }}>
                      <span className="text-[28px] font-bold leading-none" style={{ ...BEBAS, color: isDark ? "#e2e8f0" : "#1e293b" }}>{d.label}</span>
                      <span className="text-[11px] font-bold mt-1" style={{ ...MONO, color: pnlColor(d.lot) }}>{fmtIndianFull(d.lot)}</span>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {[
                          { label: "TRADES", val: `${d.trades}`, color: isDark ? "#94a3b8" : "#475569" },
                          { label: "WIN",    val: `${d.wins}`,   color: "#16a34a" },
                          { label: "LOSS",   val: `${losses}`,   color: "#e11d48" },
                          { label: "WR",     val: winRateFmt(d.wins, d.trades), color: winRateColor(d.wins, d.trades) },
                        ].map(({ label, val, color: c }) => (
                          <div key={label} className="flex flex-col">
                            <span className="text-[6px] tracking-[1px]" style={{ ...MONO, color: muted }}>{label}</span>
                            <span className="text-[12px] font-bold" style={{ ...MONO, color: c }}>{val}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 rounded-xl overflow-hidden border" style={{ borderColor: border, background: isDark ? "#0d1420" : "#f8fafc" }}>
                <StatsRow isDark={isDark} border={border} cols={[
                  { label: "TOTAL YEARS",  val: `${overallYearData.length}`,  color: isDark ? "#94a3b8" : "#475569" },
                  { label: "WIN / LOSS",   val: `${overallStats.wins}W · ${overallStats.trades - overallStats.wins}L`, color: winRateColor(overallStats.wins, overallStats.trades) },
                  { label: "WIN RATE",     val: winRateFmt(overallStats.wins, overallStats.trades), color: winRateColor(overallStats.wins, overallStats.trades) },
                  { label: "ALL-TIME P&L", val: fmtIndianFull(overallStats.totalPnL), color: pnlColor(overallStats.totalPnL) },
                ]} />
              </div>
            </> : (
              <div className="mt-4 text-center text-[10px]" style={{ ...MONO, color: muted }}>No live data found</div>
            )}
          </div>
        </>}

        {/* ══ TRADES TABLE ══ */}
        <JournalTradesSection isDark={isDark} border={border} color={color} muted={muted} />

      </div>
    </div>
  );
}

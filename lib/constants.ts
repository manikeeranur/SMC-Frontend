// ─── Trading Constants ─────────────────────────────────────────────────────────
// Edit lot sizes here — used everywhere in the UI (P&L calculations, labels, display)
export const LOT_SIZE        = 65; // NIFTY lot size  (1 lot = 65 shares)
export const SENSEX_LOT_SIZE = 20; // SENSEX lot size (1 lot = 20 shares)
export const NUM_LOTS        = 10; // ← change this to match backend NUM_LOTS (ORDER_QTY = LOT_SIZE × NUM_LOTS)

// ─── SMC Premium Filter ────────────────────────────────────────────────────────
// Change here — propagates to API default, chain highlight, and chart polling
export const SMC_MIN_PREMIUM = 200;
export const SMC_MAX_PREMIUM = 300;

export const LOT_SIZES: Record<string, number> = {
  NIFTY:   LOT_SIZE,
  SENSEX:  SENSEX_LOT_SIZE,
};

export function getLotSize(index: string): number {
  return LOT_SIZES[index?.toUpperCase?.() ?? ""] ?? LOT_SIZE;
}

// ─── NSE/BSE Market Holidays ───────────────────────────────────────────────────
// Single source of truth — used in calendar view and header holiday drawer
export const MARKET_HOLIDAYS: { date: string; name: string }[] = [
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

// Fast lookup: "YYYY-MM-DD" → holiday name
export const MARKET_HOLIDAYS_MAP: Record<string, string> =
  Object.fromEntries(MARKET_HOLIDAYS.map(h => [h.date, h.name]));

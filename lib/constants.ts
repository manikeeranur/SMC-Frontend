// ─── Trading Constants ─────────────────────────────────────────────────────────
// Edit lot sizes here — used everywhere in the UI (P&L calculations, labels, display)
export const LOT_SIZE        = 65; // NIFTY lot size  (1 lot = 65 shares)
export const SENSEX_LOT_SIZE = 20; // SENSEX lot size (1 lot = 20 shares)
export const NUM_LOTS        = 10; // ← change this to match backend NUM_LOTS (ORDER_QTY = LOT_SIZE × NUM_LOTS)

// ─── SMC Premium Filter ────────────────────────────────────────────────────────
// Change here — propagates to API default, chain highlight, and chart polling
export const SMC_MIN_PREMIUM = 200;
export const SMC_MAX_PREMIUM = 300;

// ─── VWAP 9:30 Strategy ─────────────────────────────────────────────────────────
// No entries before 09:36 IST (continuous scan after that, no fixed
// checkpoint) · CE/PE whose premium is ₹130–₹150 AND whose own 3-min candle
// CLOSES above its VWAP · exits on Target/SL, the 3:20pm square-off, or the
// stagnant timeout · at most 2 entries/day — a TARGET ends the day, a
// re-entry happens only after SL/stagnant, and whatever the 2nd entry does,
// there's never a 3rd · Target +30% / SL −8%
export const VWAP930_MIN_PREMIUM = 130;
export const VWAP930_MAX_PREMIUM = 150;
export const VWAP930_SL_PCT      = 8;   // stop loss  −8%
export const VWAP930_TARGET_PCT  = 30;  // target     +30%
export const VWAP930_NUM_LOTS    = 10;  // 10 lots
export const VWAP930_ENTRY_TIME  = "09:36"; // no entries before this — not a fixed checkpoint
export const VWAP930_MAX_TRADES_PER_DAY = 2; // ← keep in sync with backend VWAP930_MAX_TRADES_PER_DAY

export const LOT_SIZES: Record<string, number> = {
  NIFTY:   LOT_SIZE,
  SENSEX:  SENSEX_LOT_SIZE,
};

export function getLotSize(index: string): number {
  return LOT_SIZES[index?.toUpperCase?.() ?? ""] ?? LOT_SIZE;
}

// NSE/BSE market holidays are no longer hardcoded here — see
// frontend/lib/holidays.ts (useHolidays/useHolidaysMap), which fetches the
// real calendar from the backend's /api/holidays (Upstox public feed).

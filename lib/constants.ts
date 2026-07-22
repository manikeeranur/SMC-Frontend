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
// Exact 09:30 IST entry only · CE/PE whose premium is ₹130–₹150 AND price is
// touching/above its own VWAP · single entry per day · Target +30% / SL −8%
export const VWAP930_MIN_PREMIUM = 130;
export const VWAP930_MAX_PREMIUM = 150;
export const VWAP930_SL_PCT      = 8;   // stop loss  −8%
export const VWAP930_TARGET_PCT  = 30;  // target     +30%
export const VWAP930_NUM_LOTS    = 10;  // 10 lots, single entry per day
export const VWAP930_ENTRY_TIME  = "09:30";

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

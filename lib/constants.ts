// ─── Trading Constants ─────────────────────────────────────────────────────────
// Edit lot sizes here — used everywhere in the UI (P&L calculations, labels, display)
export const LOT_SIZE        = 65; // NIFTY lot size  (1 lot = 65 shares)
export const SENSEX_LOT_SIZE = 20; // SENSEX lot size (1 lot = 20 shares)

export const LOT_SIZES: Record<string, number> = {
  NIFTY:   LOT_SIZE,
  SENSEX:  SENSEX_LOT_SIZE,
};

export function getLotSize(index: string): number {
  return LOT_SIZES[index?.toUpperCase?.() ?? ""] ?? LOT_SIZE;
}

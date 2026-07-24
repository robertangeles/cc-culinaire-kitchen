/**
 * @module services/poMath
 *
 * Pure, DB-free math for purchase order calculations. Kept separate from
 * thresholdService and autoPoSuggestService (which do the I/O) so every
 * rule here is unit-testable in isolation.
 *
 * Formulas:
 *   F-PO-01  sumPOLineTotal     — SUM(qty × cost) across all PO lines
 *   F-PO-02  suggestedOrderQty  — max(par - current, reorderQty ?? 0)
 *   F-PO-03  estimatedLineCost  — suggestedQty × preferredUnitCost
 *   F-PO-04  shouldRouteToHQ    — totalValue >= threshold (null = DIRECT)
 */

/**
 * Sum the total value of PO lines: SUM(orderedQty × unitCost).
 * Rounds to 2 decimal places to avoid floating-point drift.
 */
export function sumPOLineTotal(
  lines: { orderedQty: number; unitCost: number }[],
): number {
  let total = 0;
  for (const line of lines) {
    const qty = Number.isFinite(line.orderedQty) ? line.orderedQty : 0;
    const cost = Number.isFinite(line.unitCost) ? line.unitCost : 0;
    total += qty * cost;
  }
  return Math.round(total * 100) / 100;
}

/**
 * Calculate the suggested order quantity for an ingredient below par.
 *
 *   suggested = max(parLevel - currentQty, 0)   (pure order-to-par)
 *
 * Returns 0 if currentQty >= parLevel (no shortfall).
 *
 * This is the culinary-native model: order back up to par, then round to whole
 * purchase packs, then respect the supplier minimum. The old internal
 * `reorder_qty` floor (max(shortfall, reorderQty)) was retired 2026-07-24 — it
 * silently overshot par (par 25 + reorder 50 → ordered 50, not 25), a concept
 * restaurants don't use. "How much" is now par; "in what multiples" is pack
 * size; "at least how much" is the supplier's minimum_order_qty.
 */
export function suggestedOrderQty(parLevel: number, currentQty: number): number {
  return Math.max(parLevel - currentQty, 0);
}

/**
 * Kitchen unit <-> package conversions live in @culinaire/shared so the client
 * uses the SAME implementation. Re-exported here because callers reach for them
 * next to suggestedOrderQty. See utils/packaging.ts for why.
 */
export { toPurchasePackages, toPackCost, costForOrderedUnit } from "@culinaire/shared";

/**
 * Estimate the line cost for a suggested order.
 * Returns qty × cost, formatted to 2 decimal places.
 */
export function estimatedLineCost(
  suggestedQty: number,
  preferredUnitCost: number,
): number {
  return Number((suggestedQty * preferredUnitCost).toFixed(2));
}

/**
 * Determine whether a PO should route to HQ for approval.
 * null threshold = no threshold configured = always DIRECT.
 */
export function shouldRouteToHQ(
  totalValue: number,
  thresholdAmount: number | null,
): boolean {
  if (thresholdAmount === null) return false;
  return totalValue >= thresholdAmount;
}

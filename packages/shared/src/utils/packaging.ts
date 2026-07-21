/**
 * @module utils/packaging
 *
 * Kitchen unit <-> purchase package conversions.
 *
 * Why this exists: an item is COUNTED in its kitchen unit (kg, bottle, each)
 * and BOUGHT in its purchase package (bag, case). `ingredient.pack_qty` is the
 * bridge — kitchen units per package — and the schema is explicit that
 * `ingredient.unit_cost` is priced per KITCHEN unit
 * (`pack cost / pack_qty = cost per kitchen unit`).
 *
 * A purchase order line is the other way round: `purchase_order_line.unit_cost`
 * is per ORDERED unit, because receiving divides it by the conversion factor to
 * get back to a per-kitchen-unit FIFO cost.
 *
 * Getting either direction wrong is not a rounding error, it is a pack_qty-fold
 * error. Both have shipped as live bugs on this form:
 *   - qty:  25 kg of flour prefilled as "50 bag"  (should be 2 bag)
 *   - cost: $1.40/kg written into "Cost ($ per bag)" (should be $17.50/bag),
 *           which receiving then divided AGAIN, valuing stock at $0.112/kg.
 *
 * These live in @culinaire/shared, not in a server service, specifically so the
 * client cannot reimplement them slightly differently — that divergence is what
 * caused both bugs.
 */

/**
 * Convert a kitchen-unit quantity into whole purchase packages.
 *
 * Rounds UP: you cannot buy two thirds of a bag.
 * Returns null when the item has no packaging — order in the kitchen unit and
 * no conversion applies.
 */
export function toPurchasePackages(
  qty: number,
  packQty: number | null,
  purchaseUnit: string | null,
): number | null {
  if (!purchaseUnit || packQty == null || packQty <= 0) return null;
  return Math.ceil(qty / packQty);
}

/**
 * Convert a per-kitchen-unit cost into a per-package cost.
 *
 *   $1.40/kg x 12.5 kg per bag = $17.50/bag
 *
 * Returns null when the item has no packaging — the per-kitchen-unit cost is
 * already the right number to put on the line.
 */
export function toPackCost(
  baseUnitCost: number,
  packQty: number | null,
  purchaseUnit: string | null,
): number | null {
  if (!purchaseUnit || packQty == null || packQty <= 0) return null;
  // Money: 4dp matches numeric(10,4) on unit_cost, so this never re-rounds
  // a value the DB is about to store.
  return Math.round(baseUnitCost * packQty * 10000) / 10000;
}

/**
 * The cost to put on a PO line, given the unit that line is actually ordered in.
 *
 * The form lets the operator switch a line between the package and the kitchen
 * unit; the cost must follow, or the line total silently changes meaning.
 */
export function costForOrderedUnit(
  baseUnitCost: number,
  packQty: number | null,
  purchaseUnit: string | null,
  orderedUnit: string | null,
): number {
  if (orderedUnit && purchaseUnit && orderedUnit === purchaseUnit) {
    return toPackCost(baseUnitCost, packQty, purchaseUnit) ?? baseUnitCost;
  }
  return baseUnitCost;
}

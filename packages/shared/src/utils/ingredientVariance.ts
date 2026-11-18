/**
 * Ingredient-level stock take variance (mobile eng decisions D4 and D7).
 *
 * An item that sits in several storage areas is counted once per area, so a
 * single area's count looks tiny next to the whole book on-hand and would show a
 * false shortage. The honest comparison is the TOTAL counted across the item's
 * areas against the book. The web review screen and the phone's recount flag both
 * call this one function so they can never disagree.
 *
 * Pure: no I/O. Mirrors the server's per-line rules (F-ST-01/02): variance =
 * counted - expected, percent = variance / expected x 100, null when expected is 0.
 */

export interface IngredientVarianceInput {
  /** One counted quantity per area (or category) the item was counted in, in the item's base unit. */
  countedQtys: number[];
  /** The book on-hand at the location, in the base unit; null when there is no stock level to compare to. */
  expectedQty: number | null;
  /**
   * How many areas the item sits in for this count. When given, fewer counts than this
   * means the total is not yet comparable, so no variance is returned (the phone waits to flag).
   */
  areasExpected?: number;
}

export interface IngredientVariance {
  /** Every expected area has a count (always true when `areasExpected` is not given and there is at least one count). */
  complete: boolean;
  totalCounted: number;
  /** Null until complete, or when there is no book to compare to. */
  varianceQty: number | null;
  /** Null until complete, when there is no book, or when the book is 0. */
  variancePct: number | null;
}

export function ingredientVariance({ countedQtys, expectedQty, areasExpected }: IngredientVarianceInput): IngredientVariance {
  const totalCounted = countedQtys.reduce((sum, q) => sum + q, 0);
  const complete =
    countedQtys.length > 0 && (areasExpected === undefined || countedQtys.length >= areasExpected);

  if (!complete || expectedQty === null) {
    return { complete, totalCounted, varianceQty: null, variancePct: null };
  }
  const varianceQty = totalCounted - expectedQty;
  const variancePct = expectedQty === 0 ? null : (varianceQty / expectedQty) * 100;
  return { complete, totalCounted, varianceQty, variancePct };
}

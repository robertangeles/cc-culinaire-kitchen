/**
 * @module services/stockMath
 *
 * Pure, DB-free math for stock take variance calculations. Kept separate
 * from stockTakeService (which does the I/O) so every rule here is
 * unit-testable in isolation.
 *
 * Formulas:
 *   F-ST-01  varianceQty  — counted - expected
 *   F-ST-02  variancePct  — (variance / expected) × 100, null when expected = 0
 */

/**
 * Calculate the absolute variance between a counted and expected quantity.
 * Positive = surplus, negative = shrinkage.
 */
export function varianceQty(countedQty: number, expectedQty: number): number {
  return countedQty - expectedQty;
}

/**
 * Calculate the percentage variance relative to expected quantity.
 * Returns null when expectedQty is 0 (division undefined).
 */
export function variancePct(
  variance: number,
  expectedQty: number,
): number | null {
  if (expectedQty === 0) return null;
  return (variance / expectedQty) * 100;
}

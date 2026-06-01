/**
 * @module services/forecastMath
 *
 * Pure, DB-free math for stock forecast calculations. Kept separate from
 * forecastService (which does the I/O) so every rule here is unit-testable
 * in isolation.
 *
 * Formulas:
 *   F-FC-01  dailyUsageRate       — totalConsumed / max(1, elapsedDays)
 *   F-FC-02  daysUntilDepletion   — floor(max(0, currentStock / dailyRate))
 *   F-FC-03  suggestedReorderQty  — ceil(dailyRate × bufferDays)
 *   F-FC-04  forecastConfidence   — min(1, daysWithData / windowDays)
 */

/**
 * Calculate the average daily usage rate from total consumption over a period.
 * Floors elapsedDays to 1 to avoid division by zero.
 */
export function dailyUsageRate(
  totalConsumed: number,
  elapsedDays: number,
): number {
  const safeDays = Math.max(1, elapsedDays);
  return totalConsumed / safeDays;
}

/**
 * Estimate how many whole days until stock is depleted at the given daily rate.
 * Returns 0 when dailyRate is 0 or negative (no consumption = indefinite,
 * but we cap at 0 to signal "no forecast possible" — callers use 999 sentinel
 * for "no depletion" when appropriate).
 */
export function daysUntilDepletion(
  currentStock: number,
  dailyRate: number,
): number {
  if (dailyRate <= 0) return 0;
  return Math.floor(Math.max(0, currentStock / dailyRate));
}

/**
 * Calculate the suggested reorder quantity to cover bufferDays of consumption.
 * Default buffer is 14 days (2 weeks supply).
 */
export function suggestedReorderQty(
  dailyRate: number,
  bufferDays?: number,
): number {
  return Math.ceil(dailyRate * (bufferDays ?? 14));
}

/**
 * Calculate forecast confidence as a linear scale of available data.
 * Confidence = min(1, daysWithData / windowDays). Default window is 30 days.
 */
export function forecastConfidence(
  daysWithData: number,
  windowDays?: number,
): number {
  const window = windowDays ?? 30;
  if (window <= 0) return 1;
  return Math.min(1, daysWithData / window);
}

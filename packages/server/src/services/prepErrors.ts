/**
 * @module services/prepErrors
 * Shared error class and pure parsing helpers for the prep domain.
 */

export class PrepError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = "PrepError";
  }
}

/**
 * Parse human-readable time strings into minutes.
 * Handles: "15 mins", "1 hour 30 mins", "45 minutes", "1h 30m", "2 hours"
 */
export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const s = timeStr.toLowerCase().trim();

  let totalMinutes = 0;

  // Match hours: "1 hour", "2 hours", "1h"
  const hourMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)/);
  if (hourMatch) totalMinutes += parseFloat(hourMatch[1]) * 60;

  // Match minutes: "30 mins", "45 minutes", "30m"
  const minMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m(?!\w))/);
  if (minMatch) totalMinutes += parseFloat(minMatch[1]);

  // If no matches, try plain number (assume minutes)
  if (totalMinutes === 0) {
    const plain = parseFloat(s);
    if (!isNaN(plain)) totalMinutes = plain;
  }

  return Math.round(totalMinutes);
}

/**
 * Parse yield/serving strings into a number.
 * Handles: "Serves 4", "Makes 12", "4 servings", "6", "Yields 8"
 */
export function parseYieldToServings(yieldStr: string): number {
  if (!yieldStr) return 4;
  const match = yieldStr.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 4;
}

/**
 * Parse ingredient amount strings into numbers.
 * Handles: "2", "1.5", "1/2", "1 1/2", "3/4"
 */
export function parseAmountToNumber(amount: string): number {
  if (!amount) return 0;
  const s = amount.trim();

  // Mixed fraction: "1 1/2"
  const mixedMatch = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedMatch) {
    const denom = parseInt(mixedMatch[3], 10);
    if (denom === 0) return parseInt(mixedMatch[1], 10);
    return parseInt(mixedMatch[1], 10) + parseInt(mixedMatch[2], 10) / denom;
  }

  // Simple fraction: "1/2", "3/4"
  const fracMatch = s.match(/^(\d+)\/(\d+)$/);
  if (fracMatch) {
    const denom = parseInt(fracMatch[2], 10);
    if (denom === 0) return 0;
    return parseInt(fracMatch[1], 10) / denom;
  }

  // Decimal or integer
  const num = parseFloat(s);
  return isNaN(num) ? 0 : num;
}

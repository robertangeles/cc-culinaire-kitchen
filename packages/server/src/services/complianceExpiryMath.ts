/**
 * @module services/complianceExpiryMath
 *
 * Pure, DB-free logic for deciding what the daily compliance-document expiry
 * scan should do with a single document. Kept separate from the service that
 * queries the DB and sends notifications so every rule here is
 * unit-testable in isolation.
 *
 * Formulas:
 *   F-CE-01  computeExpiryActions — alert / expired / none decision per document
 */

export type ExpiryAction =
  | { kind: "none" }
  | { kind: "alert"; daysBefore: number; daysRemaining: number }
  | { kind: "expired" };

/** Dead-document statuses the scan never chases — nothing left to renew. */
const DEAD_STATUSES = new Set(["Archived", "Rejected"]);

/**
 * Calendar-day difference between two "YYYY-MM-DD" dates, UTC-normalised so
 * DST and local-timezone shifts can never move the answer. Positive when
 * `to` is after `from`.
 */
function daysBetween(from: string, to: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  const fromMs = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const toMs = Date.UTC(toYear, toMonth - 1, toDay);
  return Math.round((toMs - fromMs) / MS_PER_DAY);
}

/**
 * Decide what the daily expiry scan should do with one compliance document.
 *
 * - No expiry date -> the document never expires; gating (e.g. rostering)
 *   falls back to verificationStatus alone. [{kind:"none"}]
 * - Already Archived or Rejected -> dead document, never chased.
 *   [{kind:"none"}]
 * - No rule for this type+jurisdiction -> nothing to alert against; the
 *   caller is responsible for warning about the missing rule separately.
 *   [{kind:"none"}]
 * - Rule not yet effective, or already ended, as of `today` -> [{kind:"none"}]
 * - expiryDate <= today -> {kind:"expired"}. "Expires on the day" is treated
 *   as already expired, not valid-until-end-of-day: the venue needs to be
 *   covered THAT day, and re-scanning at midnight to flip the status is not
 *   a mechanism this system has.
 * - Otherwise, daysRemaining exactly matching one of rule.alertDays ->
 *   {kind:"alert", daysBefore, daysRemaining}. Exact match only, so the
 *   daily job fires each alert precisely once as the countdown crosses it.
 *   No match -> [{kind:"none"}].
 */
export function computeExpiryActions(
  doc: { expiryDate: string | null; verificationStatus: string },
  rule: { alertDays: number[]; effectiveFrom: string; effectiveTo: string | null } | null,
  today: string,
): ExpiryAction[] {
  if (doc.expiryDate === null) return [{ kind: "none" }];
  if (DEAD_STATUSES.has(doc.verificationStatus)) return [{ kind: "none" }];
  if (rule === null) return [{ kind: "none" }];
  // ISO "YYYY-MM-DD" strings sort lexicographically in calendar order.
  if (rule.effectiveFrom > today) return [{ kind: "none" }];
  if (rule.effectiveTo !== null && rule.effectiveTo < today) return [{ kind: "none" }];

  const daysRemaining = daysBetween(today, doc.expiryDate);
  if (daysRemaining <= 0) return [{ kind: "expired" }];

  const actions: ExpiryAction[] = rule.alertDays
    .filter((daysBefore) => daysBefore === daysRemaining)
    .map((daysBefore) => ({ kind: "alert" as const, daysBefore, daysRemaining }));

  return actions.length > 0 ? actions : [{ kind: "none" }];
}

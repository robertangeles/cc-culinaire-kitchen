/**
 * @module services/jurisdiction
 *
 * Normalizes an Australian state name to its 3-letter jurisdiction code.
 *
 * `store_location.state` is a free-text input with no dropdown
 * (StoreLocationsSection.tsx), so it holds a mix of abbreviations ("VIC")
 * and full names ("Victoria") across real rows. Every jurisdiction-matching
 * consumer (rosterService's canAssign/award-rule lookups, publicHolidayService's
 * gap check) needs the SAME normalized code or two venues that are legally
 * in the same state silently stop matching each other's rules — exactly the
 * bug this module exists to close.
 *
 * Deliberately NOT the same mapping as applyComplianceSchema.ts's IANA
 * timezone backfill: that one folds ACT into Australia/Sydney because they
 * share a clock, but ACT is its OWN legal jurisdiction for public holidays
 * and Awards, with its own gazetted holiday list distinct from NSW's.
 * Conflating them here would be a real correctness bug, not a convenience.
 */

const STATE_NAME_TO_CODE: Record<string, string> = {
  NSW: "NSW",
  "NEW SOUTH WALES": "NSW",
  ACT: "ACT",
  "AUSTRALIAN CAPITAL TERRITORY": "ACT",
  TAS: "TAS",
  TASMANIA: "TAS",
  QLD: "QLD",
  QUEENSLAND: "QLD",
  SA: "SA",
  "SOUTH AUSTRALIA": "SA",
  WA: "WA",
  "WESTERN AUSTRALIA": "WA",
  NT: "NT",
  "NORTHERN TERRITORY": "NT",
  VIC: "VIC",
  VICTORIA: "VIC",
};

/**
 * Unrecognised input is returned trimmed/uppercased as-is, not null — an
 * unusual value still participates in exact-match lookups (and will simply
 * never match a loaded jurisdiction, which is the correct, visible failure
 * mode) rather than silently degrading to "no jurisdiction" and matching
 * every national-fallback rule instead.
 */
export function normalizeJurisdiction(state: string | null | undefined): string | null {
  if (!state) return null;
  const trimmed = state.trim().toUpperCase();
  if (!trimmed) return null;
  return STATE_NAME_TO_CODE[trimmed] ?? trimmed;
}

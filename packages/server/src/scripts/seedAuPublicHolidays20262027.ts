/**
 * @module scripts/seedAuPublicHolidays20262027
 *
 * One-off data load: national + genuinely statewide Australian public
 * holidays for 2026 and 2027, all 8 states/territories. Unblocks
 * publishRoster()'s fail-loud "Public holidays for X Y are not loaded."
 * gate for any venue in these jurisdictions/years.
 *
 * Idempotent — createPublicHoliday() 409s on a duplicate (jurisdiction,
 * holidayDate) and this script skips those rather than failing the run, so
 * re-running after partial failure or adding more years later is safe.
 *
 * Sourced from each state's own primary source (see SOURCE_BY_JURISDICTION
 * below), cross-checked against secondary aggregators and, for every
 * Easter-based date, independently verified against the standard Gregorian
 * Easter algorithm — zero discrepancies found across all 8 jurisdictions.
 *
 * Deliberately EXCLUDED (see wiki/entities/roster-core.md for the reasoning
 * behind each):
 *   - Local/regional-only observances (town show days, regional cup/regatta
 *     days) — this app's jurisdiction field is state-level, and isPublicHoliday()
 *     doesn't distinguish isRegional at query time, so a regional entry would
 *     wrongly gate every venue in that state, not just the town it applies to.
 *   - NSW's "Bank Holiday" (first Monday in August) — gazetted state-wide but
 *     observed in practice only by banking/some public-service employers, not
 *     hospitality/retail (this app's actual user base). Including it would
 *     false-positive-gate consent for the vast majority of venues.
 *
 * Uses the new partialDayFromTime column (this same change) for QLD's
 * Christmas Eve (6pm-midnight) and SA/NT's Christmas Eve + New Year's Eve
 * (7pm-midnight) — each state's own Holidays Act, not an approximation.
 *
 * VIC's 2027 "Friday before the AFL Grand Final" (24 Sep 2027) is loaded as
 * a best estimate — the government's own source marks it provisional pending
 * the 2027 AFL fixture release, corroborated by the last-Friday-in-September
 * pattern every prior year has followed. Correct via Settings -> Public
 * Holidays if the AFL fixture moves it.
 *
 * Run:
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/seedAuPublicHolidays20262027.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/seedAuPublicHolidays20262027.ts
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { createPublicHoliday, PublicHolidayError } = await import("../services/publicHolidayService.js");

const SOURCE_BY_JURISDICTION: Record<string, string> = {
  NSW: "nsw.gov.au/about-nsw/public-holidays",
  VIC: "business.vic.gov.au/business-information/public-holidays",
  QLD: "qld.gov.au/recreation/travel/holidays/public",
  SA: "SafeWork SA, cross-checked against fairwork.gov.au/employment-conditions/public-holidays",
  WA: "wa.gov.au/node/1023 (Wageline)",
  TAS: "Statutory Holidays Act 2000, cross-checked against WorkSafe Tasmania",
  NT: "nt.gov.au/nt-public-holidays, cross-checked against 5 independent secondary sources",
  ACT: "ACT Government (cmtedd.act.gov.au)",
};

const VIC_2027_AFL_PROVISIONAL_NOTE =
  " (provisional — pending the 2027 AFL fixture release; correct via Settings -> Public Holidays if it moves)";

// [jurisdiction, holidayDate, holidayName, loadedForYear, partialDayFromTime]
const HOLIDAYS: Array<[string, string, string, number, string | null]> = [
  ["ACT", "2026-01-01", "New Year's Day", 2026, null],
  ["ACT", "2026-01-26", "Australia Day", 2026, null],
  ["ACT", "2026-03-09", "Canberra Day", 2026, null],
  ["ACT", "2026-04-03", "Good Friday", 2026, null],
  ["ACT", "2026-04-04", "Easter Saturday", 2026, null],
  ["ACT", "2026-04-05", "Easter Sunday", 2026, null],
  ["ACT", "2026-04-06", "Easter Monday", 2026, null],
  ["ACT", "2026-04-25", "Anzac Day", 2026, null],
  ["ACT", "2026-04-27", "Anzac Day (additional public holiday)", 2026, null],
  ["ACT", "2026-06-01", "Reconciliation Day", 2026, null],
  ["ACT", "2026-06-08", "King's Birthday", 2026, null],
  ["ACT", "2026-10-05", "Labour Day", 2026, null],
  ["ACT", "2026-12-25", "Christmas Day", 2026, null],
  ["ACT", "2026-12-26", "Boxing Day", 2026, null],
  ["ACT", "2026-12-28", "Boxing Day (additional public holiday)", 2026, null],
  ["ACT", "2027-01-01", "New Year's Day", 2027, null],
  ["ACT", "2027-01-26", "Australia Day", 2027, null],
  ["ACT", "2027-03-08", "Canberra Day", 2027, null],
  ["ACT", "2027-03-26", "Good Friday", 2027, null],
  ["ACT", "2027-03-27", "Easter Saturday", 2027, null],
  ["ACT", "2027-03-28", "Easter Sunday", 2027, null],
  ["ACT", "2027-03-29", "Easter Monday", 2027, null],
  ["ACT", "2027-04-25", "ANZAC Day", 2027, null],
  ["ACT", "2027-04-26", "ANZAC Day (public holiday observed)", 2027, null],
  ["ACT", "2027-05-31", "Reconciliation Day", 2027, null],
  ["ACT", "2027-06-14", "King's Birthday", 2027, null],
  ["ACT", "2027-10-04", "Labour Day", 2027, null],
  ["ACT", "2027-12-25", "Christmas Day", 2027, null],
  ["ACT", "2027-12-26", "Boxing Day", 2027, null],
  ["ACT", "2027-12-27", "Christmas Day (additional public holiday)", 2027, null],
  ["ACT", "2027-12-28", "Boxing Day (additional public holiday)", 2027, null],
  ["NSW", "2026-01-01", "New Year's Day", 2026, null],
  ["NSW", "2026-01-26", "Australia Day", 2026, null],
  ["NSW", "2026-04-03", "Good Friday", 2026, null],
  ["NSW", "2026-04-04", "Easter Saturday", 2026, null],
  ["NSW", "2026-04-05", "Easter Sunday", 2026, null],
  ["NSW", "2026-04-06", "Easter Monday", 2026, null],
  ["NSW", "2026-04-25", "Anzac Day", 2026, null],
  ["NSW", "2026-04-27", "Additional Public Holiday (Anzac Day)", 2026, null],
  ["NSW", "2026-06-08", "King's Birthday", 2026, null],
  ["NSW", "2026-10-05", "Labour Day", 2026, null],
  ["NSW", "2026-12-25", "Christmas Day", 2026, null],
  ["NSW", "2026-12-26", "Boxing Day", 2026, null],
  ["NSW", "2026-12-28", "Additional Public Holiday (Boxing Day)", 2026, null],
  ["NSW", "2027-01-01", "New Year's Day", 2027, null],
  ["NSW", "2027-01-26", "Australia Day", 2027, null],
  ["NSW", "2027-03-26", "Good Friday", 2027, null],
  ["NSW", "2027-03-27", "Easter Saturday", 2027, null],
  ["NSW", "2027-03-28", "Easter Sunday", 2027, null],
  ["NSW", "2027-03-29", "Easter Monday", 2027, null],
  ["NSW", "2027-04-25", "Anzac Day", 2027, null],
  ["NSW", "2027-04-26", "Additional Public Holiday (Anzac Day)", 2027, null],
  ["NSW", "2027-06-14", "King's Birthday", 2027, null],
  ["NSW", "2027-10-04", "Labour Day", 2027, null],
  ["NSW", "2027-12-25", "Christmas Day", 2027, null],
  ["NSW", "2027-12-26", "Boxing Day", 2027, null],
  ["NSW", "2027-12-27", "Additional Public Holiday (Christmas Day)", 2027, null],
  ["NSW", "2027-12-28", "Additional Public Holiday (Boxing Day)", 2027, null],
  ["NT", "2026-01-01", "New Year's Day", 2026, null],
  ["NT", "2026-01-26", "Australia Day", 2026, null],
  ["NT", "2026-04-03", "Good Friday", 2026, null],
  ["NT", "2026-04-04", "Easter Saturday", 2026, null],
  ["NT", "2026-04-05", "Easter Sunday", 2026, null],
  ["NT", "2026-04-06", "Easter Monday", 2026, null],
  ["NT", "2026-04-25", "Anzac Day", 2026, null],
  ["NT", "2026-05-04", "May Day", 2026, null],
  ["NT", "2026-06-08", "King's Birthday", 2026, null],
  ["NT", "2026-08-03", "Picnic Day", 2026, null],
  ["NT", "2026-12-24", "Christmas Eve (part-day, 7pm-midnight)", 2026, "19:00"],
  ["NT", "2026-12-25", "Christmas Day", 2026, null],
  ["NT", "2026-12-26", "Boxing Day", 2026, null],
  ["NT", "2026-12-28", "Boxing Day (additional holiday, substitute for Saturday)", 2026, null],
  ["NT", "2026-12-31", "New Year's Eve (part-day, 7pm-midnight)", 2026, "19:00"],
  ["NT", "2027-01-01", "New Year's Day", 2027, null],
  ["NT", "2027-01-26", "Australia Day", 2027, null],
  ["NT", "2027-03-26", "Good Friday", 2027, null],
  ["NT", "2027-03-27", "Easter Saturday", 2027, null],
  ["NT", "2027-03-28", "Easter Sunday", 2027, null],
  ["NT", "2027-03-29", "Easter Monday", 2027, null],
  ["NT", "2027-04-25", "Anzac Day", 2027, null],
  ["NT", "2027-04-26", "Anzac Day (additional holiday, substitute for Sunday)", 2027, null],
  ["NT", "2027-05-03", "May Day", 2027, null],
  ["NT", "2027-06-14", "King's Birthday", 2027, null],
  ["NT", "2027-08-02", "Picnic Day", 2027, null],
  ["NT", "2027-12-24", "Christmas Eve (part-day, 7pm-midnight)", 2027, "19:00"],
  ["NT", "2027-12-25", "Christmas Day", 2027, null],
  ["NT", "2027-12-26", "Boxing Day", 2027, null],
  ["NT", "2027-12-27", "Christmas Day (additional holiday, substitute for Saturday)", 2027, null],
  ["NT", "2027-12-28", "Boxing Day (additional holiday, substitute for Sunday)", 2027, null],
  ["NT", "2027-12-31", "New Year's Eve (part-day, 7pm-midnight)", 2027, "19:00"],
  ["QLD", "2026-01-01", "New Year's Day", 2026, null],
  ["QLD", "2026-01-26", "Australia Day", 2026, null],
  ["QLD", "2026-04-03", "Good Friday", 2026, null],
  ["QLD", "2026-04-04", "The Day After Good Friday (Easter Saturday)", 2026, null],
  ["QLD", "2026-04-05", "Easter Sunday", 2026, null],
  ["QLD", "2026-04-06", "Easter Monday", 2026, null],
  ["QLD", "2026-04-25", "Anzac Day", 2026, null],
  ["QLD", "2026-05-04", "Labour Day", 2026, null],
  ["QLD", "2026-10-05", "King's Birthday", 2026, null],
  ["QLD", "2026-12-24", "Christmas Eve (part-day, 6pm to midnight)", 2026, "18:00"],
  ["QLD", "2026-12-25", "Christmas Day", 2026, null],
  ["QLD", "2026-12-26", "Boxing Day", 2026, null],
  ["QLD", "2026-12-28", "Boxing Day (substitute holiday)", 2026, null],
  ["QLD", "2027-01-01", "New Year's Day", 2027, null],
  ["QLD", "2027-01-26", "Australia Day", 2027, null],
  ["QLD", "2027-03-26", "Good Friday", 2027, null],
  ["QLD", "2027-03-27", "The Day After Good Friday (Easter Saturday)", 2027, null],
  ["QLD", "2027-03-28", "Easter Sunday", 2027, null],
  ["QLD", "2027-03-29", "Easter Monday", 2027, null],
  // No separate 25 Apr row: QLD's Holidays Act 1983 TRANSFERS (not adds to)
  // Anzac Day's observance to the following Monday when 25 Apr is a Sunday —
  // confirmed directly against qld.gov.au's own footnote, not an omission.
  ["QLD", "2027-04-26", "Anzac Day (substitute holiday; actual Anzac Day falls Sun 25 Apr 2027)", 2027, null],
  ["QLD", "2027-05-03", "Labour Day", 2027, null],
  ["QLD", "2027-10-04", "King's Birthday", 2027, null],
  ["QLD", "2027-12-24", "Christmas Eve (part-day, 6pm to midnight)", 2027, "18:00"],
  ["QLD", "2027-12-25", "Christmas Day", 2027, null],
  ["QLD", "2027-12-26", "Boxing Day", 2027, null],
  ["QLD", "2027-12-27", "Christmas Day (substitute holiday)", 2027, null],
  ["QLD", "2027-12-28", "Boxing Day (substitute holiday)", 2027, null],
  ["SA", "2026-01-01", "New Year's Day", 2026, null],
  ["SA", "2026-01-26", "Australia Day", 2026, null],
  ["SA", "2026-03-09", "Adelaide Cup Day", 2026, null],
  ["SA", "2026-04-03", "Good Friday", 2026, null],
  ["SA", "2026-04-04", "Easter Saturday", 2026, null],
  ["SA", "2026-04-05", "Easter Sunday", 2026, null],
  ["SA", "2026-04-06", "Easter Monday", 2026, null],
  ["SA", "2026-04-25", "Anzac Day", 2026, null],
  ["SA", "2026-06-08", "King's Birthday", 2026, null],
  ["SA", "2026-10-05", "Labour Day", 2026, null],
  ["SA", "2026-12-24", "Christmas Eve (part-day, 7pm-midnight)", 2026, "19:00"],
  ["SA", "2026-12-25", "Christmas Day", 2026, null],
  ["SA", "2026-12-26", "Proclamation Day holiday", 2026, null],
  ["SA", "2026-12-28", "Additional public holiday for Proclamation Day", 2026, null],
  ["SA", "2026-12-31", "New Year's Eve (part-day, 7pm-midnight)", 2026, "19:00"],
  ["SA", "2027-01-01", "New Year's Day", 2027, null],
  ["SA", "2027-01-26", "Australia Day", 2027, null],
  ["SA", "2027-03-08", "Adelaide Cup Day", 2027, null],
  ["SA", "2027-03-26", "Good Friday", 2027, null],
  ["SA", "2027-03-27", "Easter Saturday", 2027, null],
  ["SA", "2027-03-28", "Easter Sunday", 2027, null],
  ["SA", "2027-03-29", "Easter Monday", 2027, null],
  // Confirmed against SA's own source + Fair Work Ombudsman: SA does NOT
  // substitute Anzac Day for a weekend landing (some aggregators wrongly
  // claim it does for 2027 — that claim is contradicted by the primary source).
  ["SA", "2027-04-25", "Anzac Day", 2027, null],
  ["SA", "2027-06-14", "King's Birthday", 2027, null],
  ["SA", "2027-10-04", "Labour Day", 2027, null],
  ["SA", "2027-12-24", "Christmas Eve (part-day, 7pm-midnight)", 2027, "19:00"],
  ["SA", "2027-12-25", "Christmas Day", 2027, null],
  ["SA", "2027-12-26", "Proclamation Day holiday and Boxing Day", 2027, null],
  ["SA", "2027-12-27", "Additional public holiday for Christmas Day", 2027, null],
  ["SA", "2027-12-28", "Additional public holiday for Proclamation Day", 2027, null],
  ["SA", "2027-12-31", "New Year's Eve (part-day, 7pm-midnight)", 2027, "19:00"],
  ["TAS", "2026-01-01", "New Year's Day", 2026, null],
  ["TAS", "2026-01-26", "Australia Day", 2026, null],
  ["TAS", "2026-03-09", "Eight Hours Day", 2026, null],
  ["TAS", "2026-04-03", "Good Friday", 2026, null],
  ["TAS", "2026-04-06", "Easter Monday", 2026, null],
  ["TAS", "2026-04-07", "Easter Tuesday", 2026, null],
  ["TAS", "2026-04-25", "Anzac Day", 2026, null],
  ["TAS", "2026-06-08", "King's Birthday", 2026, null],
  ["TAS", "2026-12-25", "Christmas Day", 2026, null],
  ["TAS", "2026-12-28", "Boxing Day", 2026, null],
  ["TAS", "2027-01-01", "New Year's Day", 2027, null],
  ["TAS", "2027-01-26", "Australia Day", 2027, null],
  ["TAS", "2027-03-08", "Eight Hours Day", 2027, null],
  ["TAS", "2027-03-26", "Good Friday", 2027, null],
  ["TAS", "2027-03-29", "Easter Monday", 2027, null],
  ["TAS", "2027-03-30", "Easter Tuesday", 2027, null],
  ["TAS", "2027-04-25", "Anzac Day", 2027, null],
  ["TAS", "2027-06-14", "King's Birthday", 2027, null],
  ["TAS", "2027-12-25", "Christmas Day", 2027, null],
  ["TAS", "2027-12-27", "Christmas Day (additional holiday)", 2027, null],
  ["TAS", "2027-12-28", "Boxing Day", 2027, null],
  ["VIC", "2026-01-01", "New Year's Day", 2026, null],
  ["VIC", "2026-01-26", "Australia Day", 2026, null],
  ["VIC", "2026-03-09", "Labour Day", 2026, null],
  ["VIC", "2026-04-03", "Good Friday", 2026, null],
  ["VIC", "2026-04-04", "Saturday before Easter Sunday", 2026, null],
  ["VIC", "2026-04-05", "Easter Sunday", 2026, null],
  ["VIC", "2026-04-06", "Easter Monday", 2026, null],
  ["VIC", "2026-04-25", "ANZAC Day", 2026, null],
  ["VIC", "2026-06-08", "King's Birthday", 2026, null],
  ["VIC", "2026-09-25", "Friday before the AFL Grand Final", 2026, null],
  ["VIC", "2026-11-03", "Melbourne Cup Day", 2026, null],
  ["VIC", "2026-12-25", "Christmas Day", 2026, null],
  ["VIC", "2026-12-26", "Boxing Day", 2026, null],
  ["VIC", "2026-12-28", "Boxing Day (additional public holiday, substitute for Boxing Day falling on a Saturday)", 2026, null],
  ["VIC", "2027-01-01", "New Year's Day", 2027, null],
  ["VIC", "2027-01-26", "Australia Day", 2027, null],
  ["VIC", "2027-03-08", "Labour Day", 2027, null],
  ["VIC", "2027-03-26", "Good Friday", 2027, null],
  ["VIC", "2027-03-27", "Saturday before Easter Sunday", 2027, null],
  ["VIC", "2027-03-28", "Easter Sunday", 2027, null],
  ["VIC", "2027-03-29", "Easter Monday", 2027, null],
  ["VIC", "2027-04-25", "ANZAC Day", 2027, null],
  ["VIC", "2027-06-14", "King's Birthday", 2027, null],
  ["VIC", "2027-09-24", "Friday before the AFL Grand Final", 2027, null],
  ["VIC", "2027-11-02", "Melbourne Cup Day", 2027, null],
  ["VIC", "2027-12-25", "Christmas Day", 2027, null],
  ["VIC", "2027-12-26", "Boxing Day", 2027, null],
  ["VIC", "2027-12-27", "Christmas Day (additional public holiday, substitute for Christmas Day falling on a Saturday)", 2027, null],
  ["VIC", "2027-12-28", "Boxing Day (additional public holiday, substitute for Boxing Day falling on a Sunday)", 2027, null],
  ["WA", "2026-01-01", "New Year's Day", 2026, null],
  ["WA", "2026-01-26", "Australia Day", 2026, null],
  ["WA", "2026-03-02", "Labour Day", 2026, null],
  ["WA", "2026-04-03", "Good Friday", 2026, null],
  ["WA", "2026-04-05", "Easter Sunday", 2026, null],
  ["WA", "2026-04-06", "Easter Monday", 2026, null],
  ["WA", "2026-04-25", "Anzac Day", 2026, null],
  ["WA", "2026-04-27", "Anzac Day Holiday", 2026, null],
  ["WA", "2026-06-01", "Western Australia Day", 2026, null],
  ["WA", "2026-09-28", "King's Birthday", 2026, null],
  ["WA", "2026-12-25", "Christmas Day", 2026, null],
  ["WA", "2026-12-26", "Boxing Day", 2026, null],
  ["WA", "2026-12-28", "Boxing Day Holiday", 2026, null],
  ["WA", "2027-01-01", "New Year's Day", 2027, null],
  ["WA", "2027-01-26", "Australia Day", 2027, null],
  ["WA", "2027-03-01", "Labour Day", 2027, null],
  ["WA", "2027-03-26", "Good Friday", 2027, null],
  ["WA", "2027-03-28", "Easter Sunday", 2027, null],
  ["WA", "2027-03-29", "Easter Monday", 2027, null],
  ["WA", "2027-04-25", "Anzac Day", 2027, null],
  ["WA", "2027-04-26", "Anzac Day Holiday", 2027, null],
  ["WA", "2027-06-07", "Western Australia Day", 2027, null],
  ["WA", "2027-09-27", "King's Birthday", 2027, null],
  ["WA", "2027-12-25", "Christmas Day", 2027, null],
  ["WA", "2027-12-26", "Boxing Day", 2027, null],
  ["WA", "2027-12-27", "Christmas Day Holiday", 2027, null],
  ["WA", "2027-12-28", "Boxing Day Holiday", 2027, null],
];

async function main(): Promise<void> {
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const [jurisdiction, holidayDate, holidayName, loadedForYear, partialDayFromTime] of HOLIDAYS) {
    let sourceCitation = SOURCE_BY_JURISDICTION[jurisdiction];
    if (jurisdiction === "VIC" && loadedForYear === 2027 && holidayName.includes("AFL Grand Final")) {
      sourceCitation += VIC_2027_AFL_PROVISIONAL_NOTE;
    }
    try {
      await createPublicHoliday({ jurisdiction, holidayDate, holidayName, loadedForYear, partialDayFromTime, sourceCitation });
      created++;
    } catch (err) {
      if (err instanceof PublicHolidayError && err.statusCode === 409) {
        skipped++; // already loaded — idempotent re-run
      } else {
        errors.push(`${jurisdiction} ${holidayDate}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log(`Created: ${created}, already loaded (skipped): ${skipped}, errors: ${errors.length}`);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  }
}

// Auto-run only when invoked directly (not when imported by a test).
if (process.argv[1]?.endsWith("seedAuPublicHolidays20262027.ts")) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((err) => {
      console.error("AU public holiday seed failed:", err);
      process.exit(1);
    });
}

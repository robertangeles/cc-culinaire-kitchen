/**
 * @module services/publicHolidayService
 *
 * Gazetted public holidays, per Fair Work s.114 (Phase 2, Slice 6). Shared
 * jurisdiction data, no organisationId — same shape as awardRuleService.
 *
 * Ships with ZERO rows. An admin loads each jurisdiction+year manually
 * (Settings tab) — this is clerical, not a competence question, unlike the
 * Award engine, so there is no "ship empty by design, forever" story here:
 * every jurisdiction a venue operates in should eventually be loaded.
 *
 * isPublicHoliday() fails loud (throws) on an unloaded year rather than
 * silently answering "not a holiday" — the whole point of Decision 3.
 */

import { eq, and, asc } from "drizzle-orm";
import { db } from "../db/index.js";
import { publicHoliday, storeLocation } from "../db/schema.js";
import { normalizeJurisdiction } from "./jurisdiction.js";

export class PublicHolidayError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "PublicHolidayError";
  }
}

/** Has jurisdiction J's year Y been loaded at all — regardless of whether any specific date is a holiday. */
export async function isYearLoaded(jurisdiction: string, year: number): Promise<boolean> {
  const [row] = await db
    .select({ id: publicHoliday.publicHolidayId })
    .from(publicHoliday)
    .where(and(eq(publicHoliday.jurisdiction, jurisdiction), eq(publicHoliday.loadedForYear, year)))
    .limit(1);
  return !!row;
}

/**
 * Is `date` ("YYYY-MM-DD") a public holiday in `jurisdiction`? Throws if
 * that (jurisdiction, year) has never been loaded — a missing year is a
 * data gap, never silently treated as "no holidays this year".
 */
export async function isPublicHoliday(date: string, jurisdiction: string): Promise<boolean> {
  const year = Number(date.slice(0, 4));
  if (!(await isYearLoaded(jurisdiction, year))) {
    throw new PublicHolidayError(`Public holidays for ${jurisdiction} ${year} are not loaded.`, 409);
  }
  const [row] = await db
    .select({ id: publicHoliday.publicHolidayId })
    .from(publicHoliday)
    .where(and(eq(publicHoliday.jurisdiction, jurisdiction), eq(publicHoliday.holidayDate, date)))
    .limit(1);
  return !!row;
}

export interface PublicHolidayFilters {
  jurisdiction?: string;
  year?: number;
}

export async function listPublicHolidays(filters: PublicHolidayFilters = {}) {
  const conditions = [];
  if (filters.jurisdiction) conditions.push(eq(publicHoliday.jurisdiction, filters.jurisdiction));
  if (filters.year) conditions.push(eq(publicHoliday.loadedForYear, filters.year));
  return db
    .select()
    .from(publicHoliday)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(publicHoliday.jurisdiction), asc(publicHoliday.holidayDate));
}

export interface CreatePublicHolidayInput {
  jurisdiction: string;
  holidayDate: string;
  holidayName: string;
  isRegional?: boolean;
  regionNote?: string | null;
  sourceCitation?: string | null;
  loadedForYear: number;
}

export async function createPublicHoliday(input: CreatePublicHolidayInput) {
  const jurisdiction = normalizeJurisdiction(input.jurisdiction);
  if (!jurisdiction) throw new PublicHolidayError("Jurisdiction is required", 400);
  const holidayName = input.holidayName.trim();
  if (!holidayName) throw new PublicHolidayError("Holiday name is required", 400);
  if (!input.holidayDate) throw new PublicHolidayError("Holiday date is required", 400);

  try {
    const [created] = await db
      .insert(publicHoliday)
      .values({
        jurisdiction,
        holidayDate: input.holidayDate,
        holidayName,
        isRegional: input.isRegional ?? false,
        regionNote: input.regionNote ?? null,
        sourceCitation: input.sourceCitation ?? null,
        loadedForYear: input.loadedForYear,
      })
      .returning();
    return created;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new PublicHolidayError(
        `${jurisdiction} already has a public holiday loaded for ${input.holidayDate}`,
        409,
      );
    }
    throw err;
  }
}

export async function deletePublicHoliday(id: string): Promise<void> {
  const [row] = await db
    .select({ id: publicHoliday.publicHolidayId })
    .from(publicHoliday)
    .where(eq(publicHoliday.publicHolidayId, id));
  if (!row) throw new PublicHolidayError("Public holiday not found", 404);
  await db.delete(publicHoliday).where(eq(publicHoliday.publicHolidayId, id));
}

// ── Gap-check job ────────────────────────────────────────────────────

export interface GapCheckResult {
  checked: Array<{ jurisdiction: string; year: number }>;
  missing: Array<{ jurisdiction: string; year: number }>;
}

/** From November on, also check next year — venues roster ahead into the new year. */
const LOOKAHEAD_FROM_MONTH = 10; // 0-indexed: October=9, November=10

/** Pure — which calendar years the gap check should cover for a given `today`. */
export function gapCheckYears(today: Date): number[] {
  const years = [today.getFullYear()];
  if (today.getMonth() >= LOOKAHEAD_FROM_MONTH) years.push(today.getFullYear() + 1);
  return years;
}

/**
 * Daily heads-up, not an enforcement mechanism — the real enforcement is
 * publishRoster()'s fail-loud check at the moment a gap actually matters.
 * This just surfaces a gap before anyone hits it, via a structured log line
 * an alerting pipeline can pick up (same "alert: ..." convention as
 * documentStorageService's compliance_storage_unavailable marker).
 */
export async function runPublicHolidayGapCheck(today: Date = new Date()): Promise<GapCheckResult> {
  const locations = await db.selectDistinct({ state: storeLocation.state }).from(storeLocation);
  const jurisdictions = [...new Set(locations.map((l) => normalizeJurisdiction(l.state)).filter((j): j is string => !!j))];

  const years = gapCheckYears(today);

  const checked: Array<{ jurisdiction: string; year: number }> = [];
  const missing: Array<{ jurisdiction: string; year: number }> = [];

  for (const jurisdiction of jurisdictions) {
    for (const year of years) {
      checked.push({ jurisdiction, year });
      if (!(await isYearLoaded(jurisdiction, year))) {
        missing.push({ jurisdiction, year });
      }
    }
  }

  return { checked, missing };
}

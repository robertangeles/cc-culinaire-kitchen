/**
 * @module services/workforceDemandService
 *
 * Phase 3, Slice 1: recommended staffing hours per kitchen station, derived
 * from historical prep workload (`prep_task.prep_time_minutes`) scaled by a
 * target date's expected covers.
 *
 * Reports demand per STATION, not per ROLE. `prep_task.station` (kitchen-
 * area vocabulary, e.g. "Bar", "Grill / Protein" — see `prepMath.ts`'s
 * `stationFor()`) and `roster_role.roleName` (free-text per-org, e.g.
 * "Bartender") are independently-typed vocabularies with no table or FK
 * between them anywhere in this schema. Inventing that mapping now would
 * mean guessing an org's own naming conventions on their behalf; station
 * names are already human-readable, so a manager translates "Bar" ->
 * "Bartender" in the two seconds it takes to read the screen.
 * # ponytail: no station->role mapping table; add one only if an operator
 * explicitly asks for role-level rollups.
 *
 * `sale` rows are deliberately NOT used — no formula anywhere in this
 * codebase converts sale volume into labour-hours, and inventing one now
 * would be a guess presented as fact. Disclosed via `inputsNotUsed` on every
 * result, same honesty posture as the Award engine's "0 of N checked".
 */

import { sql, eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { prepSession } from "../db/schema.js";
import { assertLocationInOrg, RosterError } from "./rosterService.js";
import { minutesPerCover, recommendedStationHours, forecastConfidence } from "./forecastMath.js";

const WINDOW_DAYS = 30;

export interface StationDemand {
  station: string;
  recommendedHours: number;
  confidence: number;
  basedOnDays: number;
}

export interface WorkforceDemandResult {
  storeLocationId: string;
  forDate: string;
  targetCovers: number;
  stations: StationDemand[];
  inputsUsed: string[];
  inputsNotUsed: string[];
}

function subDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

interface StationAggRow {
  station: string;
  total_minutes: string | number | null;
  total_covers: string | number | null;
  days_with_data: number;
}

/**
 * Recommended hours per station for one venue on one date, based on the
 * WINDOW_DAYS of prep history immediately before it (the target date itself
 * is excluded from its own historical average). `forDate` must already have
 * a `prep_session` row at this venue with an expected (or actual) covers
 * count — fails loud rather than guessing a covers number, same posture as
 * the public-holiday calendar's fail-loud gap check.
 */
export async function getStationDemand(
  orgId: number,
  storeLocationId: string,
  forDate: string,
): Promise<WorkforceDemandResult> {
  await assertLocationInOrg(storeLocationId, orgId);

  // A venue can have more than one prep_session for the same date (one per
  // staff member — see prepService.ts's teamView; no unique constraint
  // enforces a single session per venue/day). Sum covers across every
  // session on the target date, exactly like the historical window below
  // already sums covers across every session on each historical day — an
  // "which one session wins" pick would be inconsistent with that and
  // understate the venue's real covers on a day split across e.g. a lunch
  // and a dinner session.
  const targetSessions = await db
    .select({ expectedCovers: prepSession.expectedCovers, actualCovers: prepSession.actualCovers })
    .from(prepSession)
    .where(and(eq(prepSession.storeLocationId, storeLocationId), eq(prepSession.prepDate, forDate)));

  if (targetSessions.length === 0) {
    throw new RosterError(
      `No prep session found for ${forDate} at this venue — create one with expected covers first.`,
      404,
    );
  }
  const targetCovers = targetSessions.reduce((sum, s) => sum + (s.actualCovers ?? s.expectedCovers ?? 0), 0);

  const windowStart = subDays(forDate, WINDOW_DAYS);

  const rows = (await db.execute(sql`
    WITH station_day AS (
      SELECT pt.prep_session_id, pt.station, SUM(pt.prep_time_minutes) AS minutes
      FROM prep_task pt
      JOIN prep_session ps ON ps.prep_session_id = pt.prep_session_id
      WHERE pt.prep_time_minutes IS NOT NULL AND pt.station IS NOT NULL
        AND ps.store_location_id = ${storeLocationId}
        AND ps.prep_date >= ${windowStart}
        AND ps.prep_date < ${forDate}
      GROUP BY pt.prep_session_id, pt.station
    )
    SELECT sd.station AS station,
           SUM(sd.minutes) AS total_minutes,
           SUM(COALESCE(ps.actual_covers, ps.expected_covers, 0)) AS total_covers,
           COUNT(DISTINCT ps.prep_date)::int AS days_with_data
    FROM station_day sd
    JOIN prep_session ps ON ps.prep_session_id = sd.prep_session_id
    GROUP BY sd.station
    ORDER BY sd.station
  `)) as unknown as StationAggRow[];

  const stations: StationDemand[] = rows.map((r) => {
    const totalMinutes = Number(r.total_minutes ?? 0);
    const totalCovers = Number(r.total_covers ?? 0);
    const rate = minutesPerCover(totalMinutes, totalCovers);
    return {
      station: r.station,
      recommendedHours: recommendedStationHours(rate, targetCovers),
      confidence: Number(forecastConfidence(r.days_with_data, WINDOW_DAYS).toFixed(2)),
      basedOnDays: r.days_with_data,
    };
  });

  return {
    storeLocationId,
    forDate,
    targetCovers,
    stations,
    inputsUsed: ["prep_task.prep_time_minutes", "prep_session.expected_covers/actual_covers"],
    inputsNotUsed: ["sale"],
  };
}

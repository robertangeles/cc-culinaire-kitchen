import type { Migration } from "./runner.js";

/**
 * A replayed "add availability" (an offline retry, a double tap) must not add a second identical window.
 * Run BEFORE the server version that reads this deploys.
 *
 * Existing duplicates: rows identical in every column that defines a window (user, organisation, venue or "any venue",
 * day, times, start and end date) are exact twins and carry no information beyond `created_dttm`. The first statement
 * deletes all but the earliest-created one of each set (ties: lowest id); nothing references this table, and nothing else is touched.
 * Run this read-only query first: it counts what the DELETE would remove (a window with n copies loses n-1) and samples the sets.
 *   SELECT user_id, organisation_id, store_location_id, day_of_week, available_from, available_until, effective_from, effective_until,
 *          count(*) AS copies, count(*) - 1 AS rows_removed
 *     FROM staff_availability
 *    GROUP BY user_id, organisation_id, store_location_id, day_of_week, available_from, available_until, effective_from, effective_until
 *   HAVING count(*) > 1 ORDER BY copies DESC LIMIT 20;
 * With no rows back the DELETE removes nothing. The statements run in the runner's single transaction: a failure leaves everything as it was.
 *
 * The previous server version keeps working afterwards, with one difference: a create or edit that would make an exact twin
 * of an existing window now fails (an unhandled 500 there, a replayed row here) instead of silently adding the twin.
 */
export const migration: Migration = {
  id: "0005_staff_availability_unique",
  description: "staff_availability: delete exact duplicate windows (keep the earliest), then one row per window",
  statements: [
    `DELETE FROM "staff_availability" a USING "staff_availability" b
      WHERE a."user_id" = b."user_id"
        AND a."organisation_id" = b."organisation_id"
        AND a."day_of_week" = b."day_of_week"
        AND a."available_from" = b."available_from"
        AND a."available_until" = b."available_until"
        AND a."effective_from" = b."effective_from"
        AND a."store_location_id" IS NOT DISTINCT FROM b."store_location_id"
        AND a."effective_until" IS NOT DISTINCT FROM b."effective_until"
        AND (a."created_dttm", a."staff_availability_id") > (b."created_dttm", b."staff_availability_id")`,
    // "Find the window this create replays". NULL venue (any venue) and NULL end date (open-ended) count as values, hence the coalesce.
    `CREATE UNIQUE INDEX IF NOT EXISTS "uq_staff_availability_window" ON "staff_availability"
      ("user_id", "organisation_id", "day_of_week", "available_from", "available_until", "effective_from",
       coalesce("store_location_id", '00000000-0000-0000-0000-000000000000'::uuid), coalesce("effective_until", 'infinity'::date))`,
  ],
};

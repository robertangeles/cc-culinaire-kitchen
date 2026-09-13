/**
 * @module scripts/addRosterShiftTemplate
 *
 * Additive DDL for Roster Scheduling Templates:
 *  - new table `roster_shift_template` (a saved weekly pattern row: role +
 *    day-of-week + start/end time), with its FK indices.
 *  - `shift` gains two nullable columns, `source_template_row_id` (FK,
 *    ON DELETE SET NULL) and `generated_for_week_start`, plus an FK index
 *    and a unique index on the pair — the real DB constraint that closes
 *    the concurrent-generation race (23505), same idiom as this session's
 *    `assignStaff`/`claimSwap` reactivation-race fix.
 *
 * Idempotent (IF NOT EXISTS throughout) — same discipline as every other
 * script in this directory. `drizzle-kit push` is forbidden in this repo.
 *
 * Run:
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/addRosterShiftTemplate.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/addRosterShiftTemplate.ts
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

async function main(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "roster_shift_template" (
      "roster_shift_template_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "organisation_id" integer NOT NULL REFERENCES "organisation"("organisation_id"),
      "store_location_id" uuid NOT NULL REFERENCES "store_location"("store_location_id"),
      "roster_role_id" uuid NOT NULL REFERENCES "roster_role"("roster_role_id"),
      "day_of_week" smallint NOT NULL,
      "start_time" varchar(5) NOT NULL,
      "end_time" varchar(5) NOT NULL,
      "created_dttm" timestamptz NOT NULL DEFAULT now(),
      "updated_dttm" timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_roster_shift_template_org"
      ON "roster_shift_template" ("organisation_id")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_roster_shift_template_location"
      ON "roster_shift_template" ("store_location_id")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_roster_shift_template_role"
      ON "roster_shift_template" ("roster_role_id")
  `);

  await db.execute(sql`
    ALTER TABLE "shift"
      ADD COLUMN IF NOT EXISTS "source_template_row_id" uuid
        REFERENCES "roster_shift_template"("roster_shift_template_id") ON DELETE SET NULL
  `);
  await db.execute(sql`
    ALTER TABLE "shift"
      ADD COLUMN IF NOT EXISTS "generated_for_week_start" date
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_shift_source_template"
      ON "shift" ("source_template_row_id")
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_shift_template_week_unique"
      ON "shift" ("source_template_row_id", "generated_for_week_start")
  `);

  const table = await db.execute(
    sql`select count(*) from information_schema.tables where table_name = 'roster_shift_template'`,
  );
  const cols = await db.execute(
    sql`select column_name from information_schema.columns
        where table_name = 'shift' and column_name in ('source_template_row_id', 'generated_for_week_start')
        order by column_name`,
  );
  console.log("roster_shift_template table exists:", table[0]);
  console.log("shift new columns:", cols);
}

// Auto-run only when invoked directly (not when imported by a test).
if (process.argv[1]?.endsWith("addRosterShiftTemplate.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("roster_shift_template DDL failed:", err);
      process.exit(1);
    });
}

/**
 * @module scripts/addPublicHolidayPartialDayColumn
 *
 * Targeted, idempotent DDL adding `public_holiday.partial_day_from_time`
 * (varchar(5), nullable "HH:MM") — some states (QLD/SA/NT) gazette a public
 * holiday only from a given time of day until midnight (e.g. Christmas Eve),
 * not the whole calendar date. NULL (the default for every existing row and
 * the vast majority of new ones) preserves today's full-day behavior exactly.
 *
 * Additive only (ADD COLUMN IF NOT EXISTS), same discipline as every other
 * script in this directory — `drizzle-kit push` is forbidden in this repo.
 *
 * Run:
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/addPublicHolidayPartialDayColumn.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/addPublicHolidayPartialDayColumn.ts
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
    ALTER TABLE "public_holiday"
      ADD COLUMN IF NOT EXISTS "partial_day_from_time" varchar(5)
  `);

  const rows = await db.execute(
    sql`select column_name, data_type, character_maximum_length from information_schema.columns
        where table_name = 'public_holiday' and column_name = 'partial_day_from_time'`,
  );
  console.log("public_holiday.partial_day_from_time:", rows[0] ?? "NOT FOUND");
}

// Auto-run only when invoked directly (not when imported by a test).
if (process.argv[1]?.endsWith("addPublicHolidayPartialDayColumn.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("public_holiday partial-day column DDL failed:", err);
      process.exit(1);
    });
}

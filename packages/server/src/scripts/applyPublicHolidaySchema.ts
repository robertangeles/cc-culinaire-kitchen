/**
 * One-off: apply the public_holiday table (Phase 2, Slice 6) to the target DB.
 *
 * Additive and idempotent (IF NOT EXISTS), so re-running is a no-op. Same
 * discipline as applyComplianceSchema.ts / applyRosterSchema.ts /
 * applyAwardRuleSchema.ts — `drizzle-kit push` is forbidden in this repo.
 *
 * Ships with ZERO rows — an admin loads each jurisdiction+year manually via
 * the Settings tab. See schema.ts's doc comment on publicHoliday for why
 * that's fine here (clerical, not a competence question) unlike award_rule.
 *
 * Run:
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/applyPublicHolidaySchema.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/applyPublicHolidaySchema.ts
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { sql } = await import("drizzle-orm");
const { db } = await import("../db/index.js");

const statements = [
  sql`CREATE TABLE IF NOT EXISTS public_holiday (
    public_holiday_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiction varchar(3) NOT NULL,
    holiday_date date NOT NULL,
    holiday_name varchar(200) NOT NULL,
    is_regional boolean NOT NULL DEFAULT false,
    region_note varchar(500),
    source_citation varchar(500),
    loaded_for_year integer NOT NULL,
    created_dttm timestamptz NOT NULL DEFAULT now(),
    updated_dttm timestamptz NOT NULL DEFAULT now()
  )`,
  // isPublicHoliday(date, jurisdiction): "is this exact date a holiday here".
  sql`CREATE INDEX IF NOT EXISTS idx_public_holiday_lookup ON public_holiday (jurisdiction, holiday_date)`,
  // Gap check + admin loader's list-by-year view.
  sql`CREATE INDEX IF NOT EXISTS idx_public_holiday_year ON public_holiday (jurisdiction, loaded_for_year)`,
  // No AU state gazettes two different public holidays on the same date.
  sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_public_holiday_unique ON public_holiday (jurisdiction, holiday_date)`,
];

async function main() {
  for (const stmt of statements) await db.execute(stmt);
  const tables = await db.execute(
    sql`select table_name from information_schema.tables where table_name = 'public_holiday'`,
  );
  const rowCount = await db.execute(sql`select count(*)::int as n from public_holiday`);
  console.log("tables:", tables.map((r) => r.table_name).join(",") || "NONE");
  console.log("public_holiday row count:", rowCount[0]?.n ?? "unknown", "(expected 0)");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

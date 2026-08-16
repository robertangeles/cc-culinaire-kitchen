/**
 * One-off: apply the award_rule table (Phase 2, Slice 4) to the target DB.
 *
 * Additive and idempotent (IF NOT EXISTS), so re-running is a no-op. Same
 * discipline as applyComplianceSchema.ts / applyRosterSchema.ts —
 * `drizzle-kit push` is forbidden in this repo.
 *
 * Ships with ZERO rows — this script creates the table only, never inserts
 * a rule. See the schema.ts doc comment on awardRule for why.
 *
 * Run:
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/applyAwardRuleSchema.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/applyAwardRuleSchema.ts
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
  sql`CREATE TABLE IF NOT EXISTS award_rule (
    award_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiction varchar(3),
    award_code varchar(20) NOT NULL,
    rule_type varchar(40) NOT NULL,
    threshold_value numeric(10, 2),
    effective_from date NOT NULL,
    effective_to date,
    source_citation varchar(500),
    rule_version varchar(20) NOT NULL,
    created_dttm timestamptz NOT NULL DEFAULT now(),
    updated_dttm timestamptz NOT NULL DEFAULT now()
  )`,
  // Rule lookup: "the active rule for this type + jurisdiction on date X".
  sql`CREATE INDEX IF NOT EXISTS idx_award_rule_lookup ON award_rule (rule_type, jurisdiction, effective_from)`,
];

async function main() {
  for (const stmt of statements) await db.execute(stmt);
  const tables = await db.execute(
    sql`select table_name from information_schema.tables where table_name = 'award_rule'`,
  );
  const rowCount = await db.execute(sql`select count(*)::int as n from award_rule`);
  console.log("tables:", tables.map((r) => r.table_name).join(",") || "NONE");
  console.log("award_rule row count:", rowCount[0]?.n ?? "unknown", "(expected 0)");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

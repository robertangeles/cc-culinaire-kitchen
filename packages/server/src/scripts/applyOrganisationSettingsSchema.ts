/**
 * One-off: add the branding + operational-default columns to `organisation`
 * (Operations Admin, Organisation Settings) to the target DB.
 *
 * Additive and idempotent (IF NOT EXISTS), so re-running is a no-op. Same
 * discipline as applyWorkforceSwapSchema.ts / applyRosterSchema.ts —
 * `drizzle-kit push` is forbidden in this repo.
 *
 * Run:
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/applyOrganisationSettingsSchema.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/applyOrganisationSettingsSchema.ts
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
  sql`ALTER TABLE organisation ADD COLUMN IF NOT EXISTS organisation_logo_path varchar(500)`,
  sql`ALTER TABLE organisation ADD COLUMN IF NOT EXISTS organisation_color_accent varchar(7)`,
  sql`ALTER TABLE organisation ADD COLUMN IF NOT EXISTS default_timezone varchar(50) NOT NULL DEFAULT 'Australia/Melbourne'`,
  sql`ALTER TABLE organisation ADD COLUMN IF NOT EXISTS default_currency varchar(3) NOT NULL DEFAULT 'AUD'`,
  sql`ALTER TABLE organisation ADD COLUMN IF NOT EXISTS default_jurisdiction varchar(3)`,
];

async function main() {
  for (const stmt of statements) await db.execute(stmt);
  const cols = await db.execute(
    sql`select column_name from information_schema.columns where table_name = 'organisation'
        and column_name in ('organisation_logo_path', 'organisation_color_accent', 'default_timezone', 'default_currency', 'default_jurisdiction')
        order by column_name`,
  );
  console.log("organisation settings columns present:", cols.map((r) => r.column_name).join(", "));
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

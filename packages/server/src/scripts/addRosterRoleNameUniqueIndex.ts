/**
 * One-off: add a uniqueness constraint on roster_role's (org, venue, name)
 * so a duplicate role name at the same venue is rejected by the database,
 * not just best-effort-skipped by client logic (the "copy roles to a new
 * venue" feature's dedup backstop).
 *
 * Plain (non-partial) unique index: Postgres treats any row with a NULL
 * column as automatically non-conflicting in a composite unique index, so
 * this naturally protects only venue-scoped duplicates while leaving
 * org-wide (null store_location_id) roles completely unrestricted — no
 * WHERE clause needed.
 *
 * Idempotent (IF NOT EXISTS), matches applyRosterSchema.ts's convention —
 * `drizzle-kit push` is forbidden in this repo; it diffs the whole database
 * and would drop live columns it does not know about.
 *
 * Pre-merge check required (T0 in docs/designs/roster-roles-venue-picker.md):
 * confirm no existing duplicate (org, venue, name) rows before running this,
 * or CREATE UNIQUE INDEX fails outright.
 *
 * Run:
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/addRosterRoleNameUniqueIndex.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/addRosterRoleNameUniqueIndex.ts
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { sql } = await import("drizzle-orm");
const { db } = await import("../db/index.js");

await db.execute(
  sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_roster_role_org_location_name ON roster_role (organisation_id, store_location_id, role_name)`,
);

console.log("addRosterRoleNameUniqueIndex: done");
process.exit(0);

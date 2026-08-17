/**
 * One-off: apply the shift_swap_request table (Phase 3, Slice 3) to the
 * target DB.
 *
 * Additive and idempotent (IF NOT EXISTS), so re-running is a no-op. Same
 * discipline as applyRosterSchema.ts / applyPublicHolidaySchema.ts —
 * `drizzle-kit push` is forbidden in this repo.
 *
 * Run:
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/applyWorkforceSwapSchema.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/applyWorkforceSwapSchema.ts
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
  sql`CREATE TABLE IF NOT EXISTS shift_swap_request (
    swap_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id uuid NOT NULL REFERENCES shift(shift_id) ON DELETE CASCADE,
    from_assignment_id uuid NOT NULL REFERENCES shift_assignment(assignment_id) ON DELETE CASCADE,
    from_user_id integer NOT NULL REFERENCES "user"(user_id),
    to_user_id integer REFERENCES "user"(user_id),
    status varchar(20) NOT NULL DEFAULT 'Open',
    created_dttm timestamptz NOT NULL DEFAULT now(),
    updated_dttm timestamptz NOT NULL DEFAULT now()
  )`,
  // One open offer per assignment at a time.
  sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_swap_request_open_unique
      ON shift_swap_request (shift_id, from_assignment_id) WHERE status = 'Open'`,
  // "Every open swap at this venue's shifts" — the browse/claim list.
  sql`CREATE INDEX IF NOT EXISTS idx_shift_swap_request_shift ON shift_swap_request (shift_id)`,
  // FK index: "swaps this person has offered".
  sql`CREATE INDEX IF NOT EXISTS idx_shift_swap_request_from_user ON shift_swap_request (from_user_id)`,
  // FK index: "swaps this person has claimed".
  sql`CREATE INDEX IF NOT EXISTS idx_shift_swap_request_to_user ON shift_swap_request (to_user_id)`,
];

async function main() {
  for (const stmt of statements) await db.execute(stmt);
  const tables = await db.execute(
    sql`select table_name from information_schema.tables where table_name = 'shift_swap_request'`,
  );
  const rowCount = await db.execute(sql`select count(*)::int as n from shift_swap_request`);
  console.log("tables:", tables.map((r) => r.table_name).join(",") || "NONE");
  console.log("shift_swap_request row count:", rowCount[0]?.n ?? "unknown", "(expected 0)");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

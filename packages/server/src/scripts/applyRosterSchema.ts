/**
 * One-off: apply the Roster Core (Phase 2) schema to the target DB.
 *
 * Every statement is additive and idempotent (IF NOT EXISTS / pg_constraint guard),
 * so re-running is a no-op and nothing existing is dropped or rewritten. Same
 * discipline as applyComplianceSchema.ts, for the same reason — `drizzle-kit push`
 * is forbidden in this repo; it diffs the whole database and would drop live
 * columns it does not know about.
 *
 * Run:
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/applyRosterSchema.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/applyRosterSchema.ts
 *
 * Safe to run against prod at any time, including well before roster_enabled is
 * ever flipped on: these tables have no route mounted onto them yet (that's
 * Slice 3), so creating them early costs nothing and lets each slice's migration
 * land independently rather than piling up into one deploy.
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
  // -- roster_role ----------------------------------------------------------
  sql`CREATE TABLE IF NOT EXISTS roster_role (
    roster_role_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id integer NOT NULL REFERENCES organisation(organisation_id),
    store_location_id uuid REFERENCES store_location(store_location_id),
    role_name varchar(100) NOT NULL,
    created_dttm timestamptz NOT NULL DEFAULT now(),
    updated_dttm timestamptz NOT NULL DEFAULT now()
  )`,
  // FK index: "every role defined for an org" (Settings admin list).
  sql`CREATE INDEX IF NOT EXISTS idx_roster_role_org ON roster_role (organisation_id)`,
  // FK index: "every role defined at (or org-wide for) one venue".
  sql`CREATE INDEX IF NOT EXISTS idx_roster_role_location ON roster_role (store_location_id)`,

  // -- roster_role_document ---------------------------------------------------
  sql`CREATE TABLE IF NOT EXISTS roster_role_document (
    roster_role_id uuid NOT NULL REFERENCES roster_role(roster_role_id) ON DELETE CASCADE,
    document_type varchar(40) NOT NULL
  )`,
  // Composite PK: one requirement per role per document type. Leftmost column
  // also serves the FK ("all requirements for one role") lookup.
  sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_roster_role_document_pk ON roster_role_document (roster_role_id, document_type)`,

  // -- shift ------------------------------------------------------------------
  sql`CREATE TABLE IF NOT EXISTS shift (
    shift_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id integer NOT NULL REFERENCES organisation(organisation_id),
    store_location_id uuid NOT NULL REFERENCES store_location(store_location_id),
    roster_role_id uuid NOT NULL REFERENCES roster_role(roster_role_id),
    start_datetime timestamptz NOT NULL,
    end_datetime timestamptz NOT NULL,
    is_public_holiday boolean NOT NULL DEFAULT false,
    status varchar(20) NOT NULL DEFAULT 'Draft',
    created_by integer NOT NULL REFERENCES "user"(user_id),
    created_dttm timestamptz NOT NULL DEFAULT now(),
    updated_dttm timestamptz NOT NULL DEFAULT now()
  )`,
  // A shift ending before or exactly when it starts is malformed data, not a
  // valid zero-or-negative-length shift.
  sql`DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'chk_shift_time_order'
    ) THEN
      ALTER TABLE shift
        ADD CONSTRAINT chk_shift_time_order
        CHECK (end_datetime > start_datetime);
    END IF;
  END $$`,
  // FK index: "every shift for an org" (org-wide roster views/reports).
  sql`CREATE INDEX IF NOT EXISTS idx_shift_org ON shift (organisation_id)`,
  // Roster grid: "every shift at this venue in this date range".
  sql`CREATE INDEX IF NOT EXISTS idx_shift_location_start ON shift (store_location_id, start_datetime)`,
  // FK index: "every shift this role has been used for".
  sql`CREATE INDEX IF NOT EXISTS idx_shift_role ON shift (roster_role_id)`,

  // -- shift_assignment ---------------------------------------------------------
  sql`CREATE TABLE IF NOT EXISTS shift_assignment (
    assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id uuid NOT NULL REFERENCES shift(shift_id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES "user"(user_id),
    status varchar(20) NOT NULL DEFAULT 'Pending',
    public_holiday_consent varchar(20),
    consent_requested_at timestamptz,
    consent_responded_at timestamptz,
    created_dttm timestamptz NOT NULL DEFAULT now(),
    updated_dttm timestamptz NOT NULL DEFAULT now()
  )`,
  // One assignment per person per shift.
  sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_assignment_unique ON shift_assignment (shift_id, user_id)`,
  // FK index: "every shift a staff member is on" (their own roster view).
  sql`CREATE INDEX IF NOT EXISTS idx_shift_assignment_user ON shift_assignment (user_id)`,

  // -- staff_availability ---------------------------------------------------------
  sql`CREATE TABLE IF NOT EXISTS staff_availability (
    staff_availability_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id integer NOT NULL REFERENCES "user"(user_id),
    organisation_id integer NOT NULL REFERENCES organisation(organisation_id),
    store_location_id uuid REFERENCES store_location(store_location_id),
    day_of_week smallint NOT NULL,
    available_from varchar(5) NOT NULL,
    available_until varchar(5) NOT NULL,
    effective_from date NOT NULL,
    effective_until date,
    created_dttm timestamptz NOT NULL DEFAULT now(),
    updated_dttm timestamptz NOT NULL DEFAULT now()
  )`,
  sql`DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_availability_time_order'
    ) THEN
      ALTER TABLE staff_availability
        ADD CONSTRAINT chk_staff_availability_time_order
        CHECK (available_until > available_from);
    END IF;
  END $$`,
  sql`DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_availability_date_order'
    ) THEN
      ALTER TABLE staff_availability
        ADD CONSTRAINT chk_staff_availability_date_order
        CHECK (effective_until IS NULL OR effective_until >= effective_from);
    END IF;
  END $$`,
  // "This person's availability" — their own profile view, and the input to
  // the roster builder's assignment suggestions.
  sql`CREATE INDEX IF NOT EXISTS idx_staff_availability_user ON staff_availability (user_id)`,
  // FK index: org-wide availability reporting.
  sql`CREATE INDEX IF NOT EXISTS idx_staff_availability_org ON staff_availability (organisation_id)`,
  // FK index: "every availability window defined at (or org-wide for) one venue".
  sql`CREATE INDEX IF NOT EXISTS idx_staff_availability_location ON staff_availability (store_location_id)`,
];

async function main() {
  for (const stmt of statements) await db.execute(stmt);
  const tables = await db.execute(
    sql`select table_name from information_schema.tables where table_name in ('roster_role','roster_role_document','shift','shift_assignment','staff_availability') order by table_name`,
  );
  const checks = await db.execute(
    sql`select conname from pg_constraint where conname in ('chk_shift_time_order','chk_staff_availability_time_order','chk_staff_availability_date_order') order by conname`,
  );
  console.log("tables:", tables.map((r) => r.table_name).join(",") || "NONE");
  console.log("checks:", checks.map((r) => r.conname).join(",") || "NONE");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

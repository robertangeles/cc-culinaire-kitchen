/**
 * One-off: apply the Staff Compliance Vault (Phase 1) schema to the target DB.
 *
 * Every statement is additive and idempotent (IF NOT EXISTS / pg_constraint guard),
 * so re-running is a no-op and nothing existing is dropped or rewritten. This is the
 * ONLY sanctioned way to move this schema — `drizzle-kit push` diffs the whole
 * database and would drop live columns it does not know about (see
 * wiki/synthesis/schema-drift-may-2026.md).
 *
 * Run:
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/applyComplianceSchema.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/applyComplianceSchema.ts
 *
 * The dotenv + applyEnvPrefix bootstrap below is what makes APP_ENV select the
 * right database; without it the script silently has no DATABASE_URL.
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
  // -- compliance_document ----------------------------------------------------
  sql`CREATE TABLE IF NOT EXISTS compliance_document (
    compliance_document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id integer NOT NULL REFERENCES organisation(organisation_id),
    store_location_id uuid REFERENCES store_location(store_location_id),
    user_id integer REFERENCES "user"(user_id),
    subject_store_location_id uuid REFERENCES store_location(store_location_id),
    document_type varchar(40) NOT NULL,
    engagement_type varchar(20) NOT NULL DEFAULT 'employee',
    document_number varchar(100),
    issue_date date,
    expiry_date date,
    issuing_authority varchar(200),
    issuing_jurisdiction varchar(3),
    storage_public_id varchar(255) NOT NULL,
    storage_format varchar(10),
    verification_status varchar(20) NOT NULL DEFAULT 'Pending',
    employment_end_date date,
    uploaded_by integer NOT NULL REFERENCES "user"(user_id),
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    verified_by integer REFERENCES "user"(user_id),
    verified_at timestamptz,
    rejection_reason varchar(500),
    notes text,
    created_dttm timestamptz NOT NULL DEFAULT now(),
    updated_dttm timestamptz NOT NULL DEFAULT now()
  )`,
  // Exactly one subject: a person or a venue, never both, never neither.
  sql`DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'chk_compliance_document_subject'
    ) THEN
      ALTER TABLE compliance_document
        ADD CONSTRAINT chk_compliance_document_subject
        CHECK (num_nonnulls(user_id, subject_store_location_id) = 1);
    END IF;
  END $$`,
  // A venue document's owning location IS its subject. The IS NOT NULL term is
  // load-bearing: without it, NULL = uuid yields NULL, which SATISFIES a CHECK.
  sql`DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'chk_compliance_document_venue_scope'
    ) THEN
      ALTER TABLE compliance_document
        ADD CONSTRAINT chk_compliance_document_venue_scope
        CHECK (
          subject_store_location_id IS NULL
          OR (store_location_id IS NOT NULL AND store_location_id = subject_store_location_id)
        );
    END IF;
  END $$`,
  // Daily expiry scan: "documents expiring in the alert window". Partial — null-expiry
  // documents are never scanned, so they stay out of the index.
  sql`CREATE INDEX IF NOT EXISTS idx_compliance_document_expiry ON compliance_document (expiry_date) WHERE expiry_date IS NOT NULL`,
  // Dashboard: "compliance counts for an org by status".
  sql`CREATE INDEX IF NOT EXISTS idx_compliance_document_org_status ON compliance_document (organisation_id, verification_status)`,
  // Dashboard tile: "documents for an org expiring in the next 30 days".
  sql`CREATE INDEX IF NOT EXISTS idx_compliance_document_org_expiry ON compliance_document (organisation_id, expiry_date) WHERE expiry_date IS NOT NULL`,
  // FK index: "all documents for one person".
  sql`CREATE INDEX IF NOT EXISTS idx_compliance_document_user ON compliance_document (user_id)`,
  // FK index: "all documents for one venue".
  sql`CREATE INDEX IF NOT EXISTS idx_compliance_document_subject_location ON compliance_document (subject_store_location_id)`,
  // FK index: "all documents at one location".
  sql`CREATE INDEX IF NOT EXISTS idx_compliance_document_location ON compliance_document (store_location_id)`,
  // Assignment gate + duplicate-upload guard. Partial so rows without a number
  // (or venue documents) do not collide.
  sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_document_unique ON compliance_document (user_id, document_type, document_number) WHERE user_id IS NOT NULL AND document_number IS NOT NULL`,
  // This script already ran against dev before storage_format existed above, so
  // the CREATE TABLE column list alone won't reach that copy — same pattern as
  // store_location.iana_timezone below.
  sql`ALTER TABLE compliance_document ADD COLUMN IF NOT EXISTS storage_format varchar(10)`,

  // -- document_expiry_rule ----------------------------------------------------
  sql`CREATE TABLE IF NOT EXISTS document_expiry_rule (
    document_expiry_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_type varchar(40) NOT NULL,
    jurisdiction varchar(3),
    validity_period_years integer,
    block_roster_on_expiry boolean NOT NULL DEFAULT false,
    training_provider_url varchar(500),
    effective_from date NOT NULL,
    effective_to date,
    source_citation varchar(500),
    notes text,
    created_dttm timestamptz NOT NULL DEFAULT now(),
    updated_dttm timestamptz NOT NULL DEFAULT now()
  )`,
  // Rule lookup: "the rule in force for this type and jurisdiction on date X".
  sql`CREATE INDEX IF NOT EXISTS idx_document_expiry_rule_lookup ON document_expiry_rule (document_type, jurisdiction, effective_from)`,

  // -- document_expiry_rule_alert_day ------------------------------------------
  sql`CREATE TABLE IF NOT EXISTS document_expiry_rule_alert_day (
    document_expiry_rule_id uuid NOT NULL REFERENCES document_expiry_rule(document_expiry_rule_id) ON DELETE CASCADE,
    days_before integer NOT NULL
  )`,
  // Composite PK: one alert per rule per offset. Leftmost column also serves the
  // FK ("all alert days for one rule") lookup.
  sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_document_expiry_rule_alert_day_pk ON document_expiry_rule_alert_day (document_expiry_rule_id, days_before)`,

  // -- document_access_log ------------------------------------------------------
  sql`CREATE TABLE IF NOT EXISTS document_access_log (
    document_access_log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    compliance_document_id uuid NOT NULL REFERENCES compliance_document(compliance_document_id) ON DELETE CASCADE,
    actor_user_id integer NOT NULL REFERENCES "user"(user_id),
    outcome varchar(10) NOT NULL,
    ip_address varchar(45),
    created_dttm timestamptz NOT NULL DEFAULT now()
  )`,
  // FK index: "access history for one document".
  sql`CREATE INDEX IF NOT EXISTS idx_document_access_log_document ON document_access_log (compliance_document_id)`,
  // FK index: "everything this user opened" — the breach-investigation query.
  sql`CREATE INDEX IF NOT EXISTS idx_document_access_log_actor ON document_access_log (actor_user_id)`,
  // Retention prune: "access-log rows older than the statutory window".
  sql`CREATE INDEX IF NOT EXISTS idx_document_access_log_created ON document_access_log (created_dttm)`,

  // -- organisation_required_document -------------------------------------------
  sql`CREATE TABLE IF NOT EXISTS organisation_required_document (
    organisation_id integer NOT NULL REFERENCES organisation(organisation_id),
    document_type varchar(40) NOT NULL,
    created_dttm timestamptz NOT NULL DEFAULT now()
  )`,
  // Composite PK: one requirement per org per document type. Leftmost column also
  // serves the FK ("all requirements for one org") lookup.
  sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_organisation_required_document_pk ON organisation_required_document (organisation_id, document_type)`,

  // -- store_location.iana_timezone ----------------------------------------------
  // Certificate expiry is a DATE, and "has it expired?" must be answered in the
  // venue's local day — see schema.ts comment on storeLocation.ianaTimezone.
  sql`ALTER TABLE store_location ADD COLUMN IF NOT EXISTS iana_timezone varchar(50) NOT NULL DEFAULT 'Australia/Melbourne'`,
  // Backfill from the existing free-text `state` column. VIC is left alone — it
  // already matches the column default.
  //
  // `state` is a free-text input with no dropdown (StoreLocationsSection.tsx), so
  // FULL NAMES are matched as well as abbreviations. That is not defensiveness for
  // its own sake: Brisbane (no DST), Perth (+8), Darwin (+9:30 no DST) and
  // Adelaide (+9:30 with DST) all differ from the Melbourne default, so a venue
  // that typed "Queensland" instead of "QLD" would silently compute certificate
  // expiry against the wrong calendar day. NSW/ACT/VIC/TAS share one DST calendar,
  // so a miss there is harmless — the others are not.
  //
  // TAS maps to Australia/Hobart, its real IANA zone. ACT has no distinct zone
  // (Australia/Canberra is a deprecated alias) so it correctly maps to Sydney.
  //
  // Only rows still holding the untouched default are updated, so re-running this
  // script never clobbers a value set some other way.
  sql`UPDATE store_location
    SET iana_timezone = CASE UPPER(TRIM(state))
      WHEN 'NSW' THEN 'Australia/Sydney'
      WHEN 'NEW SOUTH WALES' THEN 'Australia/Sydney'
      WHEN 'ACT' THEN 'Australia/Sydney'
      WHEN 'AUSTRALIAN CAPITAL TERRITORY' THEN 'Australia/Sydney'
      WHEN 'TAS' THEN 'Australia/Hobart'
      WHEN 'TASMANIA' THEN 'Australia/Hobart'
      WHEN 'QLD' THEN 'Australia/Brisbane'
      WHEN 'QUEENSLAND' THEN 'Australia/Brisbane'
      WHEN 'SA' THEN 'Australia/Adelaide'
      WHEN 'SOUTH AUSTRALIA' THEN 'Australia/Adelaide'
      WHEN 'WA' THEN 'Australia/Perth'
      WHEN 'WESTERN AUSTRALIA' THEN 'Australia/Perth'
      WHEN 'NT' THEN 'Australia/Darwin'
      WHEN 'NORTHERN TERRITORY' THEN 'Australia/Darwin'
    END
    WHERE iana_timezone = 'Australia/Melbourne'
      AND UPPER(TRIM(state)) IN (
        'NSW', 'NEW SOUTH WALES',
        'ACT', 'AUSTRALIAN CAPITAL TERRITORY',
        'TAS', 'TASMANIA',
        'QLD', 'QUEENSLAND',
        'SA', 'SOUTH AUSTRALIA',
        'WA', 'WESTERN AUSTRALIA',
        'NT', 'NORTHERN TERRITORY'
      )`,
];

async function main() {
  for (const stmt of statements) await db.execute(stmt);
  const tables = await db.execute(
    sql`select table_name from information_schema.tables where table_name in ('compliance_document','document_expiry_rule','document_expiry_rule_alert_day','document_access_log','organisation_required_document') order by table_name`,
  );
  const checks = await db.execute(
    sql`select conname from pg_constraint where conname in ('chk_compliance_document_subject','chk_compliance_document_venue_scope') order by conname`,
  );
  const col = await db.execute(
    sql`select column_name from information_schema.columns where table_name='store_location' and column_name='iana_timezone'`,
  );
  console.log("tables:", tables.map((r) => r.table_name).join(",") || "NONE");
  console.log("checks:", checks.map((r) => r.conname).join(",") || "NONE");
  console.log("store_location.iana_timezone:", col.length ? "present" : "MISSING");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

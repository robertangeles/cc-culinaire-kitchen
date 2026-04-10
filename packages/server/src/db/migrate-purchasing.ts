/**
 * One-time migration script for Purchasing & Receiving tables.
 * Run: npx tsx src/db/migrate-purchasing.ts
 *
 * Creates new tables and adds new columns to existing tables.
 * Safe to run multiple times — uses IF NOT EXISTS / IF NOT EXISTS checks.
 */

import { config } from "dotenv";
config({ path: "../../.env" });

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);

async function migrate() {
  console.log("Starting Purchasing & Receiving migration...\n");

  // ── Extend existing tables ──────────────────────────────────────

  // organisation: add purchasing_enabled_ind, default_spend_threshold
  await addColumnIfNotExists("organisation", "purchasing_enabled_ind", "boolean NOT NULL DEFAULT false");
  await addColumnIfNotExists("organisation", "default_spend_threshold", "numeric");

  // supplier: add delivery_window_start, delivery_window_end
  await addColumnIfNotExists("supplier", "delivery_window_start", "varchar(5)");
  await addColumnIfNotExists("supplier", "delivery_window_end", "varchar(5)");

  // purchase_order: add new columns
  await addColumnIfNotExists("purchase_order", "rejected_reason", "text");
  await addColumnIfNotExists("purchase_order", "total_value", "numeric");
  await addColumnIfNotExists("purchase_order", "pdf_url", "varchar(500)");
  await addColumnIfNotExists("purchase_order", "submitted_at", "timestamptz");
  await addColumnIfNotExists("purchase_order", "approved_at", "timestamptz");
  await addColumnIfNotExists("purchase_order", "sent_at", "timestamptz");

  // purchase_order_line: add new columns
  await addColumnIfNotExists("purchase_order_line", "actual_unit_cost", "numeric");
  await addColumnIfNotExists("purchase_order_line", "substituted_ingredient_id", "uuid REFERENCES ingredient(ingredient_id)");

  // Add index for overdue delivery checker
  await createIndexIfNotExists(
    "idx_po_status_delivery",
    "purchase_order",
    "status, expected_delivery_date",
  );

  // ── Create new tables ───────────────────────────────────────────

  await sql`
    CREATE TABLE IF NOT EXISTS receiving_session (
      session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      po_id uuid NOT NULL REFERENCES purchase_order(po_id),
      store_location_id uuid NOT NULL REFERENCES store_location(store_location_id),
      received_by_user_id integer NOT NULL REFERENCES "user"(user_id),
      status varchar(20) NOT NULL DEFAULT 'ACTIVE',
      started_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      notes text,
      created_dttm timestamptz NOT NULL DEFAULT now(),
      updated_dttm timestamptz NOT NULL DEFAULT now()
    )
  `;
  console.log("✓ receiving_session");

  await createIndexIfNotExists("idx_receiving_session_po", "receiving_session", "po_id");
  await createIndexIfNotExists("idx_receiving_session_location", "receiving_session", "store_location_id");
  await createIndexIfNotExists("idx_receiving_session_active", "receiving_session", "po_id, status");

  await sql`
    CREATE TABLE IF NOT EXISTS receiving_line (
      receiving_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id uuid NOT NULL REFERENCES receiving_session(session_id),
      po_line_id uuid NOT NULL REFERENCES purchase_order_line(line_id),
      ingredient_id uuid NOT NULL REFERENCES ingredient(ingredient_id),
      ordered_qty numeric NOT NULL,
      ordered_unit varchar(20) NOT NULL,
      received_qty numeric NOT NULL,
      actual_unit_cost numeric,
      status varchar(20) NOT NULL DEFAULT 'RECEIVED',
      created_dttm timestamptz NOT NULL DEFAULT now(),
      updated_dttm timestamptz NOT NULL DEFAULT now()
    )
  `;
  console.log("✓ receiving_line");

  await createIndexIfNotExists("idx_receiving_line_session", "receiving_line", "session_id");
  await createIndexIfNotExists("idx_receiving_line_po_line", "receiving_line", "po_line_id");

  await sql`
    CREATE TABLE IF NOT EXISTS receiving_discrepancy (
      discrepancy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      receiving_line_id uuid NOT NULL REFERENCES receiving_line(receiving_line_id),
      session_id uuid NOT NULL REFERENCES receiving_session(session_id),
      supplier_id uuid NOT NULL REFERENCES supplier(supplier_id),
      type varchar(20) NOT NULL,
      shortage_qty numeric,
      rejection_reason varchar(30),
      rejection_note text,
      po_unit_cost numeric,
      actual_unit_cost numeric,
      variance_amount numeric,
      variance_pct numeric,
      substituted_ingredient_id uuid REFERENCES ingredient(ingredient_id),
      is_resolved boolean NOT NULL DEFAULT false,
      resolved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  console.log("✓ receiving_discrepancy");

  await createIndexIfNotExists("idx_discrepancy_session", "receiving_discrepancy", "session_id");
  await createIndexIfNotExists("idx_discrepancy_supplier", "receiving_discrepancy", "supplier_id");
  await createIndexIfNotExists("idx_discrepancy_type", "receiving_discrepancy", "type");
  await createIndexIfNotExists("idx_discrepancy_resolved", "receiving_discrepancy", "is_resolved");

  await sql`
    CREATE TABLE IF NOT EXISTS discrepancy_photo (
      photo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      discrepancy_id uuid NOT NULL REFERENCES receiving_discrepancy(discrepancy_id),
      cloudinary_url varchar(500) NOT NULL,
      cloudinary_public_id varchar(200) NOT NULL,
      uploaded_by_user_id integer NOT NULL REFERENCES "user"(user_id),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  console.log("✓ discrepancy_photo");

  await createIndexIfNotExists("idx_photo_discrepancy", "discrepancy_photo", "discrepancy_id");

  await sql`
    CREATE TABLE IF NOT EXISTS credit_note (
      credit_note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      discrepancy_id uuid NOT NULL REFERENCES receiving_discrepancy(discrepancy_id),
      supplier_id uuid NOT NULL REFERENCES supplier(supplier_id),
      organisation_id integer NOT NULL REFERENCES organisation(organisation_id),
      credit_amount numeric NOT NULL,
      credit_reference varchar(100),
      notes text,
      created_by_user_id integer NOT NULL REFERENCES "user"(user_id),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  console.log("✓ credit_note");

  await createIndexIfNotExists("idx_credit_supplier", "credit_note", "supplier_id");
  await createIndexIfNotExists("idx_credit_org", "credit_note", "organisation_id");
  await createIndexIfNotExists("idx_credit_discrepancy", "credit_note", "discrepancy_id");

  await sql`
    CREATE TABLE IF NOT EXISTS spend_threshold (
      threshold_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id integer NOT NULL REFERENCES organisation(organisation_id),
      store_location_id uuid REFERENCES store_location(store_location_id),
      threshold_amount numeric NOT NULL,
      created_by_user_id integer NOT NULL REFERENCES "user"(user_id),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  console.log("✓ spend_threshold");

  await createIndexIfNotExists("idx_spend_threshold_org", "spend_threshold", "organisation_id");
  // Unique constraint: one threshold per org per location
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_spend_threshold_unique
    ON spend_threshold (organisation_id, COALESCE(store_location_id, '00000000-0000-0000-0000-000000000000'))
  `;
  console.log("  ✓ idx_spend_threshold_unique");

  await sql`
    CREATE TABLE IF NOT EXISTS notification (
      notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id integer NOT NULL REFERENCES organisation(organisation_id),
      recipient_user_id integer NOT NULL REFERENCES "user"(user_id),
      type varchar(30) NOT NULL,
      channel varchar(10) NOT NULL DEFAULT 'IN_APP',
      status varchar(20) NOT NULL DEFAULT 'PENDING',
      payload jsonb NOT NULL DEFAULT '{}',
      related_entity_type varchar(30),
      related_entity_id uuid,
      sent_at timestamptz,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  console.log("✓ notification");

  await createIndexIfNotExists("idx_notification_recipient_status", "notification", "recipient_user_id, status");
  await createIndexIfNotExists("idx_notification_org_type", "notification", "organisation_id, type");
  await createIndexIfNotExists("idx_notification_entity", "notification", "related_entity_type, related_entity_id");

  console.log("\n✅ Migration complete!");
  await sql.end();
}

// ── Helpers ──────────────────────────────────────────────────────────

async function addColumnIfNotExists(table: string, column: string, definition: string) {
  const [exists] = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = ${table} AND column_name = ${column}
  `;
  if (!exists) {
    await sql.unsafe(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
    console.log(`✓ ${table}.${column} added`);
  } else {
    console.log(`  ${table}.${column} already exists, skipping`);
  }
}

async function createIndexIfNotExists(indexName: string, table: string, columns: string) {
  const [exists] = await sql`
    SELECT 1 FROM pg_indexes WHERE indexname = ${indexName}
  `;
  if (!exists) {
    await sql.unsafe(`CREATE INDEX "${indexName}" ON "${table}" (${columns})`);
    console.log(`  ✓ ${indexName}`);
  } else {
    console.log(`  ${indexName} already exists`);
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

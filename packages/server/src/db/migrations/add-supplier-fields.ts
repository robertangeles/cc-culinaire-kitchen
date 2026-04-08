/**
 * Migration: Add operational fields to supplier + supplier_location table
 *
 * Run: npx tsx src/db/migrations/add-supplier-fields.ts
 */

import { db } from "../index.js";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("Starting supplier enhancement migration...");

  // 1. Add operational columns to supplier
  const supplierColumns = [
    { name: "supplier_category", type: "VARCHAR(50)" },
    { name: "payment_terms", type: "VARCHAR(50)" },
    { name: "ordering_method", type: "VARCHAR(50)" },
    { name: "delivery_days", type: "VARCHAR(100)" },
    { name: "currency", type: "VARCHAR(3) NOT NULL DEFAULT 'AUD'" },
  ];

  for (const col of supplierColumns) {
    await db.execute(
      sql.raw(`ALTER TABLE supplier ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`),
    );
  }
  console.log("  ✓ supplier columns added (category, payment, ordering, delivery, currency)");

  // 2. Create supplier_location table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS supplier_location (
      supplier_location_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      supplier_id           UUID NOT NULL REFERENCES supplier(supplier_id),
      store_location_id     UUID NOT NULL REFERENCES store_location(store_location_id),
      active_ind            BOOLEAN NOT NULL DEFAULT true,
      created_dttm          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  console.log("  ✓ supplier_location table created");

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_location_unique
    ON supplier_location(supplier_id, store_location_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_supplier_location_supplier
    ON supplier_location(supplier_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_supplier_location_store
    ON supplier_location(store_location_id)
  `);
  console.log("  ✓ supplier_location indexes created");

  console.log("\nMigration complete!");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

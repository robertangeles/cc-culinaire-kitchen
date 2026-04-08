/**
 * Migration: Add supplier table + enrich ingredient & location_ingredient tables
 *
 * New table: supplier (org-level vendor management)
 * Altered: ingredient (description, unitCost, 6 allergen flags)
 * Altered: location_ingredient (unitCost override, supplierId FK)
 *
 * Run: npx tsx src/db/migrations/add-ingredient-fields.ts
 */

import { db } from "../index.js";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("Starting ingredient model enhancement migration...");

  // 1. Create supplier table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS supplier (
      supplier_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id     INTEGER NOT NULL REFERENCES organisation(organisation_id),
      supplier_name       VARCHAR(200) NOT NULL,
      contact_name        VARCHAR(200),
      contact_email       VARCHAR(255),
      contact_phone       VARCHAR(50),
      lead_time_days      INTEGER,
      minimum_order_value NUMERIC,
      notes               TEXT,
      active_ind          BOOLEAN NOT NULL DEFAULT true,
      created_dttm        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_dttm        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  console.log("  ✓ supplier table created");

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_org_name
    ON supplier(organisation_id, supplier_name)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_supplier_org
    ON supplier(organisation_id)
  `);
  console.log("  ✓ supplier indexes created");

  // 2. Add new columns to ingredient
  const ingredientColumns = [
    { name: "description", type: "TEXT" },
    { name: "unit_cost", type: "NUMERIC" },
    { name: "par_level", type: "NUMERIC" },
    { name: "reorder_qty", type: "NUMERIC" },
    { name: "contains_dairy_ind", type: "BOOLEAN NOT NULL DEFAULT false" },
    { name: "contains_gluten_ind", type: "BOOLEAN NOT NULL DEFAULT false" },
    { name: "contains_nuts_ind", type: "BOOLEAN NOT NULL DEFAULT false" },
    { name: "contains_shellfish_ind", type: "BOOLEAN NOT NULL DEFAULT false" },
    { name: "contains_eggs_ind", type: "BOOLEAN NOT NULL DEFAULT false" },
    { name: "is_vegetarian_ind", type: "BOOLEAN NOT NULL DEFAULT false" },
  ];

  for (const col of ingredientColumns) {
    await db.execute(
      sql.raw(`ALTER TABLE ingredient ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`),
    );
  }
  console.log("  ✓ ingredient columns added (description, unitCost, 6 allergen flags)");

  // 3. Add new columns to location_ingredient
  await db.execute(sql`
    ALTER TABLE location_ingredient
    ADD COLUMN IF NOT EXISTS unit_cost NUMERIC
  `);
  await db.execute(sql`
    ALTER TABLE location_ingredient
    ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES supplier(supplier_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_loc_ingredient_supplier
    ON location_ingredient(supplier_id)
  `);
  console.log("  ✓ location_ingredient columns added (unitCost, supplierId)");

  console.log("\nMigration complete!");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

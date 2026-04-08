/**
 * Migration: Add ingredient_supplier junction table
 * Many-to-many: ingredients ↔ suppliers with cost/SKU per relationship.
 *
 * Run: npx tsx src/db/migrations/add-ingredient-supplier.ts
 */

import { db } from "../index.js";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("Starting ingredient_supplier junction table migration...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ingredient_supplier (
      ingredient_supplier_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ingredient_id           UUID NOT NULL REFERENCES ingredient(ingredient_id),
      supplier_id             UUID NOT NULL REFERENCES supplier(supplier_id),
      cost_per_unit           NUMERIC,
      supplier_item_code      VARCHAR(100),
      lead_time_days          INTEGER,
      minimum_order_qty       NUMERIC,
      preferred_ind           BOOLEAN NOT NULL DEFAULT false,
      active_ind              BOOLEAN NOT NULL DEFAULT true,
      created_dttm            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_dttm            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  console.log("  ✓ ingredient_supplier table created");

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ingredient_supplier_unique
    ON ingredient_supplier(ingredient_id, supplier_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_ingredient_supplier_ingredient
    ON ingredient_supplier(ingredient_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_ingredient_supplier_supplier
    ON ingredient_supplier(supplier_id)
  `);
  console.log("  ✓ indexes created");

  console.log("\nMigration complete!");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

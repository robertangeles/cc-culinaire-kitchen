/**
 * Migration: Wave 1 — Item types, FIFO modes, session types, inventory activation
 *
 * Altered: ingredient (item_type, fifo_applicable)
 * Altered: stock_take_session (session_type)
 * Altered: store_location (inventory_active)
 * New table: pending_catalog_request (unknown item requests from staff)
 *
 * Run: npx tsx src/db/migrations/add-wave1-columns.ts
 */

import { config } from "dotenv";
config({ path: "../../.env" });

import { db } from "../index.js";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("Starting Wave 1 migration...");

  // ── 1. ingredient: item_type + fifo_applicable ────────────────
  const ingredientColumns = [
    { name: "item_type", type: "VARCHAR(20) NOT NULL DEFAULT 'KITCHEN_INGREDIENT'" },
    { name: "fifo_applicable", type: "VARCHAR(20) NOT NULL DEFAULT 'ALWAYS'" },
  ];

  for (const col of ingredientColumns) {
    await db.execute(
      sql.raw(`ALTER TABLE ingredient ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`),
    );
  }
  console.log("  ✓ ingredient columns added (item_type, fifo_applicable)");

  // Index: filter ingredients by org + item_type
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_ingredient_item_type
    ON ingredient(organisation_id, item_type)
  `);
  console.log("  ✓ ingredient item_type index created");

  // ── 2. stock_take_session: session_type ────────────────────────
  await db.execute(sql`
    ALTER TABLE stock_take_session
    ADD COLUMN IF NOT EXISTS session_type VARCHAR(20) NOT NULL DEFAULT 'REGULAR'
  `);
  console.log("  ✓ stock_take_session column added (session_type)");

  // ── 3. store_location: inventory_active ────────────────────────
  await db.execute(sql`
    ALTER TABLE store_location
    ADD COLUMN IF NOT EXISTS inventory_active BOOLEAN NOT NULL DEFAULT false
  `);
  console.log("  ✓ store_location column added (inventory_active)");

  // ── 4. pending_catalog_request table ──────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pending_catalog_request (
      request_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id         INTEGER NOT NULL REFERENCES organisation(organisation_id),
      store_location_id       UUID NOT NULL REFERENCES store_location(store_location_id),
      requested_by_user_id    INTEGER NOT NULL REFERENCES "user"(user_id),
      item_name               TEXT NOT NULL,
      item_type               VARCHAR(20) NOT NULL DEFAULT 'KITCHEN_INGREDIENT',
      category                VARCHAR(50),
      base_unit               VARCHAR(20),
      counted_qty             NUMERIC,
      status                  VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      reviewed_by_user_id     INTEGER REFERENCES "user"(user_id),
      review_notes            TEXT,
      created_ingredient_id   UUID REFERENCES ingredient(ingredient_id),
      created_dttm            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_dttm            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  console.log("  ✓ pending_catalog_request table created");

  // Indexes for pending_catalog_request
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_pending_request_org
    ON pending_catalog_request(organisation_id, status)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_pending_request_location
    ON pending_catalog_request(store_location_id)
  `);
  console.log("  ✓ pending_catalog_request indexes created");

  console.log("\nWave 1 migration complete!");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

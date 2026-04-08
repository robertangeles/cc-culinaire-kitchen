/**
 * Migration: Create inventory system tables (Phase 1)
 *
 * Run: cd packages/server && npx tsx src/db/migrations/add-inventory-tables.ts
 */

import { config } from "dotenv";
config({ path: "../../.env" });

import { db } from "../index.js";
import { sql } from "drizzle-orm";

const statements = [
  // 1. ingredient
  sql`CREATE TABLE IF NOT EXISTS ingredient (
    ingredient_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id INTEGER NOT NULL REFERENCES "organisation"(organisation_id),
    ingredient_name TEXT NOT NULL,
    ingredient_category VARCHAR(50) NOT NULL,
    base_unit VARCHAR(20) NOT NULL,
    created_dttm TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_dttm TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_ingredient_org_name ON ingredient(organisation_id, ingredient_name)`,
  sql`CREATE INDEX IF NOT EXISTS idx_ingredient_org ON ingredient(organisation_id)`,

  // 2. location_ingredient
  sql`CREATE TABLE IF NOT EXISTS location_ingredient (
    location_ingredient_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingredient_id UUID NOT NULL REFERENCES ingredient(ingredient_id),
    store_location_id UUID NOT NULL REFERENCES store_location(store_location_id),
    par_level NUMERIC,
    reorder_qty NUMERIC,
    unit_override VARCHAR(20),
    category_override VARCHAR(50),
    active_ind BOOLEAN NOT NULL DEFAULT true,
    created_dttm TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_dttm TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_loc_ingredient_unique ON location_ingredient(ingredient_id, store_location_id)`,
  sql`CREATE INDEX IF NOT EXISTS idx_loc_ingredient_location ON location_ingredient(store_location_id)`,
  sql`CREATE INDEX IF NOT EXISTS idx_loc_ingredient_ingredient ON location_ingredient(ingredient_id)`,

  // 3. unit_conversion
  sql`CREATE TABLE IF NOT EXISTS unit_conversion (
    conversion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingredient_id UUID NOT NULL REFERENCES ingredient(ingredient_id),
    from_unit VARCHAR(20) NOT NULL,
    to_base_factor NUMERIC NOT NULL,
    created_dttm TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_conversion_unique ON unit_conversion(ingredient_id, from_unit)`,
  sql`CREATE INDEX IF NOT EXISTS idx_unit_conversion_ingredient ON unit_conversion(ingredient_id)`,

  // 4. stock_take_session
  sql`CREATE TABLE IF NOT EXISTS stock_take_session (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_location_id UUID NOT NULL REFERENCES store_location(store_location_id),
    organisation_id INTEGER NOT NULL REFERENCES "organisation"(organisation_id),
    session_status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    opened_by_user_id INTEGER NOT NULL REFERENCES "user"(user_id),
    approved_by_user_id INTEGER REFERENCES "user"(user_id),
    flag_reason TEXT,
    opened_dttm TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_dttm TIMESTAMPTZ,
    closed_dttm TIMESTAMPTZ,
    created_dttm TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_dttm TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  sql`CREATE INDEX IF NOT EXISTS idx_stock_take_session_location ON stock_take_session(store_location_id)`,
  sql`CREATE INDEX IF NOT EXISTS idx_stock_take_session_org ON stock_take_session(organisation_id)`,
  sql`CREATE INDEX IF NOT EXISTS idx_stock_take_session_active ON stock_take_session(store_location_id, session_status)`,

  // 5. stock_take_category
  sql`CREATE TABLE IF NOT EXISTS stock_take_category (
    category_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES stock_take_session(session_id),
    category_name VARCHAR(50) NOT NULL,
    category_status VARCHAR(20) NOT NULL DEFAULT 'NOT_STARTED',
    claimed_by_user_id INTEGER REFERENCES "user"(user_id),
    flag_reason TEXT,
    submitted_dttm TIMESTAMPTZ,
    created_dttm TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_dttm TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_take_category_unique ON stock_take_category(session_id, category_name)`,
  sql`CREATE INDEX IF NOT EXISTS idx_stock_take_category_session ON stock_take_category(session_id)`,

  // 6. stock_take_line
  sql`CREATE TABLE IF NOT EXISTS stock_take_line (
    line_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES stock_take_category(category_id),
    ingredient_id UUID NOT NULL REFERENCES ingredient(ingredient_id),
    counted_qty NUMERIC NOT NULL,
    counted_unit VARCHAR(20) NOT NULL,
    raw_qty NUMERIC NOT NULL,
    expected_qty NUMERIC,
    variance_qty NUMERIC,
    variance_pct NUMERIC,
    counted_by_user_id INTEGER NOT NULL REFERENCES "user"(user_id),
    counted_dttm TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_dttm TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_dttm TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_take_line_unique ON stock_take_line(category_id, ingredient_id)`,
  sql`CREATE INDEX IF NOT EXISTS idx_stock_take_line_category ON stock_take_line(category_id)`,
  sql`CREATE INDEX IF NOT EXISTS idx_stock_take_line_ingredient ON stock_take_line(ingredient_id)`,
  sql`CREATE INDEX IF NOT EXISTS idx_stock_take_line_user ON stock_take_line(counted_by_user_id)`,

  // 7. stock_level
  sql`CREATE TABLE IF NOT EXISTS stock_level (
    stock_level_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_location_id UUID NOT NULL REFERENCES store_location(store_location_id),
    ingredient_id UUID NOT NULL REFERENCES ingredient(ingredient_id),
    current_qty NUMERIC NOT NULL DEFAULT 0,
    last_counted_dttm TIMESTAMPTZ,
    last_counted_by_user_id INTEGER REFERENCES "user"(user_id),
    version INTEGER NOT NULL DEFAULT 0,
    created_dttm TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_dttm TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_level_unique ON stock_level(store_location_id, ingredient_id)`,
  sql`CREATE INDEX IF NOT EXISTS idx_stock_level_location ON stock_level(store_location_id)`,
  sql`CREATE INDEX IF NOT EXISTS idx_stock_level_ingredient ON stock_level(ingredient_id)`,
];

async function migrate() {
  console.log("Running inventory tables migration...\n");

  for (const stmt of statements) {
    try {
      await db.execute(stmt);
      // Extract table/index name from the SQL string for logging
      const raw = stmt.queryChunks?.map((c: any) => c.value ?? c).join("") ?? "";
      const name = raw.match(/(?:TABLE|INDEX)\s+IF NOT EXISTS\s+(\w+)/i)?.[1] ?? "statement";
      console.log(`✓ ${name}`);
    } catch (err: any) {
      if (err.code === "42P07" || err.code === "42710") {
        console.log(`· Already exists, skipping`);
      } else {
        console.error(`✗ Error: ${err.message}`);
      }
    }
  }

  console.log("\n✓ Inventory tables migration complete.");
  process.exit(0);
}

migrate();

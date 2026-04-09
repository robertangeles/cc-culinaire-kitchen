/**
 * Migration: Wave 2 — Consumption Log table
 *
 * New table: consumption_log (instant stock deduction entries)
 *
 * Run: npx tsx src/db/migrations/add-consumption-log.ts
 */

import { config } from "dotenv";
config({ path: "../../.env" });

import { db } from "../index.js";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("Starting Wave 2 migration (Consumption Log)...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS consumption_log (
      consumption_log_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id       INTEGER NOT NULL REFERENCES organisation(organisation_id),
      store_location_id     UUID NOT NULL REFERENCES store_location(store_location_id),
      ingredient_id         UUID NOT NULL REFERENCES ingredient(ingredient_id),
      user_id               INTEGER NOT NULL REFERENCES "user"(user_id),
      quantity              NUMERIC(10,3) NOT NULL,
      unit                  VARCHAR(20) NOT NULL,
      reason                VARCHAR(30) NOT NULL,
      notes                 TEXT,
      shift                 VARCHAR(20),
      logged_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_dttm          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_dttm          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  console.log("  ✓ consumption_log table created");

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_consumption_log_location
    ON consumption_log(store_location_id, logged_at DESC)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_consumption_log_org
    ON consumption_log(organisation_id, logged_at DESC)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_consumption_log_ingredient
    ON consumption_log(ingredient_id)
  `);
  console.log("  ✓ consumption_log indexes created");

  console.log("\nWave 2 migration complete!");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

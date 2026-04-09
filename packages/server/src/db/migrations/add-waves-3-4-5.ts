/**
 * Migration: Waves 3-5 — Purchase Orders, FIFO Batches, Transfers, Forecasts
 *
 * New tables: purchase_order, purchase_order_line, fifo_batch,
 *             inventory_transfer, inventory_transfer_line, forecast_recommendation
 *
 * Run: npx tsx src/db/migrations/add-waves-3-4-5.ts
 */

import { config } from "dotenv";
config({ path: "../../.env" });

import { db } from "../index.js";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("Starting Waves 3-4-5 migration...\n");

  // ── Wave 3: Purchase Orders ─────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS purchase_order (
      po_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id      INTEGER NOT NULL REFERENCES organisation(organisation_id),
      store_location_id    UUID NOT NULL REFERENCES store_location(store_location_id),
      supplier_id          UUID NOT NULL REFERENCES supplier(supplier_id),
      po_number            VARCHAR(50) NOT NULL,
      status               VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
      created_by_user_id   INTEGER NOT NULL REFERENCES "user"(user_id),
      approved_by_user_id  INTEGER REFERENCES "user"(user_id),
      notes                TEXT,
      expected_delivery_date TIMESTAMPTZ,
      created_dttm         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_dttm         TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_po_org_status ON purchase_order(organisation_id, status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_po_location ON purchase_order(store_location_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_order(supplier_id)`);
  console.log("  ✓ purchase_order table + indexes");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS purchase_order_line (
      line_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      po_id                UUID NOT NULL REFERENCES purchase_order(po_id),
      ingredient_id        UUID NOT NULL REFERENCES ingredient(ingredient_id),
      ordered_qty          NUMERIC NOT NULL,
      ordered_unit         VARCHAR(20) NOT NULL,
      received_qty         NUMERIC,
      received_unit        VARCHAR(20),
      unit_cost            NUMERIC,
      line_status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      received_by_user_id  INTEGER REFERENCES "user"(user_id),
      received_dttm        TIMESTAMPTZ,
      created_dttm         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_dttm         TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_po_line_po ON purchase_order_line(po_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_po_line_ingredient ON purchase_order_line(ingredient_id)`);
  console.log("  ✓ purchase_order_line table + indexes");

  // ── Wave 3: FIFO Batches ────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS fifo_batch (
      batch_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      store_location_id    UUID NOT NULL REFERENCES store_location(store_location_id),
      ingredient_id        UUID NOT NULL REFERENCES ingredient(ingredient_id),
      arrival_date         TIMESTAMPTZ NOT NULL,
      quantity_remaining   NUMERIC NOT NULL,
      original_quantity    NUMERIC NOT NULL,
      unit_cost            NUMERIC,
      source_po_line_id    UUID REFERENCES purchase_order_line(line_id),
      source_transfer_id   UUID,
      expiry_date          TIMESTAMPTZ,
      is_depleted          BOOLEAN NOT NULL DEFAULT false,
      created_dttm         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_dttm         TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_fifo_batch_location_item ON fifo_batch(store_location_id, ingredient_id, is_depleted)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_fifo_batch_po_line ON fifo_batch(source_po_line_id)`);
  console.log("  ✓ fifo_batch table + indexes");

  // ── Wave 4: Inter-location Transfers ────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS inventory_transfer (
      transfer_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id      INTEGER NOT NULL REFERENCES organisation(organisation_id),
      from_location_id     UUID NOT NULL REFERENCES store_location(store_location_id),
      to_location_id       UUID NOT NULL REFERENCES store_location(store_location_id),
      status               VARCHAR(20) NOT NULL DEFAULT 'INITIATED',
      initiated_by_user_id INTEGER NOT NULL REFERENCES "user"(user_id),
      sent_by_user_id      INTEGER REFERENCES "user"(user_id),
      received_by_user_id  INTEGER REFERENCES "user"(user_id),
      notes                TEXT,
      sent_dttm            TIMESTAMPTZ,
      received_dttm        TIMESTAMPTZ,
      created_dttm         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_dttm         TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_transfer_org_status ON inventory_transfer(organisation_id, status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_transfer_from ON inventory_transfer(from_location_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_transfer_to ON inventory_transfer(to_location_id)`);
  console.log("  ✓ inventory_transfer table + indexes");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS inventory_transfer_line (
      line_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      transfer_id          UUID NOT NULL REFERENCES inventory_transfer(transfer_id),
      ingredient_id        UUID NOT NULL REFERENCES ingredient(ingredient_id),
      sent_qty             NUMERIC NOT NULL,
      sent_unit            VARCHAR(20) NOT NULL,
      received_qty         NUMERIC,
      fifo_batch_id        UUID REFERENCES fifo_batch(batch_id),
      line_status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      created_dttm         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_dttm         TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_transfer_line_transfer ON inventory_transfer_line(transfer_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_transfer_line_ingredient ON inventory_transfer_line(ingredient_id)`);
  console.log("  ✓ inventory_transfer_line table + indexes");

  // ── Wave 5: AI Forecasting ──────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS forecast_recommendation (
      recommendation_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id      INTEGER NOT NULL REFERENCES organisation(organisation_id),
      store_location_id    UUID NOT NULL REFERENCES store_location(store_location_id),
      ingredient_id        UUID NOT NULL REFERENCES ingredient(ingredient_id),
      predicted_depletion_date TIMESTAMPTZ,
      days_remaining       INTEGER,
      suggested_order_qty  NUMERIC,
      confidence           NUMERIC,
      based_on_days        INTEGER,
      status               VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_dttm         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_dttm         TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_forecast_location_status ON forecast_recommendation(store_location_id, status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_forecast_ingredient ON forecast_recommendation(ingredient_id)`);
  console.log("  ✓ forecast_recommendation table + indexes");

  console.log("\nWaves 3-4-5 migration complete!");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

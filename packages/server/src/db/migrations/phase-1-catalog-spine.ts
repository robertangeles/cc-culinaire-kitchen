// @ts-nocheck
/**
 * Phase 1 of catalog-spine: schema changes that wire menu items + recipes
 * to the canonical Catalog and add the cost-driver foundation.
 *
 * Idempotent — uses IF NOT EXISTS / IF EXISTS guards. Re-runnable.
 *
 * Run:
 *   cd packages/server
 *   npx tsx src/db/migrations/phase-1-catalog-spine.ts
 *
 * Migrations applied:
 *   1. citext extension (locale-aware case-insensitive aliases)
 *   2. menu_item_ingredient.ingredient_id (nullable FK, NOT VALID first then VALIDATE)
 *   3. menu_item_ingredient.note (text)
 *   4. consumption_log.menu_item_id (nullable FK, ON DELETE SET NULL) — Phase 4 prep
 *   5. ingredient.preferred_unit_cost + preferred_supplier_id (denorm cols)
 *   6. location_ingredient.weighted_average_cost + wac_last_recomputed_at
 *   7. ingredient_alias table + indexes
 *   8. Postgres trigger keeping ingredient.preferred_unit_cost in sync with
 *      the row of ingredient_supplier where preferred_ind = TRUE
 *   9. One-time backfill of preferred_unit_cost for existing ingredients
 *  10. Indexes on the new columns
 *
 * The FK on menu_item_ingredient.ingredient_id uses `ADD CONSTRAINT ... NOT
 * VALID` then `VALIDATE CONSTRAINT` in a separate transaction. This avoids
 * the ACCESS EXCLUSIVE lock a default `ADD CONSTRAINT` would take while the
 * validator scans every existing row — important on a live multi-tenant
 * table.
 */
import { config } from "dotenv";
config({ path: "../../.env" });

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

async function run(label: string, query: string): Promise<void> {
  try {
    await sql.unsafe(query);
    console.log(`  ✓ ${label}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("already exists") ||
      msg.includes("duplicate") ||
      msg.includes("does not exist") /* DROP IF NOT EXISTS analogue */ === false &&
        msg.includes("DROP") === false
    ) {
      // Soft-pass on existence noise so re-runs are clean.
      if (msg.includes("already exists") || msg.includes("duplicate")) {
        console.log(`  ⊘ ${label} (already exists, skipped)`);
        return;
      }
    }
    if (msg.includes("already exists") || msg.includes("duplicate")) {
      console.log(`  ⊘ ${label} (already exists, skipped)`);
    } else {
      console.error(`  ✗ ${label}: ${msg}`);
      throw err;
    }
  }
}

console.log("\n🔄 Applying Phase 1 catalog-spine migrations...\n");

// ─────────────────────────────────────────────────────────────────────
// 1) citext extension
// ─────────────────────────────────────────────────────────────────────

await run(
  "Enable citext extension",
  `CREATE EXTENSION IF NOT EXISTS citext`,
);

// ─────────────────────────────────────────────────────────────────────
// 2) menu_item_ingredient: ingredient_id (nullable FK) + note
// ─────────────────────────────────────────────────────────────────────

await run(
  "Add ingredient_id column to menu_item_ingredient (no FK yet)",
  `ALTER TABLE menu_item_ingredient ADD COLUMN IF NOT EXISTS ingredient_id UUID`,
);

await run(
  "Add note column to menu_item_ingredient",
  `ALTER TABLE menu_item_ingredient ADD COLUMN IF NOT EXISTS note TEXT`,
);

// FK as NOT VALID first so the catalog scan happens online without ACCESS
// EXCLUSIVE on the menu_item_ingredient table for the validation phase.
await run(
  "Add FK constraint NOT VALID (online step)",
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'menu_item_ingredient_ingredient_id_fk'
     ) THEN
       ALTER TABLE menu_item_ingredient
         ADD CONSTRAINT menu_item_ingredient_ingredient_id_fk
         FOREIGN KEY (ingredient_id) REFERENCES ingredient(ingredient_id)
         ON DELETE SET NULL
         NOT VALID;
     END IF;
   END$$`,
);

await run(
  "VALIDATE FK constraint (separate tx, lighter lock)",
  `ALTER TABLE menu_item_ingredient
     VALIDATE CONSTRAINT menu_item_ingredient_ingredient_id_fk`,
);

await run(
  "Index menu_item_ingredient by ingredient_id",
  `CREATE INDEX IF NOT EXISTS idx_menu_item_ingredient_ingredient
     ON menu_item_ingredient(ingredient_id)`,
);

// ─────────────────────────────────────────────────────────────────────
// 3) consumption_log: menu_item_id (nullable, Phase 4 prep)
// ─────────────────────────────────────────────────────────────────────

await run(
  "Add menu_item_id column to consumption_log",
  `ALTER TABLE consumption_log ADD COLUMN IF NOT EXISTS menu_item_id UUID`,
);

await run(
  "Add FK constraint NOT VALID for consumption_log.menu_item_id",
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'consumption_log_menu_item_id_fk'
     ) THEN
       ALTER TABLE consumption_log
         ADD CONSTRAINT consumption_log_menu_item_id_fk
         FOREIGN KEY (menu_item_id) REFERENCES menu_item(menu_item_id)
         ON DELETE SET NULL
         NOT VALID;
     END IF;
   END$$`,
);

await run(
  "VALIDATE consumption_log.menu_item_id FK",
  `ALTER TABLE consumption_log
     VALIDATE CONSTRAINT consumption_log_menu_item_id_fk`,
);

await run(
  "Index consumption_log by menu_item_id + logged_at",
  `CREATE INDEX IF NOT EXISTS idx_consumption_log_menu_item
     ON consumption_log(menu_item_id, logged_at)`,
);

// ─────────────────────────────────────────────────────────────────────
// 4) ingredient: preferred_unit_cost + preferred_supplier_id (denorm)
// ─────────────────────────────────────────────────────────────────────

await run(
  "Add preferred_unit_cost to ingredient",
  `ALTER TABLE ingredient
     ADD COLUMN IF NOT EXISTS preferred_unit_cost NUMERIC(10,2)`,
);

await run(
  "Add preferred_supplier_id to ingredient (FK NOT VALID)",
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'ingredient' AND column_name = 'preferred_supplier_id'
     ) THEN
       ALTER TABLE ingredient ADD COLUMN preferred_supplier_id UUID;
     END IF;
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'ingredient_preferred_supplier_id_fk'
     ) THEN
       ALTER TABLE ingredient
         ADD CONSTRAINT ingredient_preferred_supplier_id_fk
         FOREIGN KEY (preferred_supplier_id) REFERENCES supplier(supplier_id)
         ON DELETE SET NULL
         NOT VALID;
     END IF;
   END$$`,
);

await run(
  "VALIDATE ingredient.preferred_supplier_id FK",
  `ALTER TABLE ingredient
     VALIDATE CONSTRAINT ingredient_preferred_supplier_id_fk`,
);

// ─────────────────────────────────────────────────────────────────────
// 5) location_ingredient: WAC columns
// ─────────────────────────────────────────────────────────────────────

await run(
  "Add weighted_average_cost to location_ingredient",
  `ALTER TABLE location_ingredient
     ADD COLUMN IF NOT EXISTS weighted_average_cost NUMERIC(10,4)`,
);

await run(
  "Add wac_last_recomputed_at to location_ingredient",
  `ALTER TABLE location_ingredient
     ADD COLUMN IF NOT EXISTS wac_last_recomputed_at TIMESTAMPTZ`,
);

// ─────────────────────────────────────────────────────────────────────
// 6) ingredient_alias table
// ─────────────────────────────────────────────────────────────────────

await run(
  "Create ingredient_alias table",
  `CREATE TABLE IF NOT EXISTS ingredient_alias (
     alias_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     organisation_id INTEGER NOT NULL REFERENCES organisation(organisation_id),
     ingredient_id UUID NOT NULL REFERENCES ingredient(ingredient_id) ON DELETE CASCADE,
     alias_text CITEXT NOT NULL,
     created_by_user_id INTEGER NOT NULL REFERENCES "user"(user_id),
     created_dttm TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
);

await run(
  "Unique alias text per org (citext = locale-aware case-insensitive)",
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ingredient_alias_org_text
     ON ingredient_alias(organisation_id, alias_text)`,
);

await run(
  "Index ingredient_alias by ingredient_id",
  `CREATE INDEX IF NOT EXISTS idx_ingredient_alias_ingredient
     ON ingredient_alias(ingredient_id)`,
);

await run(
  "Index ingredient_alias by organisation_id",
  `CREATE INDEX IF NOT EXISTS idx_ingredient_alias_org
     ON ingredient_alias(organisation_id)`,
);

// ─────────────────────────────────────────────────────────────────────
// 7) Trigger: keep ingredient.preferred_unit_cost in sync
// ─────────────────────────────────────────────────────────────────────

await run(
  "Create or replace fn_recompute_preferred_supplier_cost",
  `CREATE OR REPLACE FUNCTION fn_recompute_preferred_supplier_cost(p_ingredient_id UUID)
     RETURNS VOID
     LANGUAGE plpgsql
   AS $$
   DECLARE
     v_supplier_id UUID;
     v_unit_cost NUMERIC(10,2);
   BEGIN
     SELECT supplier_id, cost_per_unit
       INTO v_supplier_id, v_unit_cost
       FROM ingredient_supplier
      WHERE ingredient_id = p_ingredient_id
        AND preferred_ind = TRUE
      ORDER BY ingredient_supplier_id
      LIMIT 1;

     UPDATE ingredient
        SET preferred_unit_cost = v_unit_cost,
            preferred_supplier_id = v_supplier_id,
            updated_dttm = now()
      WHERE ingredient_id = p_ingredient_id;
   END;
   $$`,
);

await run(
  "Create or replace trg_ingredient_supplier_preferred_cost (statement-level fn)",
  `CREATE OR REPLACE FUNCTION trg_ingredient_supplier_preferred_cost()
     RETURNS TRIGGER
     LANGUAGE plpgsql
   AS $$
   BEGIN
     IF TG_OP = 'DELETE' THEN
       PERFORM fn_recompute_preferred_supplier_cost(OLD.ingredient_id);
       RETURN OLD;
     ELSE
       PERFORM fn_recompute_preferred_supplier_cost(NEW.ingredient_id);
       -- If the preferred row moved between ingredient_ids (rare), recompute
       -- the previous owner too.
       IF TG_OP = 'UPDATE' AND OLD.ingredient_id IS DISTINCT FROM NEW.ingredient_id THEN
         PERFORM fn_recompute_preferred_supplier_cost(OLD.ingredient_id);
       END IF;
       RETURN NEW;
     END IF;
   END;
   $$`,
);

await run(
  "Drop existing trigger before re-create (idempotency)",
  `DROP TRIGGER IF EXISTS trg_ingredient_supplier_preferred_cost ON ingredient_supplier`,
);

await run(
  "Attach trigger to ingredient_supplier (AFTER INSERT/UPDATE/DELETE)",
  `CREATE TRIGGER trg_ingredient_supplier_preferred_cost
     AFTER INSERT OR UPDATE OR DELETE ON ingredient_supplier
     FOR EACH ROW
     EXECUTE FUNCTION trg_ingredient_supplier_preferred_cost()`,
);

// ─────────────────────────────────────────────────────────────────────
// 8) One-time backfill of preferred_unit_cost
// ─────────────────────────────────────────────────────────────────────

await run(
  "Backfill ingredient.preferred_unit_cost from ingredient_supplier (preferred_ind = TRUE)",
  `UPDATE ingredient i
      SET preferred_unit_cost = sub.cost_per_unit,
          preferred_supplier_id = sub.supplier_id,
          updated_dttm = now()
     FROM (
       SELECT DISTINCT ON (ingredient_id)
              ingredient_id,
              supplier_id,
              cost_per_unit
         FROM ingredient_supplier
        WHERE preferred_ind = TRUE
        ORDER BY ingredient_id, ingredient_supplier_id
     ) sub
    WHERE i.ingredient_id = sub.ingredient_id
      AND (
        i.preferred_unit_cost IS DISTINCT FROM sub.cost_per_unit
        OR i.preferred_supplier_id IS DISTINCT FROM sub.supplier_id
      )`,
);

console.log("\n✅ Phase 1 migrations complete.\n");

await sql.end();
process.exit(0);

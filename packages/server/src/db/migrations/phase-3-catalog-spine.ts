// @ts-nocheck
/**
 * Phase 3 of catalog-spine: operational features that compound on the
 * Phase 1 foundation.
 *
 *  1. Allergen rollup denormalised onto menu_item.contains_*_ind.
 *     Postgres trigger on menu_item_ingredient (INSERT/UPDATE of
 *     ingredient_id / DELETE) recomputes the affected menu_item's flags.
 *  2. Stale-cost flag on menu_item_ingredient.cost_stale_ind.
 *     Trigger on UPDATE of ingredient.preferred_unit_cost flips every
 *     linked menu_item_ingredient row's flag → TRUE.
 *  3. Per-location costing is service-side only — no schema change here.
 *
 * Idempotent — IF NOT EXISTS / OR REPLACE on every statement.
 *
 * Run:
 *   cd packages/server
 *   npx tsx src/db/migrations/phase-3-catalog-spine.ts
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
    if (msg.includes("already exists") || msg.includes("duplicate")) {
      console.log(`  ⊘ ${label} (already exists, skipped)`);
    } else {
      console.error(`  ✗ ${label}: ${msg}`);
      throw err;
    }
  }
}

console.log("\n🔄 Applying Phase 3 catalog-spine migrations...\n");

// ─────────────────────────────────────────────────────────────────────
// 1) Schema: allergen denorm columns on menu_item
// ─────────────────────────────────────────────────────────────────────

for (const col of [
  "contains_dairy_ind",
  "contains_gluten_ind",
  "contains_nuts_ind",
  "contains_shellfish_ind",
  "contains_eggs_ind",
  "is_vegetarian_ind",
]) {
  await run(
    `Add ${col} to menu_item`,
    `ALTER TABLE menu_item ADD COLUMN IF NOT EXISTS ${col} BOOLEAN NOT NULL DEFAULT FALSE`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// 2) Schema: stale-cost flag on menu_item_ingredient
// ─────────────────────────────────────────────────────────────────────

await run(
  "Add cost_stale_ind to menu_item_ingredient",
  `ALTER TABLE menu_item_ingredient ADD COLUMN IF NOT EXISTS cost_stale_ind BOOLEAN NOT NULL DEFAULT FALSE`,
);

await run(
  "Add cost_stale_at to menu_item_ingredient",
  `ALTER TABLE menu_item_ingredient ADD COLUMN IF NOT EXISTS cost_stale_at TIMESTAMPTZ`,
);

// Index for the "give me all stale rows for a menu item" Refresh-all read.
await run(
  "Index menu_item_ingredient by cost_stale_ind (partial)",
  `CREATE INDEX IF NOT EXISTS idx_menu_item_ingredient_stale
     ON menu_item_ingredient(menu_item_id) WHERE cost_stale_ind = TRUE`,
);

// ─────────────────────────────────────────────────────────────────────
// 3) Trigger function: recompute menu_item allergens
// ─────────────────────────────────────────────────────────────────────

await run(
  "Create or replace fn_recompute_menu_item_allergens",
  `CREATE OR REPLACE FUNCTION fn_recompute_menu_item_allergens(p_menu_item_id UUID)
     RETURNS VOID
     LANGUAGE plpgsql
   AS $$
   BEGIN
     UPDATE menu_item m
        SET contains_dairy_ind     = COALESCE((SELECT bool_or(i.contains_dairy_ind)
                                                  FROM menu_item_ingredient mi
                                                  JOIN ingredient i ON i.ingredient_id = mi.ingredient_id
                                                 WHERE mi.menu_item_id = p_menu_item_id), FALSE),
            contains_gluten_ind    = COALESCE((SELECT bool_or(i.contains_gluten_ind)
                                                  FROM menu_item_ingredient mi
                                                  JOIN ingredient i ON i.ingredient_id = mi.ingredient_id
                                                 WHERE mi.menu_item_id = p_menu_item_id), FALSE),
            contains_nuts_ind      = COALESCE((SELECT bool_or(i.contains_nuts_ind)
                                                  FROM menu_item_ingredient mi
                                                  JOIN ingredient i ON i.ingredient_id = mi.ingredient_id
                                                 WHERE mi.menu_item_id = p_menu_item_id), FALSE),
            contains_shellfish_ind = COALESCE((SELECT bool_or(i.contains_shellfish_ind)
                                                  FROM menu_item_ingredient mi
                                                  JOIN ingredient i ON i.ingredient_id = mi.ingredient_id
                                                 WHERE mi.menu_item_id = p_menu_item_id), FALSE),
            contains_eggs_ind      = COALESCE((SELECT bool_or(i.contains_eggs_ind)
                                                  FROM menu_item_ingredient mi
                                                  JOIN ingredient i ON i.ingredient_id = mi.ingredient_id
                                                 WHERE mi.menu_item_id = p_menu_item_id), FALSE),
            -- A dish is vegetarian only if EVERY linked ingredient is vegetarian.
            -- Free-text rows (ingredient_id IS NULL) are skipped — they have no
            -- Catalog data; the chef should link them or set the flag manually.
            -- COALESCE to FALSE for menu items with zero linked ingredients
            -- (better default than "vegetarian by accident").
            is_vegetarian_ind      = COALESCE((SELECT bool_and(i.is_vegetarian_ind)
                                                  FROM menu_item_ingredient mi
                                                  JOIN ingredient i ON i.ingredient_id = mi.ingredient_id
                                                 WHERE mi.menu_item_id = p_menu_item_id), FALSE),
            updated_dttm = now()
      WHERE m.menu_item_id = p_menu_item_id;
   END;
   $$`,
);

await run(
  "Create or replace trg_menu_item_ingredient_allergen_rollup (row trigger fn)",
  `CREATE OR REPLACE FUNCTION trg_menu_item_ingredient_allergen_rollup()
     RETURNS TRIGGER
     LANGUAGE plpgsql
   AS $$
   BEGIN
     IF TG_OP = 'DELETE' THEN
       PERFORM fn_recompute_menu_item_allergens(OLD.menu_item_id);
       RETURN OLD;
     ELSIF TG_OP = 'UPDATE' AND OLD.menu_item_id IS DISTINCT FROM NEW.menu_item_id THEN
       PERFORM fn_recompute_menu_item_allergens(OLD.menu_item_id);
       PERFORM fn_recompute_menu_item_allergens(NEW.menu_item_id);
       RETURN NEW;
     ELSE
       PERFORM fn_recompute_menu_item_allergens(NEW.menu_item_id);
       RETURN NEW;
     END IF;
   END;
   $$`,
);

await run(
  "Drop existing allergen trigger before re-create (idempotency)",
  `DROP TRIGGER IF EXISTS trg_menu_item_ingredient_allergen_rollup ON menu_item_ingredient`,
);

await run(
  "Attach trigger to menu_item_ingredient (AFTER INSERT/UPDATE/DELETE)",
  `CREATE TRIGGER trg_menu_item_ingredient_allergen_rollup
     AFTER INSERT OR UPDATE OR DELETE ON menu_item_ingredient
     FOR EACH ROW
     EXECUTE FUNCTION trg_menu_item_ingredient_allergen_rollup()`,
);

// ─────────────────────────────────────────────────────────────────────
// 4) Trigger: stale-cost flag on ingredient.preferred_unit_cost change
// ─────────────────────────────────────────────────────────────────────

await run(
  "Create or replace trg_ingredient_preferred_cost_stale (row trigger fn)",
  `CREATE OR REPLACE FUNCTION trg_ingredient_preferred_cost_stale()
     RETURNS TRIGGER
     LANGUAGE plpgsql
   AS $$
   BEGIN
     IF TG_OP = 'UPDATE'
        AND OLD.preferred_unit_cost IS DISTINCT FROM NEW.preferred_unit_cost
     THEN
       UPDATE menu_item_ingredient
          SET cost_stale_ind = TRUE,
              cost_stale_at  = now()
        WHERE ingredient_id = NEW.ingredient_id
          AND cost_stale_ind = FALSE;
     END IF;
     RETURN NEW;
   END;
   $$`,
);

await run(
  "Drop existing stale-cost trigger before re-create (idempotency)",
  `DROP TRIGGER IF EXISTS trg_ingredient_preferred_cost_stale ON ingredient`,
);

await run(
  "Attach trigger to ingredient (AFTER UPDATE OF preferred_unit_cost)",
  `CREATE TRIGGER trg_ingredient_preferred_cost_stale
     AFTER UPDATE OF preferred_unit_cost ON ingredient
     FOR EACH ROW
     EXECUTE FUNCTION trg_ingredient_preferred_cost_stale()`,
);

// ─────────────────────────────────────────────────────────────────────
// 5) One-time backfill: recompute allergens for every existing menu_item
// ─────────────────────────────────────────────────────────────────────

await run(
  "Backfill menu_item allergen flags from existing linked ingredients",
  `DO $$
   DECLARE
     mi_id UUID;
   BEGIN
     FOR mi_id IN SELECT menu_item_id FROM menu_item LOOP
       PERFORM fn_recompute_menu_item_allergens(mi_id);
     END LOOP;
   END
   $$`,
);

console.log("\n✅ Phase 3 migrations complete.\n");

await sql.end();
process.exit(0);

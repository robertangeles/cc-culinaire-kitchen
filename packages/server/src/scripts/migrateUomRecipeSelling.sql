-- Migration: kitchen-unit UOM model + recipe-based selling (PR #75)
-- Derived from the dev database's live definitions (information_schema + pg_indexes +
-- pg_constraint) on 2026-07-15. Idempotent — safe to re-run. Additive only: no drops,
-- no rewrites, no locks beyond brief ACCESS EXCLUSIVE on ALTER TABLE (instant for
-- nullable columns without defaults).
--
-- Apply: psql "$PROD_DATABASE_URL" -f packages/server/src/scripts/migrateUomRecipeSelling.sql

BEGIN;

-- Sale header: one row per recorded sale event (recordSale / CSV import / FOH direct)
CREATE TABLE IF NOT EXISTS sale (
  sale_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   integer NOT NULL REFERENCES organisation(organisation_id),
  menu_item_id      uuid NOT NULL REFERENCES menu_item(menu_item_id),
  store_location_id uuid NOT NULL REFERENCES store_location(store_location_id),
  qty_sold          numeric(10,3) NOT NULL,
  source            varchar(20) NOT NULL,
  idempotency_key   varchar(120),
  sold_at           timestamptz NOT NULL,
  voided_at         timestamptz,
  voided_by         integer REFERENCES "user"(user_id),
  created_by        integer REFERENCES "user"(user_id),
  created_dttm      timestamptz NOT NULL DEFAULT now()
);
-- duplicate-submission guard, per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_idempotency
  ON sale (organisation_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- org/location sales listings ordered by time
CREATE INDEX IF NOT EXISTS idx_sale_org      ON sale (organisation_id, sold_at);
CREATE INDEX IF NOT EXISTS idx_sale_location ON sale (store_location_id, sold_at);
-- FK index (units_sold rollups per menu item)
CREATE INDEX IF NOT EXISTS idx_sale_menu_item ON sale (menu_item_id);

-- Ingredient: purchase packaging + content equivalence (1 bottle = 750 mL)
ALTER TABLE ingredient ADD COLUMN IF NOT EXISTS purchase_unit varchar(20);
ALTER TABLE ingredient ADD COLUMN IF NOT EXISTS content_qty   numeric(10,3);
ALTER TABLE ingredient ADD COLUMN IF NOT EXISTS content_unit  varchar(20);

-- Consumption log: kitchen-unit truth for aggregations + sale linkage
ALTER TABLE consumption_log ADD COLUMN IF NOT EXISTS base_qty numeric(12,4);
ALTER TABLE consumption_log ADD COLUMN IF NOT EXISTS sale_id  uuid REFERENCES sale(sale_id);
-- FK index (void path reads depletions by sale)
CREATE INDEX IF NOT EXISTS idx_consumption_log_sale ON consumption_log (sale_id);

-- Menu item: hidden 1:1 link for FOH consumables sold as-is
ALTER TABLE menu_item ADD COLUMN IF NOT EXISTS linked_ingredient_id uuid REFERENCES ingredient(ingredient_id);
-- race-safe one-link-per-ingredient-per-user
CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_item_linked_ingredient
  ON menu_item (user_id, linked_ingredient_id) WHERE linked_ingredient_id IS NOT NULL;

COMMIT;

-- Migration: storage areas + stock movements (B1 of docs/specs/storage-areas-count-sheets.md)
-- Idempotent — safe to re-run. Additive only: no drops, no rewrites, no locks beyond brief
-- ACCESS EXCLUSIVE on CREATE TABLE.
--
-- Step 1a only. The stock-take columns (session_mode, spot_storage_area_id, and the
-- storage_area_id columns on stock_take_category / stock_take_line) ship in B2 as step 1b —
-- they are useless until AREA-mode counting exists, and B2 is the branch that changes stock
-- writes, so it carries them.
--
-- drizzle-kit push cannot be used on this database (pre-existing bench_channel drift +
-- pg_stat_statements_info abort — see wiki/synthesis/schema-drift-may-2026.md).
-- Apply: psql "$DEV_DATABASE_URL" -f packages/server/src/scripts/migrateStorageAreas.sql
-- Same script is the prod apply artifact later.

BEGIN;

-- A named place within ONE site (Stock Room, Bar, FOH Counter, Walk-in).
-- Areas organise the stocktake walk and hold per-area pars. They are NOT a stock ledger:
-- stock_level stays keyed (store_location_id, ingredient_id) and is untouched by this file.
CREATE TABLE IF NOT EXISTS storage_area (
  storage_area_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   integer NOT NULL REFERENCES organisation(organisation_id),
  store_location_id uuid NOT NULL REFERENCES store_location(store_location_id),
  area_name         varchar(50) NOT NULL,
  sort_order        integer NOT NULL DEFAULT 0,
  active_ind        boolean NOT NULL DEFAULT true,
  created_dttm      timestamptz NOT NULL DEFAULT now(),
  updated_dttm      timestamptz NOT NULL DEFAULT now(),
  -- 'Unassigned' is the reserved sentinel for the AREA-mode bucket that catches items
  -- belonging to no area. A real area by that name would make the bucket ambiguous.
  CONSTRAINT storage_area_name_not_reserved CHECK (area_name <> 'Unassigned'),
  -- One area name per site. AREA-mode stock-take category names are area names, and
  -- idx_stock_take_category_unique(session_id, category_name) depends on this holding.
  CONSTRAINT storage_area_name_unique UNIQUE (store_location_id, area_name)
);
-- FK index: "list the areas at this location" — the areas admin + every AREA-mode session open
CREATE INDEX IF NOT EXISTS idx_storage_area_location ON storage_area (store_location_id);
-- FK index: org-scoped area listings + tenant guard lookups
CREATE INDEX IF NOT EXISTS idx_storage_area_org ON storage_area (organisation_id);

-- Which areas an item lives in. An item can be on several sheets (wine: Stock Room + Bar);
-- its per-area counts SUM to the venue count at approval.
CREATE TABLE IF NOT EXISTS ingredient_storage_area (
  ingredient_storage_area_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id              uuid NOT NULL REFERENCES ingredient(ingredient_id),
  storage_area_id            uuid NOT NULL REFERENCES storage_area(storage_area_id),
  -- In the item's kitchen unit (= ingredient.base_unit), following the
  -- location_ingredient.par_level precedent. Drives the restock list: par - last count.
  area_par_level             numeric(10,3),
  -- Shelf-to-sheet order: the sequence the counter physically walks the shelf.
  sort_order                 integer NOT NULL DEFAULT 0,
  created_dttm               timestamptz NOT NULL DEFAULT now(),
  updated_dttm               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingredient_storage_area_unique UNIQUE (ingredient_id, storage_area_id)
);
-- FK index: "what's on this area's count sheet" — drives every AREA-mode sheet render
CREATE INDEX IF NOT EXISTS idx_ingredient_storage_area_area ON ingredient_storage_area (storage_area_id);
-- FK index: "which areas is this item in" — the ingredient modal's area chips
CREATE INDEX IF NOT EXISTS idx_ingredient_storage_area_ingredient ON ingredient_storage_area (ingredient_id);

-- Audit trail for physical moves between areas. ZERO stock effect BY DESIGN: the bottles are
-- still on site and still sellable, so venue stock must not change. This table exists so
-- "restocked the bar" stops being expressed as "consumed 4 bottles" (which double-deducts at
-- the sale and invents yield variance).
CREATE TABLE IF NOT EXISTS stock_movement (
  stock_movement_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      integer NOT NULL REFERENCES organisation(organisation_id),
  store_location_id    uuid NOT NULL REFERENCES store_location(store_location_id),
  ingredient_id        uuid NOT NULL REFERENCES ingredient(ingredient_id),
  from_storage_area_id uuid NOT NULL REFERENCES storage_area(storage_area_id),
  to_storage_area_id   uuid NOT NULL REFERENCES storage_area(storage_area_id),
  quantity             numeric(10,3) NOT NULL,
  unit                 varchar(20) NOT NULL,
  -- Resolver-converted at insert via resolveToBase, mirroring consumption_log.base_qty.
  base_qty             numeric(12,4) NOT NULL,
  user_id              integer NOT NULL REFERENCES "user"(user_id),
  notes                text,
  -- Domain event time (cf. consumption_log.logged_at); created/updated track the row itself.
  moved_at             timestamptz NOT NULL DEFAULT now(),
  created_dttm         timestamptz NOT NULL DEFAULT now(),
  updated_dttm         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_movement_qty_positive CHECK (quantity > 0),
  CONSTRAINT stock_movement_areas_differ CHECK (from_storage_area_id <> to_storage_area_id)
);
-- FK index: the item transaction feed reads movements per ingredient, newest first
CREATE INDEX IF NOT EXISTS idx_stock_movement_ingredient ON stock_movement (ingredient_id, moved_at);
-- FK index: "movements at this location" listing, newest first
CREATE INDEX IF NOT EXISTS idx_stock_movement_location ON stock_movement (store_location_id, moved_at);
-- FK index: org-scoped tenant guard lookups
CREATE INDEX IF NOT EXISTS idx_stock_movement_org ON stock_movement (organisation_id);
-- FK index: "what moved out of / into this area"
CREATE INDEX IF NOT EXISTS idx_stock_movement_from_area ON stock_movement (from_storage_area_id);
CREATE INDEX IF NOT EXISTS idx_stock_movement_to_area ON stock_movement (to_storage_area_id);
-- FK index: user_id, for the audit trail ("who moved what")
CREATE INDEX IF NOT EXISTS idx_stock_movement_user ON stock_movement (user_id);

COMMIT;

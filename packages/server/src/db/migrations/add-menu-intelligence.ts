// @ts-nocheck
import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL);

await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS menu_item (
    menu_item_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             INTEGER NOT NULL,
    name                VARCHAR(200) NOT NULL,
    category            VARCHAR(100) NOT NULL,
    selling_price       NUMERIC(10,2) NOT NULL,
    food_cost           NUMERIC(10,2),
    food_cost_pct       NUMERIC(5,2),
    contribution_margin NUMERIC(10,2),
    units_sold          INTEGER NOT NULL DEFAULT 0,
    menu_mix_pct        NUMERIC(5,2),
    classification      VARCHAR(20) NOT NULL DEFAULT 'unclassified',
    period_start        DATE,
    period_end          DATE,
    created_dttm        TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_dttm        TIMESTAMP NOT NULL DEFAULT NOW()
  )
`);
await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_menu_item_user ON menu_item(user_id)`);

await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS menu_item_ingredient (
    id                  SERIAL PRIMARY KEY,
    menu_item_id        UUID NOT NULL REFERENCES menu_item(menu_item_id) ON DELETE CASCADE,
    ingredient_name     VARCHAR(200) NOT NULL,
    quantity            NUMERIC(10,3) NOT NULL,
    unit                VARCHAR(20) NOT NULL,
    unit_cost           NUMERIC(10,2) NOT NULL,
    yield_pct           NUMERIC(5,2) NOT NULL DEFAULT 100,
    line_cost           NUMERIC(10,2),
    created_dttm        TIMESTAMP NOT NULL DEFAULT NOW()
  )
`);
await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_menu_ingredient_item ON menu_item_ingredient(menu_item_id)`);

await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS menu_category_setting (
    id                    SERIAL PRIMARY KEY,
    user_id               INTEGER NOT NULL,
    category_name         VARCHAR(100) NOT NULL,
    target_food_cost_pct  NUMERIC(5,2) NOT NULL DEFAULT 30,
    created_dttm          TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_dttm          TIMESTAMP NOT NULL DEFAULT NOW()
  )
`);
await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_cat_user ON menu_category_setting(user_id, category_name)`);

console.log("Created menu_item, menu_item_ingredient, and menu_category_setting tables");
await sql.end();

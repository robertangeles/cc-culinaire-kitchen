/**
 * One-off: apply the Purchasing P1 order-guide schema to the target DB.
 * Idempotent (IF NOT EXISTS). Mirrors the additive changes in schema.ts so the
 * next `drizzle-kit push` introspects a matching state. Run:
 *   ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/applyOrderGuideSchema.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

const statements = [
  sql`CREATE TABLE IF NOT EXISTS order_guide (
    order_guide_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id integer NOT NULL REFERENCES organisation(organisation_id),
    store_location_id uuid REFERENCES store_location(store_location_id),
    supplier_id uuid NOT NULL REFERENCES supplier(supplier_id),
    name varchar(100) NOT NULL,
    active_ind boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    created_by_user_id integer NOT NULL REFERENCES "user"(user_id),
    created_dttm timestamptz NOT NULL DEFAULT now(),
    updated_dttm timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE INDEX IF NOT EXISTS idx_order_guide_org_location ON order_guide (organisation_id, store_location_id)`,
  sql`CREATE INDEX IF NOT EXISTS idx_order_guide_supplier ON order_guide (supplier_id)`,
  sql`CREATE TABLE IF NOT EXISTS order_guide_item (
    order_guide_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_guide_id uuid NOT NULL REFERENCES order_guide(order_guide_id),
    ingredient_id uuid NOT NULL REFERENCES ingredient(ingredient_id),
    default_order_qty numeric,
    default_purchase_unit varchar(20),
    sort_order integer NOT NULL DEFAULT 0,
    created_dttm timestamptz NOT NULL DEFAULT now(),
    updated_dttm timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_order_guide_item_unique ON order_guide_item (order_guide_id, ingredient_id)`,
  sql`CREATE INDEX IF NOT EXISTS idx_order_guide_item_ingredient ON order_guide_item (ingredient_id)`,
  sql`ALTER TABLE location_ingredient
    ADD COLUMN IF NOT EXISTS suggested_par_level numeric,
    ADD COLUMN IF NOT EXISTS suggested_par_source varchar(30),
    ADD COLUMN IF NOT EXISTS suggested_par_at timestamptz`,
];

async function main() {
  for (const stmt of statements) await db.execute(stmt);
  const tables = await db.execute(
    sql`select table_name from information_schema.tables where table_name in ('order_guide','order_guide_item') order by table_name`,
  );
  const cols = await db.execute(
    sql`select column_name from information_schema.columns where table_name='location_ingredient' and column_name like 'suggested_par%' order by column_name`,
  );
  console.log("tables:", tables.map((r) => r.table_name).join(",") || "NONE");
  console.log("suggested_par cols:", cols.map((r) => r.column_name).join(",") || "NONE");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

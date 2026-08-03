/**
 * One-off: apply the Purchasing P1 schema to the target DB.
 *
 * Every statement is additive and idempotent (IF NOT EXISTS), so re-running is a
 * no-op and nothing existing is dropped or rewritten. This is the ONLY sanctioned
 * way to move this schema — `drizzle-kit push` diffs the whole database and would
 * drop live columns it does not know about (see
 * wiki/synthesis/schema-drift-may-2026.md).
 *
 * Run:
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/applyOrderGuideSchema.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/applyOrderGuideSchema.ts
 *
 * The dotenv + applyEnvPrefix bootstrap below is what makes APP_ENV select the
 * right database; without it the script silently has no DATABASE_URL.
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { sql } = await import("drizzle-orm");
const { db } = await import("../db/index.js");

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
  // The two UoM columns that postdate migrateUomRecipeSelling.sql being applied.
  // Repeated here (both IF NOT EXISTS) so one script brings any database fully
  // up to this branch, rather than requiring a guess about which SQL file ran when.
  sql`ALTER TABLE ingredient ADD COLUMN IF NOT EXISTS density_g_per_ml numeric(6,4)`,
  sql`ALTER TABLE menu_item ADD COLUMN IF NOT EXISTS servings_per_sale integer NOT NULL DEFAULT 1`,
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

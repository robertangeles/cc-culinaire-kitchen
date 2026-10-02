/**
 * One-off: apply the FOH (front-of-house) stock and sales schema to the target DB.
 *
 * Every statement is additive and idempotent (IF NOT EXISTS / IF EXISTS guards),
 * so re-running is a no-op. This is the ONLY sanctioned way to move this schema —
 * `drizzle-kit push` diffs the whole database and would drop live columns it does
 * not know about (see wiki/synthesis/schema-drift-may-2026.md).
 *
 * Run:
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/applyFohSchema.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/applyFohSchema.ts
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
  // 1. Add zone column to stock_level (BOH default preserves existing rows)
  sql`ALTER TABLE stock_level ADD COLUMN IF NOT EXISTS zone varchar(3) NOT NULL DEFAULT 'BOH'`,

  // 2. Drop the old 2-column unique index (location + ingredient) and replace with
  //    3-column (location + ingredient + zone). We must drop first since IF NOT EXISTS
  //    on a CREATE UNIQUE INDEX won't change an existing partial-key index.
  sql`DROP INDEX IF EXISTS idx_stock_level_unique`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_level_unique ON stock_level (store_location_id, ingredient_id, zone)`,

  // 3. Add foh_par_level to location_ingredient
  sql`ALTER TABLE location_ingredient ADD COLUMN IF NOT EXISTS foh_par_level numeric`,

  // 4. Create foh_sale table
  sql`CREATE TABLE IF NOT EXISTS foh_sale (
    foh_sale_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id integer NOT NULL REFERENCES organisation(organisation_id),
    store_location_id uuid NOT NULL REFERENCES store_location(store_location_id),
    ingredient_id uuid NOT NULL REFERENCES ingredient(ingredient_id),
    quantity numeric(10,3) NOT NULL,
    unit_price numeric(10,4),
    line_total numeric(12,4),
    source varchar(20) NOT NULL,
    oversold_ind boolean NOT NULL DEFAULT false,
    sold_at timestamptz NOT NULL,
    created_by integer REFERENCES "user"(user_id),
    created_dttm timestamptz NOT NULL DEFAULT now()
  )`,

  // 5. Indexes on foh_sale
  sql`CREATE INDEX IF NOT EXISTS idx_foh_sale_location ON foh_sale (store_location_id, sold_at)`,
  sql`CREATE INDEX IF NOT EXISTS idx_foh_sale_org ON foh_sale (organisation_id, sold_at)`,
  sql`CREATE INDEX IF NOT EXISTS idx_foh_sale_ingredient ON foh_sale (ingredient_id)`,
  sql`CREATE INDEX IF NOT EXISTS idx_foh_sale_created_by ON foh_sale (created_by)`,
];

async function main() {
  for (const stmt of statements) await db.execute(stmt);

  const cols = await db.execute(
    sql`select column_name from information_schema.columns
        where table_name = 'stock_level' and column_name = 'zone'`,
  );
  const fohParCols = await db.execute(
    sql`select column_name from information_schema.columns
        where table_name = 'location_ingredient' and column_name = 'foh_par_level'`,
  );
  const tables = await db.execute(
    sql`select table_name from information_schema.tables where table_name = 'foh_sale'`,
  );

  console.log("stock_level.zone:", cols.length ? "OK" : "MISSING");
  console.log("location_ingredient.foh_par_level:", fohParCols.length ? "OK" : "MISSING");
  console.log("foh_sale table:", tables.length ? "OK" : "MISSING");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

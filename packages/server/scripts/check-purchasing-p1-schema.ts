/**
 * READ-ONLY verifier: does the target database have everything the
 * Purchasing P1 branch expects?
 *
 * Writes nothing. Runs only SELECTs against information_schema, so it is safe
 * to point at production. Per wiki/synthesis/schema-drift-may-2026.md, this is
 * step 3 of the safe workflow — confirm what is actually missing BEFORE writing
 * any migration. `drizzle-kit push` must NOT be used on this database.
 *
 * Usage (production):
 *   APP_ENV=prod pnpm --filter @culinaire/server exec tsx scripts/check-purchasing-p1-schema.ts
 * Usage (dev, to sanity-check the script itself):
 *   ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx scripts/check-purchasing-p1-schema.ts
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const appEnv = (process.env.APP_ENV ?? "dev").toUpperCase();
const url = process.env[`${appEnv}_DATABASE_URL`] ?? process.env.DATABASE_URL;
if (!url) {
  console.error(`No ${appEnv}_DATABASE_URL (or DATABASE_URL) in .env`);
  process.exit(1);
}
const host = (() => { try { return new URL(url).hostname; } catch { return "?"; } })();
console.log(`\nREAD-ONLY schema check — APP_ENV=${appEnv.toLowerCase()} host=${host}\n`);

const sql = postgres(url, { max: 1 });

/** Tables the branch introduces. */
const TABLES = [
  "order_guide",
  "order_guide_item",
  "storage_area",
  "ingredient_storage_area",
  "stock_movement",
  "sale",
];

/** Columns the branch introduces, as [table, column]. */
const COLUMNS: Array<[string, string]> = [
  ["ingredient", "purchase_unit"],
  ["ingredient", "pack_qty"],
  ["ingredient", "content_qty"],
  ["ingredient", "content_unit"],
  ["ingredient", "density_g_per_ml"],
  ["ingredient", "preferred_unit_cost"],
  ["ingredient", "preferred_supplier_id"],
  ["menu_item", "servings_per_sale"],
  ["menu_item", "linked_ingredient_id"],
  ["consumption_log", "base_qty"],
  ["consumption_log", "sale_id"],
  ["organisation", "organisation_phone"],
  ["supplier", "website"],
  ["purchase_order", "supplier_emailed_at"],
  ["purchase_order_line", "actual_unit_cost"],
  ["location_ingredient", "suggested_par_level"],
  ["location_ingredient", "suggested_par_source"],
  ["location_ingredient", "suggested_par_at"],
  ["location_ingredient", "weighted_average_cost"],
];

const missingTables: string[] = [];
const missingColumns: string[] = [];

for (const t of TABLES) {
  const [row] = await sql`
    SELECT 1 AS ok FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ${t} LIMIT 1`;
  if (row) console.log(`  table   OK       ${t}`);
  else { console.log(`  table   MISSING  ${t}`); missingTables.push(t); }
}

console.log("");
for (const [t, c] of COLUMNS) {
  const [row] = await sql`
    SELECT 1 AS ok FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${t} AND column_name = ${c} LIMIT 1`;
  if (row) console.log(`  column  OK       ${t}.${c}`);
  else { console.log(`  column  MISSING  ${t}.${c}`); missingColumns.push(`${t}.${c}`); }
}

// Guide rows the Purchasing UI asks for. Data, not schema — `pnpm db:seed` adds
// them idempotently.
const guideKeys = [
  "purchasing_orders", "purchasing_guides", "purchasing_suggestions",
  "purchasing_receive", "purchasing_suppliers", "purchasing_approvals",
  "purchasing_settings", "inventory_areas",
];
const missingGuides: string[] = [];
const [guideTable] = await sql`
  SELECT 1 AS ok FROM information_schema.tables
   WHERE table_schema='public' AND table_name='guide' LIMIT 1`;
if (guideTable) {
  console.log("");
  for (const k of guideKeys) {
    const [row] = await sql`SELECT 1 AS ok FROM guide WHERE guide_key = ${k} LIMIT 1`;
    if (!row) missingGuides.push(k);
  }
  console.log(`  guides  ${missingGuides.length === 0 ? "OK       all present" : `MISSING  ${missingGuides.length}: ${missingGuides.join(", ")}`}`);
}

console.log(`\n  ${missingTables.length} table(s) and ${missingColumns.length} column(s) missing.`);
if (missingTables.length || missingColumns.length) {
  console.log("  → a targeted migration is required BEFORE merging to main (main auto-deploys).");
  console.log("  → do NOT use drizzle-kit push: see wiki/synthesis/schema-drift-may-2026.md");
}
console.log("");

await sql.end();
process.exit(0);

/**
 * Verifier for migrate-prep-components.ts. Reads information_schema + pg_indexes
 * and reports PASS/FAIL per expected table, column, and index. Read-only.
 *
 * Run BEFORE the migration (expect FAILs) and AFTER (expect all PASS).
 * Exit code 1 if anything is missing.
 *
 * Usage: npx tsx scripts/check-prep-components.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

const expectedTables = ["prep_component", "prep_component_ingredient"];
const expectedColumns: Array<[string, string]> = [
  ["prep_component", "base_unit"],
  ["prep_component", "yield_pct"],
  ["prep_component", "shelf_life_days"],
  ["prep_component", "is_tcs_ind"],
  ["prep_component_ingredient", "prep_component_id"],
  ["prep_component_ingredient", "ingredient_id"],
  ["prep_component_ingredient", "quantity"],
  ["menu_item_ingredient", "prep_component_id"],
  ["prep_task", "ingredient_id"],
  ["prep_task", "prep_component_id"],
  ["prep_task", "on_hand_qty"],
  ["prep_task", "prep_needed"],
  ["prep_task", "use_by"],
  ["prep_task", "is_over_prep_ind"],
  ["ingredient_cross_usage", "ingredient_id"],
  ["prep_session", "is_ended_ind"],
];
const expectedIndexes = [
  "idx_prep_component_org_name",
  "idx_prep_component_org",
  "idx_prep_component_ingredient_component",
  "idx_prep_component_ingredient_ingredient",
  "idx_menu_item_ingredient_prep_component",
  "idx_prep_task_session",
  "idx_prep_task_ingredient",
  "idx_prep_task_prep_component",
  "idx_prep_session_user",
  "idx_prep_session_org",
  "idx_prep_session_location",
  "idx_prep_menu_selection_session",
  "idx_prep_menu_selection_recipe",
  "idx_prep_menu_selection_menu_item",
  "idx_cross_usage_user",
  "idx_cross_usage_session",
];

let failures = 0;
const mark = (ok: boolean, label: string) => {
  console.log(`  ${ok ? "✓" : "✗ MISSING"}  ${label}`);
  if (!ok) failures++;
};

try {
  const tables = new Set(
    (await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `).map((r) => r.table_name),
  );
  const cols = new Set(
    (await sql<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
    `).map((r) => `${r.table_name}.${r.column_name}`),
  );
  const idx = new Set(
    (await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    `).map((r) => r.indexname),
  );

  console.log("Tables:");
  for (const t of expectedTables) mark(tables.has(t), t);
  console.log("Columns:");
  for (const [t, c] of expectedColumns) mark(cols.has(`${t}.${c}`), `${t}.${c}`);
  console.log("Indexes:");
  for (const i of expectedIndexes) mark(idx.has(i), i);

  console.log(
    failures === 0
      ? "\n✓ All prep-component schema objects present."
      : `\n✗ ${failures} object(s) missing — run: npx tsx scripts/migrate-prep-components.ts`,
  );
  if (failures > 0) process.exitCode = 1;
} catch (err) {
  console.error("Verifier failed:", err);
  process.exitCode = 1;
} finally {
  await sql.end();
}

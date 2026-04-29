// @ts-nocheck
/**
 * Verify Phase 1 schema changes landed correctly on the live DB.
 * Run AFTER phase-1-catalog-spine.ts.
 */
import { config } from "dotenv";
config({ path: "../../.env" });

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

console.log("\n🔍 Verifying Phase 1 schema...\n");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${label}${detail ? ` (${detail})` : ""}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` (${detail})` : ""}`);
    fail++;
  }
}

// 1. citext extension
const ext = await sql`SELECT extname FROM pg_extension WHERE extname = 'citext'`;
check("citext extension installed", ext.length === 1);

// 2. menu_item_ingredient new columns + FK
const miiCols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'menu_item_ingredient' AND column_name IN ('ingredient_id', 'note')
`;
check("menu_item_ingredient.ingredient_id + note", miiCols.length === 2);

const miiFK = await sql`
  SELECT conname, convalidated FROM pg_constraint
  WHERE conname = 'menu_item_ingredient_ingredient_id_fk'
`;
check(
  "menu_item_ingredient FK exists + VALIDATED",
  miiFK.length === 1 && miiFK[0]?.convalidated === true,
  miiFK[0] ? `convalidated=${miiFK[0].convalidated}` : "missing",
);

// 3. consumption_log new column + FK
const clCols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'consumption_log' AND column_name = 'menu_item_id'
`;
check("consumption_log.menu_item_id", clCols.length === 1);

const clFK = await sql`
  SELECT convalidated FROM pg_constraint WHERE conname = 'consumption_log_menu_item_id_fk'
`;
check(
  "consumption_log FK exists + VALIDATED",
  clFK.length === 1 && clFK[0]?.convalidated === true,
);

// 4. ingredient denorm columns + FK
const ingCols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'ingredient' AND column_name IN ('preferred_unit_cost', 'preferred_supplier_id')
`;
check("ingredient.preferred_unit_cost + preferred_supplier_id", ingCols.length === 2);

const ingFK = await sql`
  SELECT convalidated FROM pg_constraint WHERE conname = 'ingredient_preferred_supplier_id_fk'
`;
check("ingredient.preferred_supplier_id FK + VALIDATED", ingFK.length === 1 && ingFK[0]?.convalidated === true);

// 5. location_ingredient WAC columns
const liCols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'location_ingredient' AND column_name IN ('weighted_average_cost', 'wac_last_recomputed_at')
`;
check("location_ingredient WAC columns", liCols.length === 2);

// 6. ingredient_alias table
const aliasCols = await sql`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'ingredient_alias' ORDER BY ordinal_position
`;
const aliasTextCol = aliasCols.find((c) => c.column_name === "alias_text");
check("ingredient_alias table exists", aliasCols.length >= 6);
check("ingredient_alias.alias_text uses citext", aliasTextCol?.data_type === "USER-DEFINED" || aliasTextCol?.data_type === "citext", aliasTextCol?.data_type);

// 7. Indexes
const indexes = await sql`
  SELECT indexname FROM pg_indexes
  WHERE indexname IN (
    'idx_menu_item_ingredient_ingredient',
    'idx_consumption_log_menu_item',
    'idx_ingredient_alias_org_text',
    'idx_ingredient_alias_ingredient',
    'idx_ingredient_alias_org'
  )
`;
check("Phase 1 indexes (5 expected)", indexes.length === 5, `found ${indexes.length}`);

// 8. Trigger function + trigger
const fns = await sql`
  SELECT proname FROM pg_proc WHERE proname IN (
    'fn_recompute_preferred_supplier_cost',
    'trg_ingredient_supplier_preferred_cost'
  )
`;
check("Trigger functions exist (2 expected)", fns.length === 2, `found ${fns.length}`);

const triggers = await sql`
  SELECT tgname FROM pg_trigger WHERE tgname = 'trg_ingredient_supplier_preferred_cost'
`;
check("Trigger attached to ingredient_supplier", triggers.length === 1);

// 9. Backfill: how many ingredients now have a non-null preferred_unit_cost?
const backfill = await sql`
  SELECT
    COUNT(*) FILTER (WHERE preferred_unit_cost IS NOT NULL) AS backfilled,
    COUNT(*) AS total,
    (SELECT COUNT(DISTINCT ingredient_id) FROM ingredient_supplier WHERE preferred_ind = TRUE) AS expected
  FROM ingredient
`;
const b = backfill[0]!;
check(
  "Backfill: ingredient.preferred_unit_cost populated for all preferred-flagged rows",
  Number(b.backfilled) === Number(b.expected),
  `backfilled=${b.backfilled} expected=${b.expected} total=${b.total}`,
);

// 10. Trigger smoke test — flip a preferred_ind on an existing supplier row
//     and verify the denorm picks up. We restore the original row at the end.
console.log("\nTrigger smoke test:");
const sample = await sql`
  SELECT ingredient_supplier_id, ingredient_id, supplier_id, cost_per_unit, preferred_ind
  FROM ingredient_supplier WHERE preferred_ind = TRUE LIMIT 1
`;
if (sample.length === 1) {
  const row = sample[0]!;
  const pre = await sql`SELECT preferred_unit_cost FROM ingredient WHERE ingredient_id = ${row.ingredient_id}`;
  // Bump cost by 1, observe denorm refresh, then restore.
  const bumped = Number(row.cost_per_unit) + 1;
  await sql`UPDATE ingredient_supplier SET cost_per_unit = ${bumped} WHERE ingredient_supplier_id = ${row.ingredient_supplier_id}`;
  const post = await sql`SELECT preferred_unit_cost FROM ingredient WHERE ingredient_id = ${row.ingredient_id}`;
  await sql`UPDATE ingredient_supplier SET cost_per_unit = ${row.cost_per_unit} WHERE ingredient_supplier_id = ${row.ingredient_supplier_id}`;
  const after = await sql`SELECT preferred_unit_cost FROM ingredient WHERE ingredient_id = ${row.ingredient_id}`;
  const triggerWorks =
    Number(post[0]?.preferred_unit_cost) === bumped &&
    Number(after[0]?.preferred_unit_cost) === Number(row.cost_per_unit);
  check(
    "Trigger fires on UPDATE: pre→bumped→restored",
    triggerWorks,
    `pre=${pre[0]?.preferred_unit_cost} bumped=${post[0]?.preferred_unit_cost} restored=${after[0]?.preferred_unit_cost}`,
  );
} else {
  console.log("  ⊘ no preferred ingredient_supplier rows to test against");
}

console.log("\n─────────────────────────────────────────────────────────");
if (fail === 0) {
  console.log(`✅ PASS — ${pass} checks green, 0 failures.`);
} else {
  console.log(`❌ FAIL — ${pass} green, ${fail} failed.`);
}
console.log("─────────────────────────────────────────────────────────\n");

await sql.end();
process.exit(fail === 0 ? 0 : 1);

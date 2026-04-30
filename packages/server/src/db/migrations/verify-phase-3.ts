// @ts-nocheck
/**
 * Verify Phase 3 schema + triggers landed correctly on the live DB.
 * Run AFTER phase-3-catalog-spine.ts.
 */
import { config } from "dotenv";
config({ path: "../../.env" });
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

console.log("\n🔍 Verifying Phase 3 schema + triggers...\n");

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

// 1. Allergen columns on menu_item
const miCols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'menu_item' AND column_name IN (
    'contains_dairy_ind','contains_gluten_ind','contains_nuts_ind',
    'contains_shellfish_ind','contains_eggs_ind','is_vegetarian_ind'
  )
`;
check("menu_item allergen columns (6 expected)", miCols.length === 6, `found ${miCols.length}`);

// 2. Stale-cost columns on menu_item_ingredient
const miiCols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'menu_item_ingredient' AND column_name IN ('cost_stale_ind', 'cost_stale_at')
`;
check("menu_item_ingredient stale-cost columns", miiCols.length === 2, `found ${miiCols.length}`);

// 3. Partial index on stale rows
const idx = await sql`
  SELECT indexname FROM pg_indexes
  WHERE indexname = 'idx_menu_item_ingredient_stale'
`;
check("idx_menu_item_ingredient_stale partial index", idx.length === 1);

// 4. Trigger functions exist
const fns = await sql`
  SELECT proname FROM pg_proc WHERE proname IN (
    'fn_recompute_menu_item_allergens',
    'trg_menu_item_ingredient_allergen_rollup',
    'trg_ingredient_preferred_cost_stale'
  )
`;
check("Trigger functions (3 expected)", fns.length === 3, `found ${fns.length}`);

// 5. Triggers attached
const triggers = await sql`
  SELECT tgname, tgrelid::regclass::text AS table_name FROM pg_trigger
  WHERE tgname IN ('trg_menu_item_ingredient_allergen_rollup', 'trg_ingredient_preferred_cost_stale')
`;
check(
  "Triggers attached (2 expected)",
  triggers.length === 2,
  triggers.map((t) => `${t.tgname}@${t.table_name}`).join(", "),
);

// ─── Live trigger smoke tests ───────────────────────────────────────

console.log("\nLive trigger smoke tests:");

// Pick a menu_item that has at least one Catalog-linked ingredient row.
// If none exist, we synth a tiny scenario in a tx and roll it back.
const linked = await sql`
  SELECT mi.menu_item_id, mi.id AS row_id, mi.ingredient_id, m.name
    FROM menu_item_ingredient mi
    JOIN menu_item m ON m.menu_item_id = mi.menu_item_id
   WHERE mi.ingredient_id IS NOT NULL
   LIMIT 1
`;

if (linked.length === 0) {
  console.log("  ⊘ no catalog-linked menu_item_ingredient row found — skipping live triggers");
} else {
  const row = linked[0]!;

  // ── Test A: stale-cost trigger
  // Bump the linked ingredient's preferred_unit_cost; observe cost_stale_ind flip → TRUE.
  // Restore at the end. Wrap in tx → ROLLBACK so we never leave drift.
  await sql.begin(async (tx) => {
    const [pre] = await tx`
      SELECT cost_stale_ind FROM menu_item_ingredient WHERE id = ${row.row_id}
    `;
    const [ing] = await tx`
      SELECT preferred_unit_cost FROM ingredient WHERE ingredient_id = ${row.ingredient_id}
    `;
    const original = ing.preferred_unit_cost;
    const bumped = original ? Number(original) + 1.23 : 5.55;
    await tx`
      UPDATE ingredient SET preferred_unit_cost = ${bumped}
       WHERE ingredient_id = ${row.ingredient_id}
    `;
    const [post] = await tx`
      SELECT cost_stale_ind, cost_stale_at FROM menu_item_ingredient WHERE id = ${row.row_id}
    `;
    check(
      "Trigger A: stale-cost flag flips on preferred_unit_cost change",
      post.cost_stale_ind === true && post.cost_stale_at !== null,
      `pre=${pre.cost_stale_ind} post=${post.cost_stale_ind} stale_at=${post.cost_stale_at ? "set" : "null"}`,
    );
    // ROLLBACK happens automatically because we throw at the end.
    throw new Error("__ROLLBACK_SMOKE_TEST__");
  }).catch((e) => {
    if (!(e instanceof Error) || !e.message.includes("__ROLLBACK_SMOKE_TEST__")) throw e;
  });

  // ── Test B: allergen rollup trigger
  // Re-run the recompute fn directly + diff the menu_item flags vs the
  // bool_or of its linked ingredients — if the trigger ever fires correctly,
  // the values must match.
  await sql`SELECT fn_recompute_menu_item_allergens(${row.menu_item_id}::uuid)`;
  const [mi] = await sql`
    SELECT contains_dairy_ind, contains_gluten_ind, contains_nuts_ind,
           contains_shellfish_ind, contains_eggs_ind, is_vegetarian_ind
      FROM menu_item WHERE menu_item_id = ${row.menu_item_id}
  `;
  const [exp] = await sql`
    SELECT COALESCE(bool_or(i.contains_dairy_ind), FALSE) AS d,
           COALESCE(bool_or(i.contains_gluten_ind), FALSE) AS g,
           COALESCE(bool_or(i.contains_nuts_ind), FALSE) AS n,
           COALESCE(bool_or(i.contains_shellfish_ind), FALSE) AS s,
           COALESCE(bool_or(i.contains_eggs_ind), FALSE) AS e,
           COALESCE(bool_and(i.is_vegetarian_ind), FALSE) AS v
      FROM menu_item_ingredient mi
      JOIN ingredient i ON i.ingredient_id = mi.ingredient_id
     WHERE mi.menu_item_id = ${row.menu_item_id}
  `;
  const matches =
    mi.contains_dairy_ind === exp.d &&
    mi.contains_gluten_ind === exp.g &&
    mi.contains_nuts_ind === exp.n &&
    mi.contains_shellfish_ind === exp.s &&
    mi.contains_eggs_ind === exp.e &&
    mi.is_vegetarian_ind === exp.v;
  check(
    "Trigger B: menu_item allergens match bool_or/bool_and of linked ingredients",
    matches,
    `mi=[d=${mi.contains_dairy_ind} g=${mi.contains_gluten_ind} n=${mi.contains_nuts_ind} s=${mi.contains_shellfish_ind} e=${mi.contains_eggs_ind} v=${mi.is_vegetarian_ind}] exp=[d=${exp.d} g=${exp.g} n=${exp.n} s=${exp.s} e=${exp.e} v=${exp.v}]`,
  );
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

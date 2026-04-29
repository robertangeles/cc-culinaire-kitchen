// @ts-nocheck
/**
 * Phase 0 #5: feasibility check on consumption_logger for the Phase 4 yield
 * variance metric.
 *
 * Yield variance = theoretical food cost (recipe × WAC × units_sold) vs
 * actual food cost (sum of consumption_log entries × WAC for the period).
 *
 * For the variance metric to produce signal not noise, we need:
 *   - Per-ingredient consumption_log rows
 *   - Tied to a date or service period
 *   - Enough volume (3+ menu items × 7 days × per-location)
 *
 * If insufficient: Phase 4 still ships, but with an "insufficient consumption
 * data" empty state instead of garbage variance numbers.
 *
 * Read-only. No DB changes.
 */
import { config } from "dotenv";
config({ path: "../../.env" });

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

console.log("\n🔍 Checking consumption_logger feasibility for Phase 4 yield variance...\n");

// First: discover what columns exist on consumption_log so we don't query
// fields the schema doesn't have.
const cols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'consumption_log'
  ORDER BY ordinal_position
`;
const colNames = new Set(cols.map((c) => c.column_name));
const hasMenuItemId = colNames.has("menu_item_id");
const hasRecipeId = colNames.has("recipe_id");
const hasServiceDate = colNames.has("service_date");

console.log(`Schema columns (${cols.length}):`);
for (const c of cols) console.log(`  • ${c.column_name}`);

// 1) Row count + date range
const totals = await sql`
  SELECT
    COUNT(*) AS total_rows,
    COUNT(DISTINCT ingredient_id) AS unique_ingredients,
    COUNT(DISTINCT store_location_id) AS unique_locations,
    MIN(logged_at) AS earliest,
    MAX(logged_at) AS latest
  FROM consumption_log
`;

const t = totals[0]!;
const earliestDate = t.earliest ? new Date(t.earliest) : null;
const latestDate = t.latest ? new Date(t.latest) : null;
const dayspan =
  earliestDate && latestDate
    ? Math.round((latestDate.getTime() - earliestDate.getTime()) / 86400000)
    : 0;

console.log("\nVolume:");
console.log(`  • Total rows: ${t.total_rows}`);
console.log(`  • Unique ingredients: ${t.unique_ingredients}`);
console.log(`  • Unique locations: ${t.unique_locations}`);
console.log(`  • Date span: ${earliestDate?.toISOString().slice(0, 10) ?? "—"} → ${latestDate?.toISOString().slice(0, 10) ?? "—"} (${dayspan} days)`);

// 2) Coverage at the INGREDIENT level (since menu_item_id doesn't exist)
const ingredientCoverage = await sql`
  SELECT
    COUNT(DISTINCT ingredient_id) AS distinct_ingredients_logged,
    COUNT(DISTINCT DATE(logged_at)) AS distinct_days,
    COUNT(DISTINCT (store_location_id, DATE(logged_at))) AS location_day_pairs,
    SUM(CAST(quantity AS NUMERIC)) AS total_qty_logged
  FROM consumption_log
  WHERE quantity IS NOT NULL AND CAST(quantity AS NUMERIC) > 0
`;
const cov = ingredientCoverage[0]!;
console.log("\nIngredient-level coverage:");
console.log(`  • Distinct ingredients logged: ${cov.distinct_ingredients_logged}`);
console.log(`  • Distinct days with logs: ${cov.distinct_days}`);
console.log(`  • Location × day pairs: ${cov.location_day_pairs}`);

// 3) Reason distribution — wastage vs tasting vs staff meal etc.
const reasons = await sql`
  SELECT reason, COUNT(*) AS cnt
  FROM consumption_log
  GROUP BY reason
  ORDER BY cnt DESC
`;
console.log("\nReason distribution:");
for (const r of reasons) console.log(`  • ${r.reason}: ${r.cnt}`);

// 4) The real Phase 4 finding
console.log("\n─────────────────────────────────────────────────────────");
console.log("PHASE 4 FEASIBILITY VERDICT");
console.log("─────────────────────────────────────────────────────────");

if (!hasMenuItemId && !hasRecipeId) {
  console.log("⚠️  CRITICAL: consumption_log does NOT link to menu_item_id or recipe_id.");
  console.log("");
  console.log("    The plan's Phase 4 yield variance assumes per-DISH actual cost.");
  console.log("    Today, consumption_log only records 'this ingredient was consumed at");
  console.log("    this location on this day for this reason' — not 'consumed FOR this dish'.");
  console.log("");
  console.log("    Phase 4 has three viable shapes:");
  console.log("      A) Variance at the ingredient level (theoretical cost from menu_item × units_sold,");
  console.log("         actual consumption from consumption_log) — coarser but works today.");
  console.log("      B) Add menu_item_id to consumption_log (schema change in Phase 4 prereqs).");
  console.log("      C) Compute variance via stock-take deltas instead of consumption_log.");
  console.log("");
  console.log("    Recommend (A) for Phase 4 v1: ship ingredient-level variance immediately.");
  console.log("    Add (B) as a Phase 4.5 enhancement when chefs want per-dish attribution.");
}

const PHASE_4_MIN = {
  ingredients: 3,
  days: 7,
};

const meetsMinimum =
  Number(cov.distinct_ingredients_logged ?? 0) >= PHASE_4_MIN.ingredients &&
  Number(cov.distinct_days ?? 0) >= PHASE_4_MIN.days;

console.log(`\nVolume threshold (for shape A above): ${PHASE_4_MIN.ingredients}+ ingredients × ${PHASE_4_MIN.days}+ days`);
if (meetsMinimum) {
  console.log("✅ PASS — consumption_log has enough volume for ingredient-level variance.");
} else {
  console.log("⚠️  THIN DATA — Phase 4 ships with 'insufficient data' empty state.");
  console.log("   Operators see real numbers once consumption logging picks up.");
}
console.log("─────────────────────────────────────────────────────────\n");

await sql.end();
process.exit(0);

/**
 * @module scripts/seedCatalogParStock
 *
 * UAT fixture helper for org "Almost French Pâtisserie" (org id 2).
 * Seeds realistic par levels, reorder quantities, and (for items with no
 * existing stock_level row) opening stock-on-hand across the full catalog
 * at both locations, so Order Guides / order-to-par / dashboards have
 * something realistic to show beyond the ~7 hand-built UAT fixture items.
 *
 * Existing `stock_level` rows are NEVER touched — the checklist in
 * docs/qa/uom-recipe-selling-uat.md ties its worked examples (Belicard,
 * Sancerre, Baker's Flour, etc.) to those exact numbers.
 *
 * Deterministic (hash-based, no Math.random): re-running with the same
 * catalog produces the same par/reorder/stock values every time.
 *
 * Usage:
 *   pnpm --filter @culinaire/server exec tsx src/scripts/seedCatalogParStock.ts
 *     → preview only, no writes
 *   pnpm --filter @culinaire/server exec tsx src/scripts/seedCatalogParStock.ts --apply
 *     → writes via updateLocationIngredient() / addStock()
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { ingredient, stockLevel } from "../db/schema.js";
import { updateLocationIngredient } from "../services/ingredientService.js";
import { addStock } from "../services/stockService.js";

const ORG_ID = 2;
const LOCATIONS = [
  { id: "60b2ae1c-4a83-4108-a37f-e702b916751c", name: "Almost French Patisserie", siteMultiplier: 1 },
  { id: "fbb80daa-e6f5-4623-b9e0-0b7a0f546bbf", name: "Almost French Epicure", siteMultiplier: 0.55 },
] as const;

const APPLY = process.argv.includes("--apply");

// ─── Deterministic pseudo-randomness (FNV-1a hash → [0,1)) ─────────────
function hash32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function frac(seed: string): number {
  return hash32(seed) / 0xffffffff;
}

// ─── Category ranges ─────────────────────────────────────────────────
type Range = { min: number; max: number; perishable?: boolean };

const RANGES: Record<string, Range> = {
  protein_kg: { min: 1.5, max: 5, perishable: true },
  produce_kg: { min: 2, max: 8, perishable: true },
  dairy_block_kg: { min: 1.5, max: 5, perishable: true },
  flour_staple_kg: { min: 8, max: 25 },
  chocolate_kg: { min: 3, max: 8 },
  spice_small_kg: { min: 0.5, max: 3 },
  luxury_tiny_kg: { min: 0.05, max: 0.15 },
  bakery_crumbs_kg: { min: 1, max: 3 },
  frozen_fruit_kg: { min: 2, max: 5, perishable: true },
  dairy_liquid_l: { min: 5, max: 20, perishable: true },
  beverage_l: { min: 3, max: 10 },
  icecream_l: { min: 3, max: 8 },
  vanilla_l: { min: 0.3, max: 0.8 },
  bakery_fresh_each: { min: 15, max: 50, perishable: true },
  bakery_small_each: { min: 40, max: 150, perishable: true },
  condiment_each: { min: 2, max: 6 },
  tub_each: { min: 2, max: 5 },
  garnish_cheap_each: { min: 30, max: 100 },
  garnish_gold_each: { min: 5, max: 15 },
  eggs_each: { min: 80, max: 200, perishable: true },
  yogurt_each: { min: 10, max: 30, perishable: true },
  butter_sheet_each: { min: 5, max: 15, perishable: true },
  packaging_each: { min: 100, max: 400 },
  cleaning_each: { min: 2, max: 6 },
  other_each: { min: 2, max: 6 },
  foh_can_each: { min: 24, max: 72 },
  op_supply_each: { min: 200, max: 600 },
  wine_everyday: { min: 6, max: 10 },
  wine_premium: { min: 3, max: 6 },
  champagne: { min: 2, max: 4 },
};

// Explicit per-item classification — the org-2 catalog is a known, finite
// list (115 items), so a name lookup is safer/more reviewable here than
// fuzzy keyword matching. Any item missing from this map aborts the run
// (see the `unmapped` check below) rather than silently guessing.
const CLASSIFICATION: Record<string, string> = {
  "Bagel": "bakery_fresh_each",
  "Baguette": "bakery_fresh_each",
  "Biscuit Crumbs": "bakery_crumbs_kg",
  "Canelé": "bakery_fresh_each",
  "Doughnut": "bakery_fresh_each",
  "Lady Finger Biscuits": "bakery_small_each",
  "Marie Biscuits": "bakery_small_each",
  "Muffins": "bakery_fresh_each",
  "Tortillas": "bakery_small_each",
  "Organic Apple Juice": "beverage_l",
  "Organic Orange Juice": "beverage_l",
  "San Pellegrino (can)": "foh_can_each",
  "Sparkling Water": "beverage_l",
  "Spring Water": "beverage_l",
  "Coffee Machine Cleaner": "cleaning_each",
  "English Mild Mustard": "condiment_each",
  "Golden Syrup": "condiment_each",
  "Lemon Puree": "condiment_each",
  "Mayo": "condiment_each",
  "Pesto": "condiment_each",
  "Raspberry Jam": "condiment_each",
  "Relish": "condiment_each",
  "Tomato Sauce": "condiment_each",
  "Almond Milk": "dairy_liquid_l",
  "Bocconcini": "dairy_block_kg",
  "Brie": "dairy_block_kg",
  "Butter": "dairy_block_kg",
  "Butter 25kg": "dairy_block_kg",
  "Butter Sheet": "butter_sheet_each",
  "Condensed Milk": "dairy_liquid_l",
  "Cream Cheese": "dairy_block_kg",
  "Cream Cheese Spread": "dairy_block_kg",
  "Eggs": "eggs_each",
  "Full Cream Milk": "dairy_liquid_l",
  "Lactose-Free Milk": "dairy_liquid_l",
  "Mascarpone": "dairy_block_kg",
  "Oat Milk": "dairy_liquid_l",
  "Skim Milk": "dairy_liquid_l",
  "Soy Milk": "dairy_liquid_l",
  "Swiss Cheese Slices": "dairy_block_kg",
  "Tasty Shredded Cheese": "dairy_block_kg",
  "Thickened Cream": "dairy_liquid_l",
  "Yogurt": "yogurt_each",
  "Baker's Flour (T55)": "flour_staple_kg",
  "Baking Powder": "spice_small_kg",
  "Brown Sugar": "flour_staple_kg",
  "Caster Sugar": "flour_staple_kg",
  "Chocolate Baton": "garnish_cheap_each",
  "Cocoa Powder": "spice_small_kg",
  "Corn Flour": "flour_staple_kg",
  "Custard Powder": "spice_small_kg",
  "Dark Chocolate": "chocolate_kg",
  "Dark Compound Chocolate": "chocolate_kg",
  "Drop Compound": "chocolate_kg",
  "Euro Flour": "flour_staple_kg",
  "Fondant": "tub_each",
  "Gluten Free Flour": "flour_staple_kg",
  "Gold Leaf Sheet": "garnish_gold_each",
  "Gold Powder": "luxury_tiny_kg",
  "Ground Cinnamon": "spice_small_kg",
  "Ground Nutmeg": "spice_small_kg",
  "Guérande Salt": "spice_small_kg",
  "Hot Glaze": "tub_each",
  "Icing Sugar": "flour_staple_kg",
  "Instant Dry Yeast": "spice_small_kg",
  "Marshmallow": "garnish_cheap_each",
  "Milk Chocolate": "chocolate_kg",
  "Mixed Herbs": "spice_small_kg",
  "Mixed Spice": "spice_small_kg",
  "Nutella": "chocolate_kg",
  "Plain Flour": "flour_staple_kg",
  "Salt": "spice_small_kg",
  "Sesame Seeds": "spice_small_kg",
  "Shredded Coconut": "spice_small_kg",
  "Slivered Almonds": "spice_small_kg",
  "Smarties": "garnish_cheap_each",
  "Sugar Sticks": "garnish_cheap_each",
  "Vanilla Extract": "vanilla_l",
  "White Chocolate": "chocolate_kg",
  "White Compound Chocolate": "chocolate_kg",
  "Ice Cream Caramel": "icecream_l",
  "Ice Cream Chocolate": "icecream_l",
  "Ice Cream Strawberry": "icecream_l",
  "Ice Cream Vanilla": "icecream_l",
  "Raspberry Whole": "frozen_fruit_kg",
  "Canola Spray": "other_each",
  "Napkins (cocktail)": "op_supply_each",
  "Label": "packaging_each",
  "Piping Bag": "packaging_each",
  "Apples": "produce_kg",
  "Apricot": "produce_kg",
  "Pear": "produce_kg",
  "Spinach": "produce_kg",
  "Bacon": "protein_kg",
  "Chicken": "protein_kg",
  "Ham": "protein_kg",
  "Salami": "protein_kg",
  "Salmon": "protein_kg",
  "Belicard Blanc Chardonnay": "wine_everyday",
  "Billecart-Salmon": "champagne",
  "Bordeaux": "wine_everyday",
  "Bourgogne Pinot Noir": "wine_everyday",
  "Chardonnay (South Australia)": "wine_everyday",
  "Côte du Rhône": "wine_everyday",
  "Eleventh Hour Barossa Shiraz": "wine_everyday",
  "Huré Frères (Half Bottle)": "wine_premium",
  "Jean-Luc Mouillard": "wine_premium",
  "Lafon Languedoc": "wine_everyday",
  "Luke Lambert Yarra Valley": "wine_everyday",
  "Pinot Grigio (Tasmania)": "wine_everyday",
  "Riesling": "wine_everyday",
  "Sancerre": "wine_premium",
  "Sébastien Petit Chablis": "wine_premium",
  "Taittinger": "champagne",
  "Yarra Valley Pinot Noir": "wine_everyday",
};

// Items whose org-level par/reorder is a deliberate, already-researched
// anchor — carried forward (scaled by site multiplier) instead of the
// category heuristic. Taittinger's org par (0.016) is excluded on purpose:
// it's a data-entry error, not an anchor, so it falls through to the
// champagne heuristic below.
const ANCHOR_OVERRIDE: Record<string, { par: number; reorder: number }> = {
  "Baker's Flour (T55)": { par: 10, reorder: 25 },
  "Plain Flour": { par: 25, reorder: 50 },
  "Chicken": { par: 5, reorder: 5 },
  "Eleventh Hour Barossa Shiraz": { par: 12, reorder: 24 },
  // Org anchor was 12/24, but live stock has drifted to 16 bottles (some
  // C-section testing happened off the checklist's checkboxes) — 12 is no
  // longer meaningfully "below par". Bumped to keep C9-C15 walkable.
  "Belicard Blanc Chardonnay": { par: 20, reorder: 36 },
};

// These three have IDENTICAL preserved stock at both Patisserie and Epicure
// (25kg / 10kg / 24 bottles) — clearly seeded as shared baseline fixture
// values, not location-scaled. Scaling their par down for Epicure while the
// stock stays constant made Epicure look implausibly overstocked, so these
// skip the site multiplier and use the same par/reorder at both locations.
const ANCHOR_NO_SITE_SCALE = new Set([
  "Baker's Flour (T55)", "Chicken", "Eleventh Hour Barossa Shiraz",
]);

function roundToPrecision(v: number, unit: string): number {
  if (unit === "each" || unit === "bottle") return Math.round(v);
  return Math.round(v * 10) / 10;
}

function roundToPack(value: number, packQty: number | null): number {
  if (!packQty || packQty <= 0) return value;
  return Math.ceil(value / packQty) * packQty;
}

function computePar(name: string, group: string, unit: string, siteMultiplier: number): number {
  const floor = unit === "kg" || unit === "l" ? 0.1 : 1;
  if (ANCHOR_OVERRIDE[name]) {
    const effectiveMultiplier = ANCHOR_NO_SITE_SCALE.has(name) ? 1 : siteMultiplier;
    return roundToPrecision(Math.max(ANCHOR_OVERRIDE[name].par * effectiveMultiplier, floor), unit);
  }
  const range = RANGES[group];
  const f = frac(`${name}:par`);
  const base = (range.min + f * (range.max - range.min)) * siteMultiplier;
  return roundToPrecision(Math.max(base, floor), unit);
}

function computeReorder(
  name: string, group: string, unit: string, par: number, packQty: number | null,
): number {
  if (ANCHOR_OVERRIDE[name]) {
    const anchor = ANCHOR_OVERRIDE[name];
    const ratio = par / anchor.par;
    return roundToPrecision(roundToPack(anchor.reorder * ratio, packQty), unit);
  }
  const range = RANGES[group];
  const multiplier = range.perishable ? 1 : 2;
  return roundToPrecision(roundToPack(par * multiplier, packQty), unit);
}

type Bucket = { label: string; min: number; max: number };
const BUCKETS: Bucket[] = [
  { label: "critical", min: 0, max: 0.25 },
  { label: "below_par", min: 0.4, max: 0.85 },
  { label: "healthy", min: 0.95, max: 1.3 },
  { label: "well_stocked", min: 1.4, max: 2.0 },
];
const BUCKET_WEIGHTS = [0.10, 0.25, 0.45, 0.20];

function computeStock(
  name: string, locationId: string, unit: string, par: number,
): { qty: number; bucket: string } {
  const bf = frac(`${name}:${locationId}:bucket`);
  let cum = 0;
  let chosen: Bucket = BUCKETS[BUCKETS.length - 1]!;
  for (let i = 0; i < BUCKETS.length; i++) {
    cum += BUCKET_WEIGHTS[i]!;
    if (bf < cum) { chosen = BUCKETS[i]!; break; }
  }
  const wf = frac(`${name}:${locationId}:within`);
  const pct = chosen.min + wf * (chosen.max - chosen.min);
  const qty = Math.max(0, par * pct);
  return { qty: roundToPrecision(qty, unit), bucket: chosen.label };
}

async function main(): Promise<void> {
  const items = await db
    .select({
      id: ingredient.ingredientId,
      name: ingredient.ingredientName,
      baseUnit: ingredient.baseUnit,
      packQty: ingredient.packQty,
    })
    .from(ingredient)
    .where(and(eq(ingredient.organisationId, ORG_ID), sql`${ingredient.deletedAt} IS NULL`));

  const unmapped = items.filter((it) => !CLASSIFICATION[it.name]);
  if (unmapped.length > 0) {
    console.error(`${unmapped.length} unmapped ingredient(s) — add to CLASSIFICATION before running:`);
    for (const u of unmapped) console.error(`  "${u.name}"`);
    process.exit(1);
  }

  const existingStock = await db
    .select({ ingredientId: stockLevel.ingredientId, storeLocationId: stockLevel.storeLocationId })
    .from(stockLevel);
  const existingKey = new Set(existingStock.map((r) => `${r.ingredientId}:${r.storeLocationId}`));

  const bucketCounts: Record<string, number> = {};
  let createdCount = 0;
  let preservedCount = 0;

  const sampleByGroup = new Map<string, string>();
  const fixtureLines: string[] = [];

  for (const loc of LOCATIONS) {
    for (const it of items) {
      const group = CLASSIFICATION[it.name]!;
      const par = computePar(it.name, group, it.baseUnit, loc.siteMultiplier);
      const packQty = it.packQty ? Number(it.packQty) : null;
      const reorder = computeReorder(it.name, group, it.baseUnit, par, packQty);

      const key = `${it.id}:${loc.id}`;
      const hasStock = existingKey.has(key);
      let stockLine = "PRESERVED";
      let stockQty: number | undefined;

      if (!hasStock) {
        const s = computeStock(it.name, loc.id, it.baseUnit, par);
        stockQty = s.qty;
        stockLine = `${s.qty}${it.baseUnit} (${s.bucket})`;
        bucketCounts[s.bucket] = (bucketCounts[s.bucket] ?? 0) + 1;
        createdCount++;
      } else {
        preservedCount++;
      }

      if (loc.id === LOCATIONS[0].id && !sampleByGroup.has(group)) {
        sampleByGroup.set(group, `  [${group}] ${it.name}: par=${par}${it.baseUnit} reorder=${reorder}${it.baseUnit} stock=${stockLine}`);
      }
      if (ANCHOR_OVERRIDE[it.name]) {
        fixtureLines.push(`  ${loc.name} | ${it.name}: par=${par}${it.baseUnit} reorder=${reorder}${it.baseUnit} stock=${stockLine}`);
      }

      if (APPLY) {
        await updateLocationIngredient(it.id, loc.id, ORG_ID, {
          parLevel: String(par),
          reorderQty: String(reorder),
        });
        if (!hasStock && stockQty !== undefined) {
          await addStock(loc.id, it.id, stockQty);
        }
      }
    }
  }

  console.log(`Mode: ${APPLY ? "APPLY (writing to DB)" : "PREVIEW (no writes)"}`);
  console.log(`Items: ${items.length} × ${LOCATIONS.length} locations = ${items.length * LOCATIONS.length} rows`);
  console.log(`  par/reorder set on: all ${items.length * LOCATIONS.length} rows`);
  console.log(`  stock_level created: ${createdCount}`);
  console.log(`  stock_level preserved (untouched): ${preservedCount}`);
  console.log(`  stock bucket distribution (new rows only): ${JSON.stringify(bucketCounts)}`);

  console.log(`\nSample rows (one per classification group, ${LOCATIONS[0].name}):`);
  for (const line of sampleByGroup.values()) console.log(line);

  console.log(`\nFixture / anchor items (both locations):`);
  for (const line of fixtureLines) console.log(line);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

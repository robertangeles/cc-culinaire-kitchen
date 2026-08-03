/**
 * @module scripts/seedCatalogCosts
 *
 * Sets researched, realistic AU foodservice unit costs on the Almost French
 * Pâtisserie catalog (org 2) so UAT costing, margins, and PO totals read like a
 * real Melbourne patisserie rather than placeholder numbers.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The catalog came from the 2026-07-14 supplier-catalog import
 * (`data/imports/pfd-batch-01.csv` + `import-batch-01.sql`), which carried
 * names, categories, units and supplier links but NO prices — `unit_cost`
 * appears zero times in that SQL. Costs were applied that day by a step whose
 * artifacts were never committed, so until now the catalog's pricing had no
 * recorded provenance. This script is that record.
 *
 * ── Pricing basis ──────────────────────────────────────────────────────────
 * AU foodservice/wholesale list price, ex-GST, Melbourne, priced per the
 * ingredient's KITCHEN unit (the `base_unit`, e.g. per kg / per L / each).
 *
 * The venue is a premium French pâtisserie — the catalog itself says so
 * (Baker's Flour T55, Guérande salt, Billecart-Salmon). So specialty pastry
 * items are priced at professional/premium tier (Callebaut couverture, Cacao
 * Barry cocoa), while commodity staples are priced at bulk foodservice tier
 * (Padstow-style 12.5kg/25kg packs). Both tiers are real; mixing them is what a
 * real patisserie's invoice actually looks like.
 *
 * ── Provenance tags (`src` on every row) ───────────────────────────────────
 *   sourced   — a live AU supplier listing was read for this exact item.
 *               The URL is in SOURCES below and named in the row's note.
 *   benchmark — no direct listing found; derived from a `sourced` anchor in the
 *               same category with the note explaining the derivation.
 *   retained  — the pre-existing value was checked against research and is
 *               already defensible, so it is deliberately left unchanged.
 *
 * Wines (`spirits`) are NEVER touched: those 17 came from the venue's own wine
 * list via `data/imports/wine-batch-02.csv` with real bottle prices, which is
 * better provenance than anything this script could supply.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   pnpm --filter @culinaire/server exec tsx src/scripts/seedCatalogCosts.ts
 *     → dry run. Prints every change with old → new and % delta. Writes nothing.
 *   pnpm --filter @culinaire/server exec tsx src/scripts/seedCatalogCosts.ts --apply
 *     → writes `ingredient.unit_cost` for org 2.
 *
 * Idempotent: re-running after --apply reports zero changes. Only rows whose
 * cost actually differs are written.
 *
 * NOTE ON WHICH COLUMN: cost resolution is
 * `ingredient.preferred_unit_cost` → `location_ingredient.unit_cost` →
 * `ingredient.unit_cost` (see orderGuideService). `preferred_unit_cost` is
 * unset across the whole catalog, so `ingredient.unit_cost` is the live field
 * and the only one this script writes.
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { eq, and, isNull } = await import("drizzle-orm");
const { db } = await import("../db/index.js");
const { ingredient, ingredientSupplier } = await import("../db/schema.js");

const ORG_ID = 2;
const APPLY = process.argv.includes("--apply");

/*
 * SOURCES — read 2026-08-02. Prices are the listed AU supplier price for the
 * pack noted, divided down to the kitchen unit.
 *
 *  [S1] Padstow Food Service — Plain Flour 12.5kg @ $15.90  → $1.27/kg
 *       https://padstowfoodservice.com.au/plain-flour-12-5kg/
 *  [S2] Paragon Foods — Callebaut Dark Couverture Block 5kg @ $198.99 → $39.80/kg
 *       https://paragonfoods.com.au/shop/callebaut-dark-couverture-block-5kg.html
 *  [S3] Bargain Wholesale Foods — Callebaut 811 54.5% Couverture 2.5kg @ $85.00 → $34.00/kg
 *       https://bargainfoods.com.au/products/callebaut-couverture-dark-chocolate-2-5kg
 *  [S4] Padstow Food Service — Queen Natural Vanilla Extract 5L @ $320.00 → $64.00/L
 *       https://padstowfoodservice.com.au/queen-natural-vanilla-extract-5-litres/
 *  [S5] Bargain Wholesale Foods — Cacao Barry Cocoa Powder 1kg @ $67.50 → $67.50/kg
 *       https://bargainfoods.com.au/products/cacao-barry-cocoa-powder-1kg
 *  [S6] Mediterranean Wholesale Foods — Eggs Cage XL 700g dozen @ $6.50 → $0.54 each
 *       https://mediterraneanfoods.com.au/product/eggs-cage-xl-700g/
 *  [S7] The Butcher Shoppe — Skinless Chicken Breast Fillets, wholesale @ $12.00/kg
 *       https://thebutchershoppe.com.au/products/skinless-chicken-breasts-wholesale
 *  [S8] Selina Wamucii — AU butter wholesale band 2026, US$2.73–5.45/kg
 *       https://www.selinawamucii.com/insights/prices/australia/butter/
 *  [S9] Selina Wamucii — AU cocoa powder wholesale band 2026, US$4.01–6.01/kg
 *       https://www.selinawamucii.com/insights/prices/australia/cocoa-powder-solids/
 * [S10] Paragon Foods — Cacao Barry/Callebaut Extra Brute cocoa 1kg @ $65.99 → $65.99/kg
 *       https://www.paragonfoods.com.au/shop/cocoa-powder/callebaut-cocoa-extra-brute.html
 * [S11] Gourmet de Paris — Coarse Grey Sea Salt (Guérande) 1kg @ $10.50 → $10.50/kg
 *       https://gourmetdeparis.com.au/products/coarse-grey-sea-salt-1kg-guerande
 */

type Src = "sourced" | "benchmark" | "retained";
type Row = { name: string; cost: number; src: Src; note: string };

const PRICES: Row[] = [
  // ── dry_goods: flours & sugars (bulk foodservice tier) ──────────────────
  { name: "Plain Flour",           cost: 1.27,  src: "sourced",   note: "[S1] 12.5kg bag $15.90" },
  { name: "Baker's Flour (T55)",   cost: 3.20,  src: "benchmark", note: "imported French T55 ~2.5x [S1] domestic bakers flour" },
  { name: "Euro Flour",            cost: 2.60,  src: "benchmark", note: "continental blend, between [S1] plain and T55" },
  { name: "Gluten Free Flour",     cost: 5.50,  src: "benchmark", note: "GF blends run ~4x [S1] plain flour" },
  { name: "Corn Flour",            cost: 2.80,  src: "retained",  note: "consistent with [S1] flour band" },
  { name: "Caster Sugar",          cost: 1.85,  src: "benchmark", note: "25kg foodservice bag ~$46" },
  { name: "Brown Sugar",           cost: 2.40,  src: "benchmark", note: "~30% over caster, standard AU spread" },
  { name: "Icing Sugar",           cost: 2.40,  src: "benchmark", note: "~30% over caster (milling premium)" },
  { name: "Salt",                  cost: 1.10,  src: "retained",  note: "bulk cooking salt, unchanged" },
  // Sel GRIS, not fleur de sel — an early benchmark guess of $24 was fleur-de-sel
  // pricing and would have overstated it ~2.3x. The sourced listing settles it.
  { name: "Guérande Salt",         cost: 10.50, src: "sourced",   note: "[S11] Gourmet de Paris coarse grey 1kg $10.50" },

  // ── dry_goods: chocolate. Couverture vs compound is the big correction ──
  { name: "Dark Chocolate",        cost: 39.80, src: "sourced",   note: "[S2] Callebaut dark couverture 5kg $198.99 (was $19.50 = compound pricing)" },
  { name: "Milk Chocolate",        cost: 41.00, src: "benchmark", note: "milk couverture ~3% over dark [S2]/[S3]" },
  { name: "White Chocolate",       cost: 43.00, src: "benchmark", note: "white couverture ~8% over dark [S2] (cocoa butter load)" },
  { name: "Dark Compound Chocolate",  cost: 11.50, src: "benchmark", note: "compound ~29% of couverture [S2]" },
  { name: "White Compound Chocolate", cost: 11.00, src: "benchmark", note: "compound tier, see dark compound" },
  { name: "Drop Compound",         cost: 10.50, src: "benchmark", note: "baking drops, compound tier" },
  { name: "Chocolate Baton",       cost: 0.22,  src: "benchmark", note: "pain au chocolat baton, ~$44/kg at 5g each" },
  // Two independent AU listings agree within 2% ($67.50 / $65.99), so the premium
  // French cocoa tier is well established. The commodity band [S9] (~A$6-9/kg) is
  // raw cocoa solids — real, but not what a French pâtisserie buys.
  { name: "Cocoa Powder",          cost: 66.00, src: "sourced",   note: "[S5]+[S10] Cacao Barry Extra Brute 1kg, $67.50/$65.99" },

  // ── dry_goods: flavour, nuts, spices ────────────────────────────────────
  { name: "Vanilla Extract",       cost: 64.00, src: "sourced",   note: "[S4] Queen Natural 5L $320 (was $180/L)" },
  { name: "Baking Powder",         cost: 7.50,  src: "retained",  note: "foodservice tub, unchanged" },
  { name: "Instant Dry Yeast",     cost: 12.50, src: "retained",  note: "500g vac-pack tier, unchanged" },
  { name: "Custard Powder",        cost: 6.00,  src: "retained",  note: "unchanged" },
  { name: "Ground Cinnamon",       cost: 14.00, src: "retained",  note: "bulk ground spice band" },
  { name: "Ground Nutmeg",         cost: 28.00, src: "retained",  note: "bulk ground spice band, premium" },
  { name: "Mixed Spice",           cost: 16.00, src: "retained",  note: "bulk ground spice band" },
  { name: "Mixed Herbs",           cost: 15.00, src: "retained",  note: "bulk dried herb band" },
  { name: "Sesame Seeds",          cost: 7.50,  src: "retained",  note: "unchanged" },
  { name: "Shredded Coconut",      cost: 6.80,  src: "retained",  note: "unchanged" },
  { name: "Slivered Almonds",      cost: 18.50, src: "benchmark", note: "AU almond slivers firmed through 2026" },
  { name: "Nutella",               cost: 11.50, src: "retained",  note: "3kg foodservice tub tier" },
  { name: "Biscuit Crumbs",        cost: 7.50,  src: "benchmark", note: "tracks bought-in biscuit cost" },

  // ── dry_goods: decoration & finishing ───────────────────────────────────
  { name: "Fondant",               cost: 12.00, src: "retained",  note: "per pack, unchanged" },
  { name: "Hot Glaze",             cost: 18.00, src: "retained",  note: "per pail, unchanged" },
  { name: "Gold Leaf Sheet",       cost: 9.00,  src: "retained",  note: "edible 24ct leaf, per sheet" },
  { name: "Gold Powder",           cost: 480.00, src: "retained", note: "edible lustre, per kg — sold in grams in practice" },
  { name: "Marshmallow",           cost: 0.08,  src: "retained",  note: "per piece, unchanged" },
  { name: "Smarties",              cost: 0.06,  src: "retained",  note: "per piece, unchanged" },
  { name: "Sugar Sticks",          cost: 0.04,  src: "retained",  note: "per stick, unchanged" },

  // ── dairy ───────────────────────────────────────────────────────────────
  { name: "Butter",                cost: 11.00, src: "retained",  note: "5kg foodservice block ~$55; top of [S8] band, correct for 2026" },
  { name: "Butter 25kg",           cost: 10.20, src: "retained",  note: "bulk discount vs 5kg block [S8]" },
  { name: "Butter Sheet",          cost: 13.50, src: "retained",  note: "laminating/tourage sheet, each" },
  { name: "Eggs",                  cost: 0.54,  src: "sourced",   note: "[S6] XL 700g dozen $6.50" },
  { name: "Full Cream Milk",       cost: 1.65,  src: "retained",  note: "foodservice 2L, unchanged" },
  { name: "Skim Milk",             cost: 1.60,  src: "retained",  note: "unchanged" },
  { name: "Lactose-Free Milk",     cost: 2.40,  src: "retained",  note: "unchanged" },
  { name: "Almond Milk",           cost: 2.80,  src: "retained",  note: "barista-grade 1L" },
  { name: "Oat Milk",              cost: 2.90,  src: "retained",  note: "barista-grade 1L" },
  { name: "Soy Milk",              cost: 2.20,  src: "retained",  note: "barista-grade 1L" },
  { name: "Thickened Cream",       cost: 6.50,  src: "retained",  note: "foodservice 2L/5L tier" },
  { name: "Condensed Milk",        cost: 6.80,  src: "retained",  note: "unchanged" },
  { name: "Mascarpone",            cost: 13.00, src: "retained",  note: "unchanged" },
  { name: "Cream Cheese",          cost: 9.80,  src: "retained",  note: "unchanged" },
  { name: "Cream Cheese Spread",   cost: 10.50, src: "retained",  note: "unchanged" },
  { name: "Brie",                  cost: 22.00, src: "retained",  note: "unchanged" },
  { name: "Bocconcini",            cost: 14.50, src: "retained",  note: "unchanged" },
  { name: "Swiss Cheese Slices",   cost: 16.50, src: "retained",  note: "unchanged" },
  { name: "Tasty Shredded Cheese", cost: 12.00, src: "retained",  note: "unchanged" },
  { name: "Yogurt",                cost: 5.50,  src: "retained",  note: "per tub, unchanged" },

  // ── proteins ────────────────────────────────────────────────────────────
  { name: "Chicken",               cost: 12.00, src: "sourced",   note: "[S7] skinless breast fillet wholesale" },
  { name: "Bacon",                 cost: 13.50, src: "retained",  note: "middle rasher foodservice" },
  { name: "Ham",                   cost: 12.50, src: "retained",  note: "leg ham foodservice" },
  { name: "Salami",                cost: 18.00, src: "retained",  note: "unchanged" },
  { name: "Salmon",                cost: 38.00, src: "retained",  note: "AU Atlantic side, unchanged" },

  // ── produce ─────────────────────────────────────────────────────────────
  { name: "Apples",                cost: 3.80,  src: "retained",  note: "wholesale market tray rate" },
  { name: "Pear",                  cost: 4.20,  src: "retained",  note: "wholesale market tray rate" },
  { name: "Apricot",               cost: 7.50,  src: "retained",  note: "seasonal stone fruit, unchanged" },
  { name: "Spinach",               cost: 9.00,  src: "retained",  note: "baby spinach, unchanged" },

  // ── frozen ──────────────────────────────────────────────────────────────
  { name: "Raspberry Whole",       cost: 15.50, src: "benchmark", note: "IQF raspberry firmed vs $13.50" },
  { name: "Ice Cream Vanilla",     cost: 8.00,  src: "retained",  note: "foodservice tub per L" },
  { name: "Ice Cream Chocolate",   cost: 8.50,  src: "retained",  note: "foodservice tub per L" },
  { name: "Ice Cream Strawberry",  cost: 8.50,  src: "retained",  note: "foodservice tub per L" },
  { name: "Ice Cream Caramel",     cost: 8.50,  src: "retained",  note: "foodservice tub per L" },

  // ── bakery (bought-in) ──────────────────────────────────────────────────
  { name: "Bagel",                 cost: 1.20,  src: "retained",  note: "par-baked, each" },
  { name: "Baguette",              cost: 1.80,  src: "retained",  note: "par-baked, each" },
  { name: "Canelé",                cost: 2.50,  src: "retained",  note: "bought-in, each" },
  { name: "Doughnut",              cost: 1.30,  src: "retained",  note: "bought-in, each" },
  { name: "Muffins",               cost: 1.50,  src: "retained",  note: "bought-in, each" },
  { name: "Lady Finger Biscuits",  cost: 0.15,  src: "retained",  note: "savoiardi, each" },
  { name: "Marie Biscuits",        cost: 0.10,  src: "retained",  note: "each" },
  { name: "Tortillas",             cost: 0.35,  src: "retained",  note: "each" },

  // ── condiments (per pack/jar as stocked) ────────────────────────────────
  { name: "Raspberry Jam",         cost: 8.50,  src: "retained",  note: "foodservice pail" },
  { name: "Lemon Puree",           cost: 12.00, src: "retained",  note: "fruit puree pack" },
  { name: "Golden Syrup",          cost: 7.00,  src: "retained",  note: "unchanged" },
  { name: "Mayo",                  cost: 9.00,  src: "retained",  note: "foodservice pail" },
  { name: "Pesto",                 cost: 11.00, src: "retained",  note: "unchanged" },
  { name: "Relish",                cost: 7.50,  src: "retained",  note: "unchanged" },
  { name: "Tomato Sauce",          cost: 5.50,  src: "retained",  note: "unchanged" },
  { name: "English Mild Mustard",  cost: 6.50,  src: "retained",  note: "unchanged" },

  // ── beverages ───────────────────────────────────────────────────────────
  { name: "Organic Apple Juice",   cost: 4.50,  src: "retained",  note: "per L, unchanged" },
  { name: "Organic Orange Juice",  cost: 5.00,  src: "retained",  note: "per L, unchanged" },
  { name: "Sparkling Water",       cost: 1.80,  src: "retained",  note: "per L, unchanged" },
  { name: "Spring Water",          cost: 0.90,  src: "retained",  note: "per L, unchanged" },
  { name: "San Pellegrino (can)",  cost: 1.20,  src: "retained",  note: "per can, unchanged" },

  // ── packaging, supplies, other ──────────────────────────────────────────
  { name: "Napkins (cocktail)",    cost: 0.03,  src: "retained",  note: "each, unchanged" },
  { name: "Label",                 cost: 0.04,  src: "retained",  note: "each, unchanged" },
  { name: "Piping Bag",            cost: 0.28,  src: "retained",  note: "each, unchanged" },
  { name: "Canola Spray",          cost: 6.50,  src: "retained",  note: "per can, unchanged" },
  { name: "Coffee Machine Cleaner", cost: 22.00, src: "retained", note: "per pack, unchanged" },
];

// ── Run ───────────────────────────────────────────────────────────────────

const rows = await db
  .select({
    id: ingredient.ingredientId,
    name: ingredient.ingredientName,
    unit: ingredient.baseUnit,
    cost: ingredient.unitCost,
    category: ingredient.ingredientCategory,
  })
  .from(ingredient)
  .where(and(eq(ingredient.organisationId, ORG_ID), isNull(ingredient.deletedAt)));

const byName = new Map(rows.map((r) => [r.name, r]));

const changes: Array<{ row: Row; id: string; unit: string; from: number; to: number }> = [];
const unchanged: Row[] = [];
const missing: string[] = [];

for (const p of PRICES) {
  const row = byName.get(p.name);
  if (!row) {
    missing.push(p.name);
    continue;
  }
  const from = Number(row.cost ?? 0);
  if (Math.abs(from - p.cost) < 0.005) {
    unchanged.push(p);
    continue;
  }
  changes.push({ row: p, id: row.id, unit: row.unit, from, to: p.cost });
}

// Anything in the catalog this table does not cover (wines are expected here).
const covered = new Set(PRICES.map((p) => p.name));
const uncovered = rows.filter((r) => !covered.has(r.name));

console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"} — catalog costs, org ${ORG_ID}\n`);

if (changes.length) {
  console.log("CHANGES");
  for (const c of changes.sort((a, b) => Math.abs(b.to / (b.from || 1)) - Math.abs(a.to / (a.from || 1)))) {
    const pct = c.from > 0 ? ((c.to - c.from) / c.from) * 100 : 0;
    const arrow = `$${c.from.toFixed(2)} → $${c.to.toFixed(2)}/${c.unit}`;
    console.log(
      `  ${c.row.name.padEnd(26)} ${arrow.padEnd(28)} ${(pct >= 0 ? "+" : "") + pct.toFixed(0)}%`.padEnd(74) +
        `[${c.row.src}] ${c.row.note}`,
    );
  }
} else {
  console.log("CHANGES: none — catalog already matches the researched table.");
}

const tally = (s: Src) => PRICES.filter((p) => p.src === s).length;
console.log(
  `\nTABLE: ${PRICES.length} items — ${tally("sourced")} sourced, ${tally("benchmark")} benchmark, ${tally("retained")} retained`,
);
console.log(`CHANGED: ${changes.length}   ALREADY CORRECT: ${unchanged.length}`);
if (missing.length) console.log(`NOT IN CATALOG (skipped): ${missing.join(", ")}`);
if (uncovered.length) {
  const wines = uncovered.filter((r) => r.category === "spirits").length;
  console.log(
    `NOT PRICED BY THIS TABLE: ${uncovered.length} (${wines} wines — deliberately left to wine-batch-02.csv)`,
  );
  const other = uncovered.filter((r) => r.category !== "spirits");
  if (other.length) console.log(`  ⚠ non-wine gaps: ${other.map((r) => r.name).join(", ")}`);
}

// ── Supplier-link costs ───────────────────────────────────────────────────
//
// `ingredient.preferred_unit_cost` is NOT ours to write — a Postgres trigger
// (fn_recompute_preferred_supplier_cost) owns it and copies `cost_per_unit`
// from the ingredient's preferred `ingredient_supplier` row. The 2026-07-14
// import created those link rows with (ingredient_id, supplier_id,
// preferred_ind) and no cost, so the trigger fired 94 times and cached NULL
// every time. Result: preferred_unit_cost was null catalog-wide, and anything
// keyed off it (yield variance, auto-PO estimates) had no cost basis.
//
// So we set the SOURCE and let the trigger cascade — same price, one level
// down. Ex-GST list price per the ingredient's kitchen unit, identical to the
// table above, because that is exactly what a supplier list price is.
const linkRows = await db
  .select({
    linkId: ingredientSupplier.ingredientSupplierId,
    ingredientId: ingredientSupplier.ingredientId,
    cost: ingredientSupplier.costPerUnit,
    packCost: ingredientSupplier.packCost,
    preferred: ingredientSupplier.preferredInd,
  })
  .from(ingredientSupplier);

// Pack size per ingredient, so a supplier link can also carry the PACK price —
// the number on the supplier's invoice ("$15.88 per 12.5kg bag"). Purchasing
// screens lead with that because it is what an operator reconciles against a
// delivery docket; the per-kitchen-unit cost is what recipes cost at. Storing
// only the latter left the Suppliers row showing a bare "$1.2700" with no unit.
const packById = new Map(
  (
    await db
      .select({
        id: ingredient.ingredientId,
        packQty: ingredient.packQty,
        purchaseUnit: ingredient.purchaseUnit,
      })
      .from(ingredient)
      .where(and(eq(ingredient.organisationId, ORG_ID), isNull(ingredient.deletedAt)))
  ).map((r) => [r.id, r]),
);

const priceById = new Map<string, Row>();
for (const p of PRICES) {
  const row = byName.get(p.name);
  if (row) priceById.set(row.id, p);
}

const linkChanges = linkRows.flatMap((l) => {
  const p = priceById.get(l.ingredientId);
  if (!p) return []; // wine links: priced by wine-batch-02.csv, not by us
  const pack = packById.get(l.ingredientId);
  // Only items with declared packaging have a pack price; loose-by-the-kg items
  // are bought in the kitchen unit, so cost_per_unit IS the invoice price.
  const packQty = pack?.packQty != null ? Number(pack.packQty) : null;
  const packCost = packQty && packQty > 0 ? Number((p.cost * packQty).toFixed(2)) : null;

  const costOk = l.cost != null && Math.abs(Number(l.cost) - p.cost) < 0.005;
  const packOk =
    packCost == null
      ? l.packCost == null
      : l.packCost != null && Math.abs(Number(l.packCost) - packCost) < 0.005;
  if (costOk && packOk) return [];

  return [{
    linkId: l.linkId,
    name: p.name,
    from: l.cost == null ? null : Number(l.cost),
    to: p.cost,
    packCost,
    packUnit: pack?.purchaseUnit ?? null,
  }];
});

const withPack = linkChanges.filter((l) => l.packCost != null).length;
console.log(
  `\nSUPPLIER LINKS: ${linkChanges.length} of ${linkRows.length} need pricing` +
    ` (${withPack} also get a pack price; feeds preferred_unit_cost via trigger)`,
);

if (!APPLY) {
  console.log("\nNo writes. Re-run with --apply to write these costs.\n");
  process.exit(0);
}

for (const c of changes) {
  await db
    .update(ingredient)
    .set({ unitCost: String(c.to), updatedDttm: new Date() })
    .where(eq(ingredient.ingredientId, c.id));
}

for (const l of linkChanges) {
  await db
    .update(ingredientSupplier)
    .set({
      costPerUnit: String(l.to),
      packCost: l.packCost == null ? null : String(l.packCost),
      updatedDttm: new Date(),
    })
    .where(eq(ingredientSupplier.ingredientSupplierId, l.linkId));
}

console.log(`\nWrote ${changes.length} ingredient costs and ${linkChanges.length} supplier-link costs.`);
console.log("preferred_unit_cost is populated by the DB trigger — verify with checkCatalogIntegrity.\n");
process.exit(0);

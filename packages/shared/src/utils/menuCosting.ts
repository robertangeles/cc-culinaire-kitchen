/**
 * @module utils/menuCosting
 *
 * Menu and recipe costing: line cost, food cost, food cost %, contribution margin, plate P&L cost, menu
 * engineering classification, and the thresholds the screens colour by. Pure functions only, so the server,
 * the web client and the phone import the same maths.
 *
 * The web editor and the server do not round or guard identically. Where they differ, each behaviour keeps its
 * own named function (`preview*`/`editor*` for the web editor, `stored*` for what the server writes) instead of
 * one being silently picked. The differences are listed in menuCosting.test.ts.
 *
 * Formulas:
 *   line_cost = (quantity in the ingredient's kitchen unit × unit_cost) / (yield_pct / 100)
 *   food_cost per sale = Σ line_cost / servings × (1 + Q%) × servings_per_sale
 *   food_cost_pct = food_cost / selling_price × 100
 *   contribution_margin = selling_price − food_cost
 */

/** A food cost % above this is shown in alert colours (dashboard cards, item detail, cost summary). */
export const FOOD_COST_ALERT_PCT = 35;

/** The target food cost % of a category nobody has set a target for. */
export const DEFAULT_CATEGORY_TARGET_PCT = 30;

export type MenuClassification = "star" | "plowhorse" | "puzzle" | "dog" | "unclassified";

/** How much prep a dish earns by its menu engineering class; an unknown class weighs as much as an unclassified one. */
export const CLASSIFICATION_PREP_WEIGHTS: Record<string, number> = {
  star: 4,
  plowhorse: 3,
  puzzle: 2,
  dog: 1,
  unclassified: 2,
};

export function classificationPrepWeight(classification: string | null | undefined): number {
  return CLASSIFICATION_PREP_WEIGHTS[classification ?? "unclassified"] ?? 2;
}

// ---------------------------------------------------------------------------
// Line cost
// ---------------------------------------------------------------------------

/** An ingredient row as the numeric columns carry it: strings. */
export interface LineCostInput {
  quantity: string;
  unitCost: string;
  yieldPct: string;
}

/**
 * The web editor's live line cost, in dollars rounded half-up with Math.round. A blank, zero or unreadable
 * yield counts as 100%, a blank quantity or cost as 0, and `toKitchenQty` returning null (no unit path) as 0.
 */
export function previewLineCost(line: LineCostInput, toKitchenQty: (qty: number) => number | null): number {
  const qty = parseFloat(line.quantity) || 0;
  const cost = parseFloat(line.unitCost) || 0;
  const yld = parseFloat(line.yieldPct) || 100;

  const qtyInBase = toKitchenQty(qty);
  if (qtyInBase === null) return 0;
  const raw = (qtyInBase * cost) / (yld / 100);
  return Math.round(raw * 100) / 100;
}

/**
 * The line cost the server stores (menu_item_ingredient.line_cost), in dollars to two places with toFixed.
 * An unreadable quantity, cost or yield, or a zero yield, stores "0.00" without asking `toKitchenQty`; a
 * `toKitchenQty` that throws (units with no path between them) throws out of here.
 */
export async function storedLineCost(
  line: LineCostInput,
  toKitchenQty: (qty: number) => Promise<number> | number,
): Promise<string> {
  const qty = parseFloat(line.quantity);
  const cost = parseFloat(line.unitCost);
  const yld = parseFloat(line.yieldPct);
  if (!Number.isFinite(qty) || !Number.isFinite(cost) || !Number.isFinite(yld) || yld === 0) {
    return "0.00";
  }

  const qtyInBase = await toKitchenQty(qty);
  return ((qtyInBase * cost) / (yld / 100)).toFixed(2);
}

/** A line cost with no rounding, for the explanation under a row ("0.5 kg × $4 / 80% yield = $2.50"). */
export function rawLineCost(qtyInBase: number, cost: number, yld: number): number {
  return yld > 0 ? (qtyInBase * cost) / (yld / 100) : 0;
}

// ---------------------------------------------------------------------------
// Item cost
// ---------------------------------------------------------------------------

/** One serving's cost: the batch split by servings, plus the Q factor (a buffer for small unlisted costs). */
function perServingWithQ(totalLineCost: number, servings: number, qFactorPct: number): number {
  const perServing = servings > 1 ? totalLineCost / servings : totalLineCost;
  return qFactorPct > 0 ? perServing * (1 + qFactorPct / 100) : perServing;
}

export interface EditorItemCosts {
  /** Per serving, with the Q factor. */
  foodCostWithQ: number;
  /** How many servings one sale covers (at least 1). */
  salePack: number;
  /** Per sale, so it pairs with the selling price. */
  foodCostPerSale: number;
  foodCostPct: number;
  contributionMargin: number;
}

/**
 * What the web item editor shows under the ingredient table. Nothing is rounded here; the screen formats.
 * A servings-per-sale below 1 counts as 1, an unreadable Q factor or price as 0.
 */
export function editorItemCosts(input: {
  totalBatchCost: number;
  servings: number;
  qFactorPct: string;
  servingsPerSale: number;
  sellingPrice: string;
}): EditorItemCosts {
  const qPct = parseFloat(input.qFactorPct) || 0;
  const foodCostWithQ = perServingWithQ(input.totalBatchCost, input.servings, qPct);

  const price = parseFloat(input.sellingPrice) || 0;
  const salePack = Math.max(1, input.servingsPerSale || 1);
  const foodCostPerSale = foodCostWithQ * salePack;
  const foodCostPct = price > 0 ? (foodCostPerSale / price) * 100 : 0;
  const contributionMargin = price - foodCostPerSale;

  return { foodCostWithQ, salePack, foodCostPerSale, foodCostPct, contributionMargin };
}

/**
 * What the server stores on a menu item (food_cost, food_cost_pct, contribution_margin), two places each.
 * The line costs are the stored strings; a missing one counts as 0. Servings-per-sale is used as given.
 */
export function storedItemCosts(input: {
  lineCosts: Array<string | null>;
  servings: number | null;
  servingsPerSale: number | null;
  qFactorPct: string | null;
  sellingPrice: string;
}): { foodCost: string; foodCostPct: string; contributionMargin: string } {
  const total = input.lineCosts.reduce((sum, c) => sum + parseFloat(c ?? "0"), 0);
  const perServing = perServingWithQ(total, input.servings ?? 1, parseFloat(input.qFactorPct ?? "0"));
  // Yield ≠ sales unit: servings is what the batch MAKES, servings_per_sale how many of them one sale
  // (the price) covers. The cost is per SALE so it always pairs with the selling price.
  const foodCost = perServing * (input.servingsPerSale ?? 1);
  const sellingPrice = parseFloat(input.sellingPrice);
  const foodCostPct = sellingPrice > 0 ? (foodCost / sellingPrice) * 100 : 0;
  return {
    foodCost: foodCost.toFixed(2),
    foodCostPct: foodCostPct.toFixed(2),
    contributionMargin: (sellingPrice - foodCost).toFixed(2),
  };
}

/**
 * The plate P&L food cost: the line costs priced at the location's weighted average cost, per serving with the
 * Q factor, rounded to cents. Unlike `storedItemCosts` it does not multiply by servings-per-sale, so for a pack
 * item it is one serving's cost, not one sale's.
 */
export function plateFoodCost(totalLineCost: number, servings: number | null, qFactorPct: string | null): number {
  return Number(perServingWithQ(totalLineCost, servings ?? 1, parseFloat(qFactorPct ?? "0")).toFixed(2));
}

// ---------------------------------------------------------------------------
// Menu engineering
// ---------------------------------------------------------------------------

/** Share of all units sold, in percent. */
export function menuMixPct(unitsSold: number, totalUnitsSold: number): number {
  return totalUnitsSold > 0 ? (unitsSold / totalUnitsSold) * 100 : 0;
}

export interface EngineeringRow {
  unitsSold: number;
  contributionMargin: number;
  menuMixPct: number;
}

/**
 * The server's classification of a menu: the averages it used and the class of each row, in the order given. An item is a Star when its margin and its mix are
 * both at or above the average, a Plowhorse when only its mix is, a Puzzle when only its margin is, a Dog when
 * neither; an item with no sales is unclassified. The averages are taken over EVERY item given, unsold ones
 * included (see `matrixAverages` for the web chart's population).
 */
export function classifyAgainstWholeMenu(
  rows: EngineeringRow[],
): { avgCM: number; avgMix: number; classifications: MenuClassification[] } {
  const avgCM = rows.reduce((sum, r) => sum + r.contributionMargin, 0) / rows.length;
  const avgMix = rows.reduce((sum, r) => sum + r.menuMixPct, 0) / rows.length;

  const classifications = rows.map((r): MenuClassification => {
    if (r.unitsSold === 0) return "unclassified";
    if (r.contributionMargin >= avgCM && r.menuMixPct >= avgMix) return "star";
    if (r.contributionMargin < avgCM && r.menuMixPct >= avgMix) return "plowhorse";
    if (r.contributionMargin >= avgCM && r.menuMixPct < avgMix) return "puzzle";
    return "dog";
  });
  return { avgCM, avgMix, classifications };
}

/**
 * The web matrix's crosshair and axis range, over the items that sold (the caller passes only those): the
 * average margin and mix, and each maximum with 20% headroom (1 when it would be 0).
 */
export function matrixAverages(sold: EngineeringRow[]): { avgCM: number; avgMix: number; maxCM: number; maxMix: number } {
  if (sold.length === 0) {
    return { avgCM: 0, avgMix: 0, maxCM: 1, maxMix: 1 };
  }
  const avgCM = sold.reduce((s, i) => s + i.contributionMargin, 0) / sold.length;
  const avgMix = sold.reduce((s, i) => s + i.menuMixPct, 0) / sold.length;
  const maxCM = Math.max(...sold.map((i) => i.contributionMargin)) * 1.2 || 1;
  const maxMix = Math.max(...sold.map((i) => i.menuMixPct)) * 1.2 || 1;
  return { avgCM, avgMix, maxCM, maxMix };
}

/** The average food cost % of a category's items; 0 for none. */
export function categoryActualFoodCostPct(items: Array<{ foodCostPct: number }>): number {
  if (items.length === 0) return 0;
  return items.reduce((sum, i) => sum + i.foodCostPct, 0) / items.length;
}

export interface AnalysisRow {
  sellingPrice: number;
  foodCost: number;
  foodCostPct: number;
  contributionMargin: number;
  unitsSold: number;
  classification: string;
}

/** The dashboard totals: counts per class, averages over every item, revenue and food cost weighted by units sold. */
export function summariseMenuAnalysis(items: AnalysisRow[]) {
  const totalItems = items.length;
  const classified = items.filter((i) => i.classification !== "unclassified");
  const count = (c: string) => classified.filter((i) => i.classification === c).length;

  const avgFoodCostPct = totalItems > 0 ? items.reduce((sum, i) => sum + i.foodCostPct, 0) / totalItems : 0;
  const avgContributionMargin = totalItems > 0 ? items.reduce((sum, i) => sum + i.contributionMargin, 0) / totalItems : 0;
  const totalRevenue = items.reduce((sum, i) => sum + i.sellingPrice * i.unitsSold, 0);
  const totalFoodCost = items.reduce((sum, i) => sum + i.foodCost * i.unitsSold, 0);

  return {
    totalItems,
    stars: count("star"),
    plowhorses: count("plowhorse"),
    puzzles: count("puzzle"),
    dogs: count("dog"),
    unclassified: totalItems - classified.length,
    avgFoodCostPct: avgFoodCostPct.toFixed(1),
    avgContributionMargin: avgContributionMargin.toFixed(2),
    totalRevenue: totalRevenue.toFixed(2),
    totalFoodCost: totalFoodCost.toFixed(2),
    overallFoodCostPct: totalRevenue > 0 ? ((totalFoodCost / totalRevenue) * 100).toFixed(1) : "0",
  };
}

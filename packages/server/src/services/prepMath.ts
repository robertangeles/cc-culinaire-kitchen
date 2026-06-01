/**
 * @module services/prepMath
 *
 * Pure, DB-free math for the forecast-driven prep planner. Kept separate from
 * prepService (which does the I/O) so every rule here is unit-testable in
 * isolation. Two responsibilities:
 *
 *   1. computeSuggestedSelections — forecast covers → suggested per-item counts
 *   2. (T4 will add) aggregatePrepLines — scaled, id-keyed, stationed rollup
 *
 * Forecast pipeline (verified industry model, no POS required):
 *
 *   covers ──┐
 *            ├─ group selected items by category
 *            ├─ attach_rate(category)  (how many of that course per cover)
 *            ├─ mix%(item)             (share WITHIN its category)
 *            │     historical: unitsSold_i / Σ unitsSold_in_category
 *            │     else:       1 / N_in_category        [basis = "estimated"]
 *            └─ suggested = round(covers × attach × mix × buffer)
 *
 * Multiplying by an in-category mix% and a per-category attach rate does NOT
 * double-count: Σ over a category = covers × attach (e.g. all entrées sum to
 * ~covers; desserts sum to ~covers × 0.4).
 */

/** Default "prep for the rush" buffer applied on top of the raw forecast. */
export const DEFAULT_PREP_BUFFER = 1.25;

/**
 * Map a free-text menu category to a course attach rate (orders per cover).
 * Unknown categories default to 1.0 (treat as a main) — over-suggesting is
 * recoverable by the chef; under-suggesting risks an 86'd item.
 */
export function attachRateFor(category: string | null | undefined): number {
  const c = (category ?? "").trim().toLowerCase();
  if (!c) return 1.0;
  const has = (...keys: string[]) => keys.some((k) => c.includes(k));
  if (has("dessert", "sweet", "pastry", "patisserie")) return 0.4;
  if (has("starter", "appetiser", "appetizer", "small plate", "tapas", "snack")) return 0.5;
  if (has("side")) return 0.5;
  if (has("drink", "beverage", "cocktail", "wine", "beer", "spirit")) return 0.5;
  if (has("soup", "salad")) return 0.6;
  if (has("main", "entree", "entrée", "pasta", "pizza", "burger", "plate", "mains")) return 1.0;
  return 1.0;
}

export interface SuggestInputItem {
  menuItemId: string;
  category: string | null;
  /** Historical units sold (0 when no sales/POS data — triggers the 1/N baseline). */
  unitsSold: number;
}

export interface SuggestedSelection {
  menuItemId: string;
  /** Suggested expected_portions for the prep session (chef-editable). */
  suggestedPortions: number;
  /** "historical" = derived from real sales mix; "estimated" = even 1/N baseline. */
  basis: "historical" | "estimated";
}

/**
 * Suggest per-item portion counts from a forecast cover count. Pure.
 * Returns one entry per input item, in input order. Never throws.
 */
export function computeSuggestedSelections(
  covers: number,
  items: SuggestInputItem[],
  opts: { buffer?: number } = {},
): SuggestedSelection[] {
  const buffer = opts.buffer ?? DEFAULT_PREP_BUFFER;
  if (!Array.isArray(items) || items.length === 0) return [];
  // Non-positive covers → no prep suggested (endpoint also validates covers ≥ 1).
  const safeCovers = Number.isFinite(covers) && covers > 0 ? covers : 0;

  // Group by normalised category to compute in-category mix + attach rate.
  const groups = new Map<string, SuggestInputItem[]>();
  for (const it of items) {
    const key = (it.category ?? "").trim().toLowerCase() || "__uncategorised__";
    const g = groups.get(key);
    if (g) g.push(it);
    else groups.set(key, [it]);
  }

  const out = new Map<string, SuggestedSelection>();
  for (const [, group] of groups) {
    const attach = attachRateFor(group[0].category);
    const totalSold = group.reduce((s, it) => s + (Number(it.unitsSold) || 0), 0);
    const n = group.length;
    for (const it of group) {
      const hasHistory = totalSold > 0;
      const mix = hasHistory ? (Number(it.unitsSold) || 0) / totalSold : 1 / n;
      const raw = safeCovers * attach * mix * buffer;
      out.set(it.menuItemId, {
        menuItemId: it.menuItemId,
        suggestedPortions: safeCovers > 0 ? Math.max(0, Math.round(raw)) : 0,
        basis: hasHistory ? "historical" : "estimated",
      });
    }
  }

  // Preserve input order.
  return items.map(
    (it) =>
      out.get(it.menuItemId) ?? {
        menuItemId: it.menuItemId,
        suggestedPortions: 0,
        basis: "estimated" as const,
      },
  );
}

// ---------------------------------------------------------------------------
// aggregatePrepLines — scale + roll up ingredient lines into prep lines
// ---------------------------------------------------------------------------

/** Catalog ingredient category → kitchen station (ported from misePlaceService). */
const STATION_BY_CATEGORY: Record<string, string> = {
  proteins: "Grill / Protein",
  produce: "Garde Manger",
  dairy: "Cold",
  dry_goods: "Pantry / Dry",
  beverages: "Bar",
  spirits: "Bar",
  frozen: "Freezer",
  bakery: "Pastry / Bakery",
  condiments: "Pantry / Dry",
  other: "Other",
};

/** Resolve a kitchen station from a catalog ingredient category. Unknown → "Other". */
export function stationFor(category: string | null | undefined): string {
  if (!category) return "Other";
  return STATION_BY_CATEGORY[category.trim().toLowerCase()] ?? "Other";
}

/**
 * Scale one ingredient line to the forecasted portion count.
 *
 *   scaled = quantity × (expectedPortions / servings) ÷ (yieldPct / 100)
 *
 * `quantity` is the per-BATCH amount (a recipe/dish batch yields `servings`
 * portions — confirmed T0 against the cost subsystem). `servings` and
 * `yieldPct` are floored to safe values so bad data never divides by zero.
 */
export function scaledLineQuantity(
  quantity: number,
  expectedPortions: number,
  servings: number,
  yieldPct: number,
): number {
  const q = Number.isFinite(quantity) ? quantity : 0;
  const portions = Number.isFinite(expectedPortions) ? expectedPortions : 0;
  const s = Number.isFinite(servings) && servings > 0 ? servings : 1;
  const y = Number.isFinite(yieldPct) && yieldPct > 0 ? yieldPct : 100;
  return (q * (portions / s)) / (y / 100);
}

/** One un-aggregated ingredient line feeding the prep rollup. */
export interface PrepSourceLine {
  /** Catalog ingredient id, or null for recipe/free-text lines (name-keyed). */
  ingredientId: string | null;
  ingredientName: string;
  unit: string;
  /** Catalog ingredient category → station. Null for recipe/free-text lines. */
  category: string | null;
  quantity: number;
  yieldPct: number;
  /** Batch yield: menu_item.servings (menu path) or parsed recipe yield (recipe path). */
  servings: number;
  expectedPortions: number;
  dishName: string;
  menuItemId: string | null;
  recipeId: string | null;
  classificationWeight: number;
  prepTimeMinutes: number;
}

/** One aggregated prep line, keyed by (ingredient identity, unit). */
export interface AggregatedPrepLine {
  ingredientId: string | null;
  ingredientName: string;
  unit: string;
  station: string;
  /** Total forecast demand (before subtracting on-hand). */
  totalQuantity: number;
  /** Current on-hand stock in the same unit as totalQuantity. Null = no stock data (free-text ingredient). */
  onHandQty: number | null;
  /** What actually needs prepping: max(0, totalQuantity - onHandQty). Null when on-hand is unknown. */
  prepNeeded: number | null;
  dishes: string[];
  menuItemIds: string[];
  recipeIds: string[];
  prepTimeMinutes: number;
  classificationWeight: number;
}

/**
 * Attach on-hand stock to aggregated prep lines.
 * Called AFTER aggregatePrepLines with the stock data from the DB.
 * Pure — does not touch the DB.
 */
export function attachOnHand(
  lines: AggregatedPrepLine[],
  stockByIngredientId: Map<string, { qty: number; baseUnit: string }>,
  convertUnit: (qty: number, from: string, to: string) => number | null,
): AggregatedPrepLine[] {
  return lines.map((line) => {
    if (!line.ingredientId) return line;
    const stock = stockByIngredientId.get(line.ingredientId);
    if (!stock) return { ...line, onHandQty: 0, prepNeeded: line.totalQuantity };

    let onHand: number;
    if (stock.baseUnit === line.unit) {
      onHand = stock.qty;
    } else {
      const converted = convertUnit(stock.qty, stock.baseUnit, line.unit);
      if (converted === null) return line;
      onHand = converted;
    }
    const prepNeeded = Math.max(0, line.totalQuantity - onHand);
    return { ...line, onHandQty: Math.round(onHand * 1000) / 1000, prepNeeded: Math.round(prepNeeded * 1000) / 1000 };
  });
}

/**
 * Roll up scaled ingredient lines into prep lines. Pure.
 *
 * Keyed by `(ingredientId | name) + unit` — so "Tomato Sauce" and
 * "tomato sauce" sharing one catalog id merge into ONE batch number, but the
 * same ingredient in different units stays split (we never sum across units
 * without conversion). Station comes from the catalog category (menu lines);
 * recipe/free-text lines have no category → "Other".
 */
export function aggregatePrepLines(lines: PrepSourceLine[]): AggregatedPrepLine[] {
  type Acc = AggregatedPrepLine & { _dishSet: Set<string> };
  const map = new Map<string, Acc>();

  for (const ln of lines) {
    const scaled = scaledLineQuantity(ln.quantity, ln.expectedPortions, ln.servings, ln.yieldPct);
    if (!Number.isFinite(scaled)) continue;
    const idPart = ln.ingredientId
      ? `id:${ln.ingredientId}`
      : `name:${ln.ingredientName.toLowerCase().trim()}`;
    const key = `${idPart}|${ln.unit}`;
    const existing = map.get(key);

    if (existing) {
      existing.totalQuantity += scaled;
      if (!existing._dishSet.has(ln.dishName)) {
        existing._dishSet.add(ln.dishName);
        existing.dishes.push(ln.dishName);
      }
      if (ln.menuItemId && !existing.menuItemIds.includes(ln.menuItemId)) {
        existing.menuItemIds.push(ln.menuItemId);
      }
      if (ln.recipeId && !existing.recipeIds.includes(ln.recipeId)) {
        existing.recipeIds.push(ln.recipeId);
      }
      existing.prepTimeMinutes = Math.max(existing.prepTimeMinutes, ln.prepTimeMinutes);
      existing.classificationWeight = Math.max(existing.classificationWeight, ln.classificationWeight);
    } else {
      map.set(key, {
        ingredientId: ln.ingredientId,
        ingredientName: ln.ingredientName,
        unit: ln.unit,
        station: ln.ingredientId ? stationFor(ln.category) : "Other",
        totalQuantity: scaled,
        onHandQty: null,
        prepNeeded: null,
        dishes: [ln.dishName],
        menuItemIds: ln.menuItemId ? [ln.menuItemId] : [],
        recipeIds: ln.recipeId ? [ln.recipeId] : [],
        prepTimeMinutes: ln.prepTimeMinutes,
        classificationWeight: ln.classificationWeight,
        _dishSet: new Set([ln.dishName]),
      });
    }
  }

  return [...map.values()].map(({ _dishSet, ...line }) => line);
}

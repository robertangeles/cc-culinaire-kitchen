/**
 * @module services/misePlaceService
 *
 * Catalog-spine Phase 4b: deep mise en place rollup.
 *
 * Given a service date and a forecast number of covers, produce a
 * station-by-station prep sheet showing how much of each ingredient the
 * line needs to prep before service. Used by the printable Mise en Place
 * sheet on the Kitchen Operations side.
 *
 * Sketch:
 *   1. Pull all menu items active at the location (with units_sold > 0
 *      so we have popularity signal).
 *   2. popularityShare = unitsSold / Σ unitsSold across the location's
 *      menu items. forecastUnits = coversForecast × popularityShare.
 *   3. For each ingredient on each menu item, scaledQty = quantity ×
 *      forecastUnits. Aggregate by ingredient across all dishes that
 *      use it.
 *   4. Group by station via heuristic from ingredient_category.
 *
 * The station mapping is intentionally lo-fi (one read of the category
 * field). Real kitchens have their own station layouts; the user can
 * print this and rewrite the headers if they want. The point is to give
 * the chef a starting cut so they don't stare at a blank prep sheet.
 */

import { sql, and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  menuItem,
  menuItemIngredient,
  ingredient,
} from "../db/schema.js";

/**
 * Heuristic mapping ingredient_category → physical station. The station
 * names are familiar Western brigade vocabulary; not every kitchen will
 * use them but they read fine on a printed sheet.
 */
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

const stationFor = (category: string | null | undefined): string =>
  STATION_BY_CATEGORY[category ?? "other"] ?? "Other";

export interface MiseIngredientLine {
  ingredientId: string | null;
  ingredientName: string;
  category: string | null;
  unit: string;
  totalQty: number;
  /** Which dishes contributed (small list for chef context). */
  dishes: string[];
  containsAllergens: string[];
}

export interface MiseStation {
  stationName: string;
  ingredients: MiseIngredientLine[];
}

export interface MiseEnPlaceResult {
  serviceDate: string;
  coversForecast: number;
  stations: MiseStation[];
  totalDishes: number;
  totalIngredientLines: number;
}

interface MiseRow extends Record<string, unknown> {
  ingredient_id: string | null;
  ingredient_name: string;
  ingredient_category: string | null;
  unit: string;
  quantity: string;
  yield_pct: string | null;
  units_sold: number;
  total_units_sold: string;
  menu_name: string;
  contains_dairy_ind: boolean | null;
  contains_gluten_ind: boolean | null;
  contains_nuts_ind: boolean | null;
  contains_shellfish_ind: boolean | null;
  contains_eggs_ind: boolean | null;
}

export async function getMiseEnPlace(
  userId: number,
  storeLocationId: string | null,
  serviceDate: string,
  coversForecast: number,
): Promise<MiseEnPlaceResult> {
  const locFilter = storeLocationId
    ? sql`AND mi.store_location_id = ${storeLocationId}::uuid`
    : sql``;

  // One query that:
  //  - filters menu items by user (and optional location),
  //  - joins ingredient lines + Catalog allergen columns,
  //  - exposes location-wide Σ units_sold so popularity share can be
  //    computed in JS without a second round trip.
  const rows = await db.execute<MiseRow>(sql`
    WITH active_dishes AS (
      SELECT
        mi.menu_item_id,
        mi.name AS menu_name,
        mi.units_sold,
        SUM(mi.units_sold) OVER () AS total_units_sold
      FROM menu_item mi
      WHERE mi.user_id = ${userId}
        AND mi.units_sold > 0
        ${locFilter}
    )
    SELECT
      mii.ingredient_id,
      mii.ingredient_name,
      i.ingredient_category,
      mii.unit,
      mii.quantity,
      mii.yield_pct,
      ad.units_sold,
      ad.total_units_sold,
      ad.menu_name,
      i.contains_dairy_ind,
      i.contains_gluten_ind,
      i.contains_nuts_ind,
      i.contains_shellfish_ind,
      i.contains_eggs_ind
    FROM active_dishes ad
    JOIN menu_item_ingredient mii ON mii.menu_item_id = ad.menu_item_id
    LEFT JOIN ingredient i ON i.ingredient_id = mii.ingredient_id
  `);

  if (rows.length === 0) {
    return {
      serviceDate,
      coversForecast,
      stations: [],
      totalDishes: 0,
      totalIngredientLines: 0,
    };
  }

  // Aggregate by (ingredientId or name, unit) — older free-text rows have
  // no FK so we fall back to (name, unit) for grouping.
  type AggKey = string;
  const agg = new Map<AggKey, MiseIngredientLine & { dishSet: Set<string> }>();
  const dishNames = new Set<string>();

  for (const r of rows) {
    dishNames.add(r.menu_name);

    const totalUnitsSold = parseFloat(String(r.total_units_sold ?? "0"));
    if (!Number.isFinite(totalUnitsSold) || totalUnitsSold === 0) continue;

    const popularityShare = r.units_sold / totalUnitsSold;
    const forecastUnits = coversForecast * popularityShare;
    const qty = parseFloat(r.quantity);
    if (!Number.isFinite(qty)) continue;

    const yieldPct = parseFloat(r.yield_pct ?? "100") || 100;
    const scaledQty = (qty * forecastUnits) / (yieldPct / 100);

    const key: AggKey = `${r.ingredient_id ?? "free:" + r.ingredient_name.toLowerCase()}|${r.unit}`;
    const existing = agg.get(key);

    if (existing) {
      existing.totalQty += scaledQty;
      existing.dishSet.add(r.menu_name);
    } else {
      const allergens: string[] = [];
      if (r.contains_dairy_ind) allergens.push("dairy");
      if (r.contains_gluten_ind) allergens.push("gluten");
      if (r.contains_nuts_ind) allergens.push("nuts");
      if (r.contains_shellfish_ind) allergens.push("shellfish");
      if (r.contains_eggs_ind) allergens.push("eggs");

      agg.set(key, {
        ingredientId: r.ingredient_id,
        ingredientName: r.ingredient_name,
        category: r.ingredient_category,
        unit: r.unit,
        totalQty: scaledQty,
        dishes: [],
        containsAllergens: allergens,
        dishSet: new Set([r.menu_name]),
      });
    }
  }

  // Bucket by station.
  const stationMap = new Map<string, MiseIngredientLine[]>();
  for (const entry of agg.values()) {
    const stationName = stationFor(entry.category);
    const line: MiseIngredientLine = {
      ingredientId: entry.ingredientId,
      ingredientName: entry.ingredientName,
      category: entry.category,
      unit: entry.unit,
      totalQty: Number(entry.totalQty.toFixed(3)),
      dishes: Array.from(entry.dishSet).sort().slice(0, 5),
      containsAllergens: entry.containsAllergens,
    };
    const arr = stationMap.get(stationName) ?? [];
    arr.push(line);
    stationMap.set(stationName, arr);
  }

  // Sort ingredients within each station alphabetically; stations in a
  // stable display order.
  const STATION_ORDER = [
    "Grill / Protein",
    "Garde Manger",
    "Cold",
    "Pantry / Dry",
    "Pastry / Bakery",
    "Freezer",
    "Bar",
    "Other",
  ];

  const stations: MiseStation[] = STATION_ORDER.flatMap((name) => {
    const lines = stationMap.get(name);
    if (!lines || lines.length === 0) return [];
    lines.sort((a, b) => a.ingredientName.localeCompare(b.ingredientName));
    return [{ stationName: name, ingredients: lines }];
  });

  return {
    serviceDate,
    coversForecast,
    stations,
    totalDishes: dishNames.size,
    totalIngredientLines: agg.size,
  };
}

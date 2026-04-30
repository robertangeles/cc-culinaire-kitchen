/**
 * @module services/yieldVarianceService
 *
 * Catalog-spine Phase 4a: per-dish yield variance.
 *
 * Compares the THEORETICAL food cost a recipe predicts against the ACTUAL
 * food cost the kitchen recorded in `consumption_log` (rows tagged with
 * `menu_item_id` via the B1 logging path).
 *
 *   theoretical = units_sold × Σ(menu_item_ingredient.quantity × unit_cost)
 *   actual      = Σ(consumption_log.quantity × ingredient.preferred_unit_cost)
 *                 WHERE menu_item_id = thisDish
 *                 AND logged_at BETWEEN period_start AND period_end
 *   variance    = actual − theoretical
 *   variancePct = variance / theoretical × 100
 *
 * Surface contract — the result includes:
 *   - status: "ok" when both sides are populated, "no-period" when the menu
 *     item lacks period_start/period_end (no sales data uploaded), or
 *     "thin-data" when fewer than MIN_LOG_ROWS exist for the period (garbage
 *     variance numbers erode chef trust — better an honest empty state).
 *   - threshold: "good" / "warning" / "alert" per the Phase 1 design spec
 *     (±3% / 3-8% / >8%). Sign matters: positive variance (overuse) is the
 *     bad direction. Negative (underuse) is fine.
 */

import { sql, and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  menuItem,
  menuItemIngredient,
  ingredient,
  consumptionLog,
} from "../db/schema.js";

/** Below this many consumption_log rows for the period, refuse to compute. */
const MIN_LOG_ROWS = 1;

export type VarianceStatus = "ok" | "no-period" | "thin-data" | "no-recipe";
export type VarianceThreshold = "good" | "warning" | "alert";

export interface YieldVarianceResult {
  menuItemId: string;
  status: VarianceStatus;
  /** Sum across linked menu_item_ingredient rows × units_sold. */
  theoretical: number;
  /** Sum of consumption_log entries × preferred_unit_cost in the period. */
  actual: number;
  variance: number;
  variancePct: number;
  threshold: VarianceThreshold | null;
  unitsSold: number;
  consumptionLogCount: number;
  periodStart: string | null;
  periodEnd: string | null;
}

export async function getYieldVariance(menuItemId: string): Promise<YieldVarianceResult> {
  const [item] = await db
    .select({
      menuItemId: menuItem.menuItemId,
      unitsSold: menuItem.unitsSold,
      periodStart: menuItem.periodStart,
      periodEnd: menuItem.periodEnd,
    })
    .from(menuItem)
    .where(eq(menuItem.menuItemId, menuItemId));

  if (!item) {
    throw new Error("Menu item not found");
  }

  const empty = (status: VarianceStatus): YieldVarianceResult => ({
    menuItemId,
    status,
    theoretical: 0,
    actual: 0,
    variance: 0,
    variancePct: 0,
    threshold: null,
    unitsSold: item.unitsSold ?? 0,
    consumptionLogCount: 0,
    periodStart: item.periodStart ?? null,
    periodEnd: item.periodEnd ?? null,
  });

  if (!item.periodStart || !item.periodEnd) return empty("no-period");

  const periodStartDate = new Date(item.periodStart);
  const periodEndDate = new Date(item.periodEnd);

  // Theoretical: per-unit recipe cost × units_sold.
  const recipeRows = await db
    .select({
      quantity: menuItemIngredient.quantity,
      unitCost: menuItemIngredient.unitCost,
      yieldPct: menuItemIngredient.yieldPct,
    })
    .from(menuItemIngredient)
    .where(eq(menuItemIngredient.menuItemId, menuItemId));

  if (recipeRows.length === 0) return empty("no-recipe");

  const perUnitRecipeCost = recipeRows.reduce((sum, r) => {
    const q = parseFloat(r.quantity);
    const c = parseFloat(r.unitCost);
    const y = parseFloat(r.yieldPct ?? "100") || 100;
    if (!Number.isFinite(q) || !Number.isFinite(c) || y === 0) return sum;
    return sum + (q * c) / (y / 100);
  }, 0);

  const unitsSold = item.unitsSold ?? 0;
  const theoretical = perUnitRecipeCost * unitsSold;

  // Actual: sum consumption_log.quantity × ingredient.preferred_unit_cost
  // WHERE menu_item_id = thisDish AND logged_at BETWEEN period.
  const actualRows = await db.execute<{
    actual_cost: string | null;
    log_count: number | string;
  }>(sql`
    SELECT
      COALESCE(SUM(c.quantity::numeric * COALESCE(i.preferred_unit_cost, 0)::numeric), 0) AS actual_cost,
      COUNT(*) AS log_count
    FROM consumption_log c
    JOIN ingredient i ON i.ingredient_id = c.ingredient_id
    WHERE c.menu_item_id = ${menuItemId}::uuid
      AND c.logged_at >= ${periodStartDate.toISOString()}
      AND c.logged_at <= ${periodEndDate.toISOString()}
  `);

  const actualRow = actualRows[0] ?? { actual_cost: "0", log_count: 0 };
  const actual = parseFloat(String(actualRow.actual_cost ?? "0"));
  const consumptionLogCount = Number(actualRow.log_count ?? 0);

  if (consumptionLogCount < MIN_LOG_ROWS) {
    return { ...empty("thin-data"), theoretical };
  }

  const variance = actual - theoretical;
  const variancePct = theoretical > 0 ? (variance / theoretical) * 100 : 0;
  const absPct = Math.abs(variancePct);
  const threshold: VarianceThreshold = absPct <= 3 ? "good" : absPct <= 8 ? "warning" : "alert";

  return {
    menuItemId,
    status: "ok",
    theoretical: Number(theoretical.toFixed(2)),
    actual: Number(actual.toFixed(2)),
    variance: Number(variance.toFixed(2)),
    variancePct: Number(variancePct.toFixed(2)),
    threshold,
    unitsSold,
    consumptionLogCount,
    periodStart: item.periodStart ?? null,
    periodEnd: item.periodEnd ?? null,
  };
}

/**
 * Bulk version — computes variance for every menu item belonging to the
 * caller (used by the Menu Intelligence list view to render the variance
 * column without N+1 round-trips). Reuses the single-item computation by
 * iterating; for now the result set is small (tens of dishes), so a single
 * SQL aggregate would be premature optimization.
 */
export async function listYieldVariance(userId: number): Promise<YieldVarianceResult[]> {
  const items = await db
    .select({ menuItemId: menuItem.menuItemId })
    .from(menuItem)
    .where(eq(menuItem.userId, userId));

  const results: YieldVarianceResult[] = [];
  for (const it of items) {
    try {
      results.push(await getYieldVariance(it.menuItemId));
    } catch {
      // Skip any single failure — per-row errors shouldn't tank the list.
    }
  }
  return results;
}

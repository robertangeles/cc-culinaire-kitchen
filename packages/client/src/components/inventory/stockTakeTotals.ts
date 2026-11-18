/**
 * @module components/inventory/stockTakeTotals
 *
 * Ingredient-level variance for the stock take review (mobile eng decisions D4 and D7).
 * An item counted in several storage areas has one line per area, each blank of variance
 * (one area's share is not comparable with the whole book). The review shows the item's
 * TOTAL across areas against the book, from the shared `ingredientVariance`.
 */

import { ingredientVariance, type IngredientVariance } from "@culinaire/shared";
import type { StockTakeLine } from "../../hooks/useInventory.js";

export type IngredientTotal = IngredientVariance & { areas: number };

/** Totals for every ingredient that has lines in more than one category/area of the session. */
export function buildIngredientTotals(lines: StockTakeLine[]): Map<string, IngredientTotal> {
  const byIngredient = new Map<string, StockTakeLine[]>();
  for (const line of lines) {
    byIngredient.set(line.ingredientId, [...(byIngredient.get(line.ingredientId) ?? []), line]);
  }
  const totals = new Map<string, IngredientTotal>();
  for (const [ingredientId, group] of byIngredient) {
    if (group.length < 2) continue;
    const book = group.find((l) => l.expectedQty !== null)?.expectedQty ?? null;
    totals.set(ingredientId, {
      ...ingredientVariance({
        countedQtys: group.map((l) => Number(l.countedQty)),
        expectedQty: book === null ? null : Number(book),
      }),
      areas: group.length,
    });
  }
  return totals;
}

/** The variance to show for a line: the item's total when it spans areas, else the line's own. */
export function effectiveVariance(line: StockTakeLine, total?: IngredientTotal) {
  if (total) return { qty: total.varianceQty, pct: total.variancePct };
  return {
    qty: line.varianceQty ? Number(line.varianceQty) : null,
    pct: line.variancePct ? Number(line.variancePct) : null,
  };
}

import { describe, it, expect } from "vitest";
import { buildIngredientTotals, effectiveVariance } from "./stockTakeTotals.js";
import type { StockTakeLine } from "../../hooks/useInventory.js";

const line = (over: Partial<StockTakeLine>): StockTakeLine => ({
  lineId: "l", categoryId: "c", ingredientId: "i1", countedQty: "0", countedUnit: "kg", rawQty: "0",
  expectedQty: null, varianceQty: null, variancePct: null, countedByUserId: 1, countedDttm: "2026-11-18T00:00:00Z",
  ...over,
});

describe("buildIngredientTotals", () => {
  it("totals an item counted in two areas against the book", () => {
    const totals = buildIngredientTotals([
      line({ lineId: "a", categoryId: "bar", countedQty: "3", expectedQty: "8" }),
      line({ lineId: "b", categoryId: "room", countedQty: "4", expectedQty: "8" }),
    ]);
    expect(totals.get("i1")).toMatchObject({ complete: true, totalCounted: 7, varianceQty: -1, areas: 2 });
  });

  it("skips an item with a single line", () => {
    expect(buildIngredientTotals([line({ countedQty: "3", expectedQty: "8" })]).size).toBe(0);
  });

  it("gives no variance when no line carries a book", () => {
    const totals = buildIngredientTotals([
      line({ lineId: "a", countedQty: "3" }),
      line({ lineId: "b", countedQty: "4" }),
    ]);
    expect(totals.get("i1")?.varianceQty).toBeNull();
  });
});

describe("effectiveVariance", () => {
  it("uses the item's total when there is one, ignoring the blank per-line variance", () => {
    const l = line({ varianceQty: null });
    const total = { complete: true, totalCounted: 7, varianceQty: -1, variancePct: -12.5, areas: 2 };
    expect(effectiveVariance(l, total)).toEqual({ qty: -1, pct: -12.5 });
  });

  it("uses the line's own variance for a single-area or category line", () => {
    expect(effectiveVariance(line({ varianceQty: "2", variancePct: "25" }))).toEqual({ qty: 2, pct: 25 });
    expect(effectiveVariance(line({}))).toEqual({ qty: null, pct: null });
  });
});

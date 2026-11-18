import { describe, it, expect } from "vitest";
import { ingredientVariance } from "./ingredientVariance.js";

describe("ingredientVariance", () => {
  it("sums an item counted in two areas and compares the total to the book", () => {
    // Wine: 3 in the bar, 4 in the stock room, book says 8 -> total 7, short by 1.
    const v = ingredientVariance({ countedQtys: [3, 4], expectedQty: 8, areasExpected: 2 });
    expect(v).toEqual({ complete: true, totalCounted: 7, varianceQty: -1, variancePct: -12.5 });
  });

  it("does not cry wolf on one area of two: no variance until every area is counted", () => {
    const v = ingredientVariance({ countedQtys: [3], expectedQty: 8, areasExpected: 2 });
    expect(v).toEqual({ complete: false, totalCounted: 3, varianceQty: null, variancePct: null });
  });

  it("a zero count in an area is a count", () => {
    const v = ingredientVariance({ countedQtys: [0, 8], expectedQty: 8, areasExpected: 2 });
    expect(v.complete).toBe(true);
    expect(v.varianceQty).toBe(0);
  });

  it("treats a single count as complete when areasExpected is not given", () => {
    expect(ingredientVariance({ countedQtys: [5], expectedQty: 4 })).toEqual({
      complete: true, totalCounted: 5, varianceQty: 1, variancePct: 25,
    });
  });

  it("returns no variance when there is no book to compare to", () => {
    const v = ingredientVariance({ countedQtys: [5], expectedQty: null });
    expect(v).toEqual({ complete: true, totalCounted: 5, varianceQty: null, variancePct: null });
  });

  it("gives a quantity but no percent when the book is 0", () => {
    const v = ingredientVariance({ countedQtys: [2], expectedQty: 0 });
    expect(v.varianceQty).toBe(2);
    expect(v.variancePct).toBeNull();
  });

  it("returns incomplete for no counts at all", () => {
    expect(ingredientVariance({ countedQtys: [], expectedQty: 3 })).toEqual({
      complete: false, totalCounted: 0, varianceQty: null, variancePct: null,
    });
  });
});

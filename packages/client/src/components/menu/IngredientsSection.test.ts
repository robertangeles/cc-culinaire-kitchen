import { describe, it, expect } from "vitest";
import { calcLineCost } from "./IngredientsSection.js";
import type { IngredientRow } from "./IngredientsSection.js";

const baseRow: IngredientRow = {
  tempId: 1,
  ingredientId: "ing-1",
  ingredientName: "Flour",
  quantity: "1",
  unit: "kg",
  baseUnit: "kg",
  unitCost: "2.00",
  yieldPct: "100",
};

describe("calcLineCost", () => {
  it("returns quantity × unitCost when unit matches baseUnit", () => {
    expect(calcLineCost(baseRow, [])).toBe(2.0);
  });

  it("applies yield percentage correctly", () => {
    const row = { ...baseRow, quantity: "1", unitCost: "10.00", yieldPct: "80" };
    // 1kg × $10 / 0.80 = $12.50
    expect(calcLineCost(row, [])).toBe(12.5);
  });

  it('falls back to 100% yield when yieldPct is "0" (|| 100 makes "0" falsy)', () => {
    // parseFloat("0") || 100 → 100, so $1kg × $2 / 100% = $2
    // The if(yld===0) guard is unreachable dead code in the current implementation.
    const row = { ...baseRow, yieldPct: "0" };
    expect(calcLineCost(row, [])).toBe(2.0);
  });

  it("returns 0 for unlinked ingredient with no resolution path", () => {
    // No ingredientId + incompatible unit → toKitchenQty returns qty directly when no baseUnit
    const row: IngredientRow = {
      tempId: 2,
      ingredientName: "Custom",
      quantity: "2",
      unit: "kg",
      unitCost: "5.00",
      yieldPct: "100",
    };
    expect(calcLineCost(row, [])).toBe(10.0);
  });

  it("returns 0 when unit cannot be resolved to baseUnit (mismatch, no conversions)", () => {
    const row = { ...baseRow, unit: "L", baseUnit: "kg" }; // mass-to-volume with no density → null
    expect(calcLineCost(row, [])).toBe(0);
  });

  it("rounds to 2 decimal places", () => {
    // 1/3 kg × $1 / 100% → raw 0.3333… → rounded 0.33
    const row = { ...baseRow, quantity: "0.333333", unitCost: "1.00", yieldPct: "100" };
    const result = calcLineCost(row, []);
    // Should be rounded to cents
    expect(result).toBe(Math.round(result * 100) / 100);
  });

  it("handles yield > 100% (over-yield)", () => {
    // 1kg × $10 / 1.20 = $8.33
    const row = { ...baseRow, quantity: "1", unitCost: "10.00", yieldPct: "120" };
    expect(calcLineCost(row, [])).toBeCloseTo(8.33, 2);
  });

  it("returns 0 when quantity is 0", () => {
    const row = { ...baseRow, quantity: "0" };
    expect(calcLineCost(row, [])).toBe(0);
  });
});

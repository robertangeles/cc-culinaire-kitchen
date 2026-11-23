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

// Characterisation before calcLineCost's maths moved to packages/shared: the same dish the server test
// (menuCosting.integration.test.ts) stores, costed here the way the web editor shows it.
describe("calcLineCost — the Margherita lines, as the editor previews them", () => {
  const row = (over: Partial<IngredientRow>): IngredientRow => ({ ...baseRow, ingredientId: null, baseUnit: undefined, ...over });

  it("matches the cents the server stores for yield, grams to kg and mL to L", () => {
    expect(calcLineCost(row({ ingredientName: "Dough", quantity: "1.2", unit: "kg", unitCost: "3.35", yieldPct: "87.5" }), [])).toBe(4.59);
    expect(calcLineCost(row({ ingredientName: "Cheese", quantity: "0.35", unit: "kg", unitCost: "14.20" }), [])).toBe(4.97);
    expect(calcLineCost(row({ ingredientId: "i", quantity: "500", unit: "g", baseUnit: "kg", unitCost: "2.10", yieldPct: "92" }), [])).toBe(1.14);
    expect(calcLineCost(row({ ingredientId: "i", quantity: "150", unit: "mL", baseUnit: "L", unitCost: "41.2500" }), [])).toBe(6.19);
  });

  it("rounds a half-cent line up (Math.round), where the server's toFixed gives the cent below", () => {
    // 0.125 kg x 14.20 = 1.7749999999999999 in floating point: web 1.78, server stores 1.77.
    expect(calcLineCost(row({ quantity: "0.125", unit: "kg", unitCost: "14.20" }), [])).toBe(1.78);
    expect(calcLineCost(row({ quantity: "0.5", unit: "kg", unitCost: "8.35" }), [])).toBe(4.18);
  });

  it("treats a blank, zero or unreadable yield as 100% (the server stores 0.00 for a zero yield)", () => {
    for (const yieldPct of ["", "0", "abc"]) {
      expect(calcLineCost(row({ quantity: "0.2", unit: "kg", unitCost: "5", yieldPct }), [])).toBe(1);
    }
  });

  it("reads a blank or unreadable quantity or cost as 0", () => {
    expect(calcLineCost(row({ quantity: "", unitCost: "5" }), [])).toBe(0);
    expect(calcLineCost(row({ quantity: "2", unitCost: "n/a" }), [])).toBe(0);
  });

  it("lets a negative yield through (a negative cost)", () => {
    expect(calcLineCost(row({ quantity: "1", unit: "kg", unitCost: "10", yieldPct: "-50" }), [])).toBe(-20);
  });
});

import { describe, it, expect } from "vitest";
import {
  resolveQtyToKitchen,
  resolvableUnits,
  type ResolvableIngredient,
  type CustomConversion,
} from "./unitResolution.js";
import { IncompatibleUnitsError } from "./units.js";

const none: CustomConversion[] = [];

// The live fixtures this feature was designed around.
const flour: ResolvableIngredient = {
  baseUnit: "kg",
  purchaseUnit: "bag",
  packQty: "12.500", // Drizzle numeric string — accepted as-is
  contentQty: null,
  contentUnit: null,
};
const wine: ResolvableIngredient = {
  baseUnit: "bottle",
  purchaseUnit: "case",
  packQty: 12,
  contentQty: "750.000",
  contentUnit: "mL",
};

describe("resolveQtyToKitchen — the 6 steps", () => {
  it("step 1: same unit passes through (case-insensitive)", () => {
    expect(resolveQtyToKitchen(flour, 5, "kg", none)).toBe(5);
    expect(resolveQtyToKitchen(flour, 5, "KG", none)).toBe(5);
    expect(resolveQtyToKitchen(flour, 0, "kg", none)).toBe(0);
  });

  it("step 2: pack label multiplies by pack qty", () => {
    expect(resolveQtyToKitchen(flour, 4, "bag", none)).toBeCloseTo(50);
    expect(resolveQtyToKitchen(wine, 2, "case", none)).toBe(24);
  });

  it("step 2 edge: pack label with null packQty is skipped, not crashed", () => {
    const noSize: ResolvableIngredient = { ...flour, packQty: null };
    // "bag" no longer resolves via step 2 and has no other path → step 6 throw.
    expect(() => resolveQtyToKitchen(noSize, 4, "bag", none)).toThrow(IncompatibleUnitsError);
  });

  it("step 3: operator-defined conversion row wins, string factors accepted", () => {
    const cup: CustomConversion[] = [{ fromUnit: "cup", toBaseFactor: "0.120" }]; // 1 cup flour = 0.12 kg
    expect(resolveQtyToKitchen(flour, 2, "cup", cup)).toBeCloseTo(0.24);
  });

  it("step 3 beats derived paths (operator intent over standard conversion)", () => {
    // Operator declares a deliberate override for kg — it must beat step 5's ×1000.
    const override: CustomConversion[] = [{ fromUnit: "g", toBaseFactor: "2" }];
    const grams: ResolvableIngredient = { baseUnit: "kg", purchaseUnit: null, packQty: null, contentQty: null, contentUnit: null };
    expect(resolveQtyToKitchen(grams, 3, "g", override)).toBe(6);
  });

  it("step 4: content equivalence divides down (150 mL of a 750 mL bottle = 0.2)", () => {
    expect(resolveQtyToKitchen(wine, 150, "mL", none)).toBeCloseTo(0.2);
    // Same family as the content unit converts first: 1 L = 1000 mL → 1.333 bottles.
    expect(resolveQtyToKitchen(wine, 1, "L", none)).toBeCloseTo(1000 / 750);
  });

  it("step 5: same-family standard conversion to the kitchen unit", () => {
    const grams: ResolvableIngredient = { baseUnit: "g", purchaseUnit: null, packQty: null, contentQty: null, contentUnit: null };
    expect(resolveQtyToKitchen(grams, 2, "kg", none)).toBe(2000);
  });

  it("step 5: cross-family throws convertUnit's IncompatibleUnitsError", () => {
    const grams: ResolvableIngredient = { baseUnit: "g", purchaseUnit: null, packQty: null, contentQty: null, contentUnit: null };
    expect(() => resolveQtyToKitchen(grams, 1, "ml", none)).toThrow(IncompatibleUnitsError);
  });

  it("step 6: no path throws with the valid-units list", () => {
    expect(() => resolveQtyToKitchen(wine, 1, "slab", none)).toThrow(/Valid: /);
  });

  it("step 6: caller-supplied noPathMessage is honored (server wording)", () => {
    expect(() =>
      resolveQtyToKitchen(wine, 1, "slab", none, { noPathMessage: "server says no" }),
    ).toThrow("server says no");
  });
});

describe("resolvableUnits — bounded dropdown enumeration", () => {
  it("flour: kitchen unit first, pack label, then mass family", () => {
    expect(resolvableUnits(flour, none)).toEqual(["kg", "bag", "mg", "g"]);
  });

  it("wine: measured unit (content) is the default, then bottle/case/volume family", () => {
    const units = resolvableUnits(wine, none);
    expect(units[0]).toBe("mL"); // D2: recipes default to the measured unit
    expect(units).toContain("bottle");
    expect(units).toContain("case");
    expect(units).toContain("l");
    expect(units).toContain("cup");
  });

  it("pack label without packQty is not offered", () => {
    expect(resolvableUnits({ ...flour, packQty: null }, none)).toEqual(["kg", "mg", "g"]);
  });

  it("no-family kitchen unit falls back to itself", () => {
    const keg: ResolvableIngredient = { baseUnit: "keg", purchaseUnit: null, packQty: null, contentQty: null, contentUnit: null };
    expect(resolvableUnits(keg, none)).toEqual(["keg"]);
  });

  it("custom conversion units are offered", () => {
    const cup: CustomConversion[] = [{ fromUnit: "cup", toBaseFactor: "0.120" }];
    expect(resolvableUnits(flour, cup)).toContain("cup");
  });

  it("property: every offered unit resolves without error", () => {
    const shapes: Array<[ResolvableIngredient, CustomConversion[]]> = [
      [flour, none],
      [flour, [{ fromUnit: "cup", toBaseFactor: "0.120" }]],
      [wine, none],
      [wine, [{ fromUnit: "carafe", toBaseFactor: "0.66" }]],
      [{ baseUnit: "each", purchaseUnit: "carton", packQty: "24", contentQty: null, contentUnit: null }, none],
      [{ baseUnit: "keg", purchaseUnit: null, packQty: null, contentQty: null, contentUnit: null }, none],
      [{ ...flour, packQty: null }, none],
      [milk, none],
      [{ ...wine, densityGPerMl: "0.99" }, none],
      [{ baseUnit: "kg", densityGPerMl: 1.42 }, none], // weighed honey, measurable by volume
    ];
    for (const [ing, conversions] of shapes) {
      for (const unit of resolvableUnits(ing, conversions)) {
        expect(() => resolveQtyToKitchen(ing, 1, unit, conversions)).not.toThrow();
      }
    }
  });
});

// Volume-counted liquid with the industry-standard density bridge.
const milk: ResolvableIngredient = {
  baseUnit: "l",
  purchaseUnit: null,
  packQty: null,
  contentQty: null,
  contentUnit: null,
  densityGPerMl: "1.0300",
};

describe("density bridge — volume↔mass (pâtisserie weighs liquids)", () => {
  it("mass entry against a volume kitchen unit: 95 g milk → 0.0922 L @ 1.03", () => {
    expect(resolveQtyToKitchen(milk, 95, "g", none)).toBeCloseTo(95 / 1.03 / 1000, 6);
  });

  it("volume entry against a mass kitchen unit: 1 cup of honey @ 1.42 → 0.336 kg", () => {
    const honey: ResolvableIngredient = { baseUnit: "kg", densityGPerMl: 1.42 };
    expect(resolveQtyToKitchen(honey, 1, "cup", none)).toBeCloseTo((236.588 * 1.42) / 1000, 4);
  });

  it("density + content equivalence: 780 g of a 750 mL bottle @ 0.99 ≈ 1.05 bottles", () => {
    const wineDense: ResolvableIngredient = { ...wine, densityGPerMl: "0.99" };
    expect(resolveQtyToKitchen(wineDense, 780, "g", none)).toBeCloseTo(780 / 0.99 / 750, 4);
  });

  it("no density → cross-family still throws (historical behavior unchanged)", () => {
    const plainMilk: ResolvableIngredient = { ...milk, densityGPerMl: null };
    expect(() => resolveQtyToKitchen(plainMilk, 95, "g", none)).toThrow(IncompatibleUnitsError);
  });

  it("operator conversion row still beats the density bridge (step 3 wins)", () => {
    const override: CustomConversion[] = [{ fromUnit: "g", toBaseFactor: "0.002" }];
    expect(resolveQtyToKitchen(milk, 10, "g", override)).toBeCloseTo(0.02);
  });

  it("counts never density-bridge", () => {
    const eggs: ResolvableIngredient = { baseUnit: "each", densityGPerMl: 1.03 };
    expect(() => resolveQtyToKitchen(eggs, 50, "g", none)).toThrow(IncompatibleUnitsError);
  });

  it("resolvableUnits offers the counterpart family when density is set", () => {
    expect(resolvableUnits(milk, none)).toContain("g");        // weigh the milk
    expect(resolvableUnits(milk, none)).toContain("kg");
    const honey: ResolvableIngredient = { baseUnit: "kg", densityGPerMl: 1.42 };
    expect(resolvableUnits(honey, none)).toContain("ml");      // measure honey by volume
    const plainMilk: ResolvableIngredient = { ...milk, densityGPerMl: null };
    expect(resolvableUnits(plainMilk, none)).not.toContain("g"); // no density → no bridge
  });
});

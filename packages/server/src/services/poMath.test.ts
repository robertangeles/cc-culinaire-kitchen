import { describe, it, expect } from "vitest";
import {
  sumPOLineTotal,
  suggestedOrderQty,
  toPurchasePackages,
  reorderQty,
  estimatedLineCost,
  shouldRouteToHQ,
  isUnpriced,
} from "./poMath.js";

describe("Formula F-PO-01: sumPOLineTotal", () => {
  describe("Forward reconciliation", () => {
    it("sums qty × cost across multiple lines with realistic decimal prices", () => {
      const lines = [
        { orderedQty: 12, unitCost: 4.75 },    // 57.00
        { orderedQty: 3.5, unitCost: 18.99 },   // 66.465
        { orderedQty: 24, unitCost: 2.30 },      // 55.20
      ];
      // 57 + 66.465 + 55.2 = 178.665 → rounded to 178.67
      expect(sumPOLineTotal(lines)).toBe(178.67);
    });

    it("handles a single line with string-parsed-to-number decimal cost", () => {
      const lines = [{ orderedQty: 7, unitCost: Number("12.345") }];
      // 7 × 12.345 = 86.415 → 86.42
      expect(sumPOLineTotal(lines)).toBe(86.42);
    });
  });

  describe("Backward reconciliation", () => {
    it("total / qty = unitCost for a single-line PO (within rounding)", () => {
      const qty = 15;
      const cost = 8.33;
      const total = sumPOLineTotal([{ orderedQty: qty, unitCost: cost }]);
      // total = 124.95, total / qty = 8.33
      expect(total / qty).toBeCloseTo(cost, 2);
    });
  });

  describe("Boundary conditions", () => {
    it("returns 0 for empty lines array", () => {
      expect(sumPOLineTotal([])).toBe(0);
    });

    it("handles zero-qty lines without affecting total", () => {
      const lines = [
        { orderedQty: 0, unitCost: 99.99 },
        { orderedQty: 5, unitCost: 10 },
      ];
      expect(sumPOLineTotal(lines)).toBe(50);
    });

    it("treats NaN/Infinity as 0", () => {
      const lines = [
        { orderedQty: NaN, unitCost: 10 },
        { orderedQty: 5, unitCost: Infinity },
        { orderedQty: 3, unitCost: 4 },
      ];
      expect(sumPOLineTotal(lines)).toBe(12);
    });
  });

  describe("Precision verification", () => {
    it("rounds correctly at the 0.005 boundary", () => {
      // 3 × 1.665 = 4.995 → rounds to 5.00
      expect(sumPOLineTotal([{ orderedQty: 3, unitCost: 1.665 }])).toBe(5);
    });

    it("handles cumulative floating-point drift across many small lines", () => {
      // 10 lines of 0.1 × 0.1 = 0.01 each → total 0.10
      const lines = Array.from({ length: 10 }, () => ({
        orderedQty: 0.1,
        unitCost: 0.1,
      }));
      expect(sumPOLineTotal(lines)).toBe(0.1);
    });
  });

  describe("Invariants", () => {
    it("total is always >= 0 when all inputs are non-negative", () => {
      const lines = [
        { orderedQty: 0, unitCost: 0 },
        { orderedQty: 1, unitCost: 0.01 },
      ];
      expect(sumPOLineTotal(lines)).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("Formula F-PO-02: suggestedOrderQty (pure order-to-par)", () => {
  // reorder_qty was retired 2026-07-24: the suggestion is now just par - on-hand.
  describe("Forward reconciliation", () => {
    it("returns the par shortfall", () => {
      // par=50, current=12.5 → 37.5
      expect(suggestedOrderQty(50, 12.5)).toBe(37.5);
    });

    it("does not overshoot par (the retired reorder_qty floor is gone)", () => {
      // par=50, current=45 → 5, never bumped up to some reorder minimum
      expect(suggestedOrderQty(50, 45)).toBe(5);
    });
  });

  describe("Boundary conditions", () => {
    it("returns 0 when current >= par (no shortfall)", () => {
      expect(suggestedOrderQty(50, 50)).toBe(0);
      expect(suggestedOrderQty(50, 55)).toBe(0);
    });
  });

  describe("Invariants", () => {
    it("result equals the shortfall whenever shortfall > 0", () => {
      const par = 80;
      const current = 25.7;
      const result = suggestedOrderQty(par, current);
      expect(result).toBeCloseTo(par - current, 10);
    });

    it("never negative", () => {
      expect(suggestedOrderQty(10, 999)).toBe(0);
    });
  });
});

describe("Formula F-PO-04: toPurchasePackages", () => {
  describe("Forward reconciliation", () => {
    it("converts the live bug: 25 kg of flour in 12.5 kg bags is 2 bags, not 50", () => {
      expect(toPurchasePackages(25, 12.5, "bag")).toBe(2);
    });

    it("24 bottles short, case of 12 -> 2 cases", () => {
      expect(toPurchasePackages(24, 12, "case")).toBe(2);
    });
  });

  describe("Boundary conditions", () => {
    it("rounds UP — you cannot buy part of a bag", () => {
      expect(toPurchasePackages(13, 12.5, "bag")).toBe(2);
      expect(toPurchasePackages(0.1, 12.5, "bag")).toBe(1);
    });

    it("exact multiples do not round up a spare package", () => {
      expect(toPurchasePackages(25, 12.5, "bag")).toBe(2);
      expect(toPurchasePackages(12.5, 12.5, "bag")).toBe(1);
    });

    it("nothing needed -> nothing ordered", () => {
      expect(toPurchasePackages(0, 12.5, "bag")).toBe(0);
    });

    it("returns null when the item has no packaging (order in the kitchen unit)", () => {
      expect(toPurchasePackages(25, null, null)).toBeNull();
      expect(toPurchasePackages(25, 12.5, null)).toBeNull();
      expect(toPurchasePackages(25, null, "bag")).toBeNull();
    });

    it("guards a zero/negative pack size instead of dividing by it", () => {
      expect(toPurchasePackages(25, 0, "bag")).toBeNull();
      expect(toPurchasePackages(25, -5, "bag")).toBeNull();
    });
  });

  describe("Invariants", () => {
    it("packages x packSize always covers the shortfall", () => {
      for (const [qty, pack] of [
        [25, 12.5],
        [24, 12],
        [13, 12.5],
        [1, 500],
        [999, 7],
      ] as const) {
        const packs = toPurchasePackages(qty, pack, "case")!;
        expect(packs * pack).toBeGreaterThanOrEqual(qty);
      }
    });

    it("never over-orders by a full package or more", () => {
      for (const [qty, pack] of [
        [25, 12.5],
        [13, 12.5],
        [999, 7],
      ] as const) {
        const packs = toPurchasePackages(qty, pack, "case")!;
        expect(packs * pack - qty).toBeLessThan(pack);
      }
    });
  });
});

describe("Formula F-PO-05: reorderQty", () => {
  const flour = { baseUnit: "kg", purchaseUnit: "bag", packQty: "12.5" };
  const wine = { baseUnit: "bottle", purchaseUnit: "case", packQty: "12" };
  const eggs = { baseUnit: "each", purchaseUnit: null, packQty: null };

  describe("Forward reconciliation", () => {
    it("the live bug: 62.5 kg below par of a 12.5 kg bag is 5 bags, not 62.5", () => {
      expect(reorderQty(62.5, "bag", flour, [], null)).toEqual({ qty: 5, isConverted: true });
    });

    it("5 bottles below par, ordered by the case of 12, is 1 case", () => {
      expect(reorderQty(5, "case", wine, [], null).qty).toBe(1);
    });

    it("reads an operator's own conversion (a carton of 30 eggs) and a standard one (dozen)", () => {
      expect(reorderQty(61, "carton", eggs, [{ fromUnit: "carton", toBaseFactor: "30" }], null).qty).toBe(3);
      expect(reorderQty(25, "dozen", eggs, [], null).qty).toBe(3);
    });

    it("matches the unit whatever its case", () => {
      expect(reorderQty(62.5, "Bag", flour, [], null).qty).toBe(5);
    });
  });

  describe("A line already in the kitchen unit stays exact", () => {
    it.each([
      ["kg", flour, 1.875],
      ["kg", flour, 62.5],
      ["each", eggs, 7],
    ])("%s", (unit, ing, shortfall) => {
      expect(reorderQty(shortfall, unit, ing, [], null).qty).toBe(shortfall);
    });

    it("drops subtraction noise: par 12 less 9.7 is 2.3", () => {
      expect(reorderQty(12 - 9.7, "kg", flour, [], null).qty).toBe(2.3);
    });
  });

  describe("Boundary conditions", () => {
    it("does not buy a spare pack for floating-point noise (4.9 / 0.7 = 7.000000000000001)", () => {
      expect(reorderQty(4.9, "tub", { baseUnit: "kg", purchaseUnit: "tub", packQty: "0.7" }, [], null).qty).toBe(7);
    });

    it("rounds up to whole order units", () => {
      expect(reorderQty(12.6, "bag", flour, [], null).qty).toBe(2);
    });
  });

  describe("Supplier minimum (in the unit the item is bought in)", () => {
    it("lifts the line to the minimum, and leaves it alone above", () => {
      expect(reorderQty(5, "bag", flour, [], 3).qty).toBe(3);
      expect(reorderQty(62.5, "bag", flour, [], 3).qty).toBe(5);
    });

    it("converts the minimum when the line is in the kitchen unit: 2 bags is 25 kg", () => {
      expect(reorderQty(5, "kg", flour, [], 2).qty).toBe(25);
    });

    it("is in the kitchen unit for an item without packaging", () => {
      expect(reorderQty(5, "each", eggs, [], 12).qty).toBe(12);
    });
  });

  describe("No conversion: never a guess", () => {
    it.each([
      ["a missing pack size", { baseUnit: "kg", purchaseUnit: "bag", packQty: null }],
      ["a zero pack size", { baseUnit: "kg", purchaseUnit: "bag", packQty: "0" }],
      ["a unit the item no longer has", { baseUnit: "kg", purchaseUnit: "sack", packQty: "25" }],
    ])("%s", (_name, ing) => {
      expect(reorderQty(62.5, "bag", ing, [], 3)).toEqual({ qty: null, isConverted: false });
    });

    it("keeps an exact kitchen-unit line, but says the minimum could not be checked", () => {
      expect(reorderQty(5, "kg", { baseUnit: "kg", purchaseUnit: "bag", packQty: null }, [], 2)).toEqual({ qty: 5, isConverted: false });
    });
  });
});

describe("Formula F-PO-03: estimatedLineCost", () => {
  describe("Forward reconciliation", () => {
    it("multiplies qty by unit cost with 2-decimal output", () => {
      expect(estimatedLineCost(7.5, 3.33)).toBe(24.98);
    });
  });

  describe("Backward reconciliation", () => {
    it("cost / qty ≈ unitCost (within toFixed(2) precision)", () => {
      const qty = 12.75;
      const unitCost = 4.89;
      const cost = estimatedLineCost(qty, unitCost);
      expect(cost / qty).toBeCloseTo(unitCost, 1);
    });
  });

  describe("Precision verification", () => {
    it("rounds 0.005 boundary deterministically via toFixed(2)", () => {
      // 2.005 in IEEE 754 is 2.00499999… so toFixed(2) → "2.00" → 2
      const result = estimatedLineCost(1, 2.005);
      expect(result).toBe(2);
    });

    it("rounds a clearly-above-midpoint value up via toFixed(2)", () => {
      // 3 × 1.337 = 4.011 → toFixed(2) → "4.01" → 4.01
      const result = estimatedLineCost(3, 1.337);
      expect(result).toBe(4.01);
    });
  });
});

describe("Formula F-PO-04: shouldRouteToHQ", () => {
  describe("Forward reconciliation", () => {
    it("returns true when total equals threshold exactly", () => {
      expect(shouldRouteToHQ(500, 500)).toBe(true);
    });

    it("returns true when total exceeds threshold", () => {
      expect(shouldRouteToHQ(500.01, 500)).toBe(true);
    });

    it("returns false when total is below threshold", () => {
      expect(shouldRouteToHQ(499.99, 500)).toBe(false);
    });
  });

  describe("Boundary conditions", () => {
    it("returns false when threshold is null (no threshold = always DIRECT)", () => {
      expect(shouldRouteToHQ(999999, null)).toBe(false);
    });

    it("returns true when threshold is 0 and total is 0", () => {
      expect(shouldRouteToHQ(0, 0)).toBe(true);
    });
  });

  describe("Unpriced lines (a total that cannot be trusted)", () => {
    it("routes to HQ when any line has no usable price, even if the known total is under the threshold", () => {
      expect(shouldRouteToHQ(10, 500, true)).toBe(true);
    });

    it("an all-unpriced PO (total 0) can no longer slip under a threshold", () => {
      expect(shouldRouteToHQ(0, 500, true)).toBe(true);
    });

    it("still goes direct when no threshold is configured, priced or not", () => {
      expect(shouldRouteToHQ(0, null, true)).toBe(false);
    });
  });
});

describe("isUnpriced", () => {
  it.each([null, undefined, "", "0", "0.00", "-1", "abc", 0])("treats %j as unpriced", (v) => {
    expect(isUnpriced(v as string | null | undefined)).toBe(true);
  });

  it.each(["0.01", "4.75", 3])("treats %j as priced", (v) => {
    expect(isUnpriced(v as string)).toBe(false);
  });
});

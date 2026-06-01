import { describe, it, expect } from "vitest";
import { varianceQty, variancePct } from "./stockMath.js";

describe("Formula F-ST-01: varianceQty", () => {
  describe("Forward reconciliation", () => {
    it("positive variance = surplus (counted more than expected)", () => {
      expect(varianceQty(105.5, 100)).toBe(5.5);
    });

    it("negative variance = shrinkage (counted less than expected)", () => {
      expect(varianceQty(92.3, 100)).toBeCloseTo(-7.7, 10);
    });

    it("zero variance when counted equals expected", () => {
      expect(varianceQty(42.75, 42.75)).toBe(0);
    });
  });

  describe("Backward reconciliation", () => {
    it("counted = expected + variance (algebraic identity)", () => {
      const counted = 87.33;
      const expected = 95.0;
      const variance = varianceQty(counted, expected);
      expect(expected + variance).toBeCloseTo(counted, 10);
    });
  });

  describe("Boundary conditions", () => {
    it("handles zero expected", () => {
      expect(varianceQty(10, 0)).toBe(10);
    });

    it("handles zero counted", () => {
      expect(varianceQty(0, 50)).toBe(-50);
    });

    it("handles both zero", () => {
      expect(varianceQty(0, 0)).toBe(0);
    });
  });
});

describe("Formula F-ST-02: variancePct", () => {
  describe("Forward reconciliation", () => {
    it("calculates percentage for a typical shrinkage scenario", () => {
      // variance = -7.7, expected = 100 → -7.7%
      expect(variancePct(-7.7, 100)).toBeCloseTo(-7.7, 10);
    });

    it("calculates percentage for surplus", () => {
      // variance = 5.5, expected = 100 → 5.5%
      expect(variancePct(5.5, 100)).toBe(5.5);
    });
  });

  describe("Backward reconciliation", () => {
    it("variance = (pct / 100) × expected (algebraic inverse)", () => {
      const variance = -12.5;
      const expected = 200;
      const pct = variancePct(variance, expected)!;
      expect((pct / 100) * expected).toBeCloseTo(variance, 10);
    });
  });

  describe("Boundary conditions", () => {
    it("returns null when expected is 0 (division by zero guard)", () => {
      expect(variancePct(10, 0)).toBeNull();
      expect(variancePct(0, 0)).toBeNull();
    });

    it("returns 0% when variance is 0 and expected is non-zero", () => {
      expect(variancePct(0, 50)).toBe(0);
    });
  });

  describe("Precision verification", () => {
    it("handles small fractional expected values without blowing up", () => {
      // variance = 0.001, expected = 0.01 → 10%
      expect(variancePct(0.001, 0.01)).toBeCloseTo(10, 5);
    });
  });
});

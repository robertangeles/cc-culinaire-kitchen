import { describe, it, expect } from "vitest";
import {
  dailyUsageRate,
  daysUntilDepletion,
  suggestedReorderQty,
  forecastConfidence,
} from "./forecastMath.js";

describe("Formula F-FC-01: dailyUsageRate", () => {
  describe("Forward reconciliation", () => {
    it("calculates rate from realistic consumption over 30 days", () => {
      // 45.6 kg consumed over 30 days = 1.52 per day
      expect(dailyUsageRate(45.6, 30)).toBeCloseTo(1.52, 10);
    });

    it("handles fractional elapsed days", () => {
      expect(dailyUsageRate(10, 3.5)).toBeCloseTo(10 / 3.5, 10);
    });
  });

  describe("Backward reconciliation", () => {
    it("rate × days = totalConsumed (algebraic identity)", () => {
      const total = 123.456;
      const days = 28;
      const rate = dailyUsageRate(total, days);
      expect(rate * days).toBeCloseTo(total, 10);
    });
  });

  describe("Boundary conditions", () => {
    it("floors elapsedDays to 1 when 0 (no division by zero)", () => {
      expect(dailyUsageRate(50, 0)).toBe(50);
    });

    it("floors elapsedDays to 1 when negative", () => {
      expect(dailyUsageRate(50, -5)).toBe(50);
    });

    it("returns 0 when totalConsumed is 0", () => {
      expect(dailyUsageRate(0, 30)).toBe(0);
    });
  });
});

describe("Formula F-FC-02: daysUntilDepletion", () => {
  describe("Forward reconciliation", () => {
    it("calculates days for realistic stock / rate", () => {
      // 24.7 kg stock, 1.52/day → floor(16.25) = 16
      expect(daysUntilDepletion(24.7, 1.52)).toBe(16);
    });

    it("returns 0 when stock is 0", () => {
      expect(daysUntilDepletion(0, 5)).toBe(0);
    });
  });

  describe("Backward reconciliation (lossy — floor)", () => {
    it("stock / rate is in range [result, result+1)", () => {
      const stock = 100;
      const rate = 7.3;
      const days = daysUntilDepletion(stock, rate);
      const exact = stock / rate;
      expect(days).toBeLessThanOrEqual(exact);
      expect(days).toBeGreaterThanOrEqual(Math.floor(exact));
    });
  });

  describe("Boundary conditions", () => {
    it("returns 0 when dailyRate is 0", () => {
      expect(daysUntilDepletion(100, 0)).toBe(0);
    });

    it("returns 0 when dailyRate is negative", () => {
      expect(daysUntilDepletion(100, -1)).toBe(0);
    });
  });

  describe("Invariants", () => {
    it("result is always a non-negative integer", () => {
      const result = daysUntilDepletion(33.33, 2.7);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("Formula F-FC-03: suggestedReorderQty", () => {
  describe("Forward reconciliation", () => {
    it("uses default 14-day buffer", () => {
      // rate 2.5/day × 14 = 35 → ceil = 35
      expect(suggestedReorderQty(2.5)).toBe(35);
    });

    it("uses explicit buffer days", () => {
      // rate 3.33/day × 7 = 23.31 → ceil = 24
      expect(suggestedReorderQty(3.33, 7)).toBe(24);
    });

    it("handles fractional daily rate that produces exact integer", () => {
      // rate 2.0/day × 14 = 28.0 → ceil = 28
      expect(suggestedReorderQty(2.0, 14)).toBe(28);
    });
  });

  describe("Backward reconciliation (lossy — ceil)", () => {
    it("result / bufferDays >= dailyRate", () => {
      const rate = 4.7;
      const buffer = 10;
      const qty = suggestedReorderQty(rate, buffer);
      expect(qty / buffer).toBeGreaterThanOrEqual(rate);
    });
  });

  describe("Boundary conditions", () => {
    it("returns 0 when daily rate is 0", () => {
      expect(suggestedReorderQty(0)).toBe(0);
    });
  });

  describe("Invariants", () => {
    it("result is always a non-negative integer", () => {
      const result = suggestedReorderQty(1.111, 21);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("Formula F-FC-04: forecastConfidence", () => {
  describe("Forward reconciliation", () => {
    it("full confidence when daysWithData equals window", () => {
      expect(forecastConfidence(30)).toBe(1);
    });

    it("partial confidence scales linearly", () => {
      // 15 / 30 = 0.5
      expect(forecastConfidence(15)).toBe(0.5);
    });

    it("uses custom window", () => {
      // 10 / 60 = 0.1667
      expect(forecastConfidence(10, 60)).toBeCloseTo(0.1667, 3);
    });
  });

  describe("Backward reconciliation", () => {
    it("confidence × windowDays = daysWithData (when < window)", () => {
      const days = 18;
      const window = 30;
      const conf = forecastConfidence(days, window);
      expect(conf * window).toBeCloseTo(days, 10);
    });
  });

  describe("Boundary conditions", () => {
    it("caps at 1 when daysWithData exceeds window", () => {
      expect(forecastConfidence(60, 30)).toBe(1);
    });

    it("returns 0 when daysWithData is 0", () => {
      expect(forecastConfidence(0)).toBe(0);
    });

    it("returns 1 when windowDays is 0 (degenerate — avoid division by zero)", () => {
      expect(forecastConfidence(5, 0)).toBe(1);
    });
  });

  describe("Invariants", () => {
    it("result is always in [0, 1]", () => {
      for (const days of [0, 1, 15, 30, 100]) {
        const c = forecastConfidence(days);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    });
  });
});

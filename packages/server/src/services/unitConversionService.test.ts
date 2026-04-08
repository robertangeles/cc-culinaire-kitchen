import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock DB ───────────────────────────────────────────────────────
let mockIngredientRows: any[] = [];
let mockConversionRows: any[] = [];

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn((_cols?: any) => ({
      from: vi.fn((table: any) => ({
        where: vi.fn(() => {
          // Return conversions or ingredients based on which table is queried
          if (table === "unit_conversion") return mockConversionRows;
          return mockIngredientRows;
        }),
      })),
    })),
  },
}));

vi.mock("../db/schema.js", () => ({
  ingredient: "ingredient",
  unitConversion: "unit_conversion",
}));

describe("unitConversionService", () => {
  beforeEach(() => {
    vi.resetModules();
    mockIngredientRows = [];
    mockConversionRows = [];
  });

  describe("convertToBase", () => {
    it("returns the same qty when entered unit matches base unit", async () => {
      mockIngredientRows = [{ baseUnit: "kg" }];
      const { convertToBase } = await import("./unitConversionService.js");

      const result = await convertToBase("ing-1", 5, "kg");
      expect(result).toEqual({ baseQty: 5, baseUnit: "kg" });
    });

    it("converts using the conversion factor", async () => {
      mockIngredientRows = [{ baseUnit: "each" }];
      mockConversionRows = [{ fromUnit: "case", toBaseFactor: "12" }];
      const { convertToBase, invalidateConversionCache } = await import("./unitConversionService.js");
      invalidateConversionCache("ing-1");

      const result = await convertToBase("ing-1", 5, "case");
      expect(result).toEqual({ baseQty: 60, baseUnit: "each" });
    });

    it("handles decimal conversion factors", async () => {
      mockIngredientRows = [{ baseUnit: "kg" }];
      mockConversionRows = [{ fromUnit: "portion", toBaseFactor: "0.15" }];
      const { convertToBase, invalidateConversionCache } = await import("./unitConversionService.js");
      invalidateConversionCache("ing-2");

      const result = await convertToBase("ing-2", 10, "portion");
      expect(result.baseQty).toBeCloseTo(1.5);
      expect(result.baseUnit).toBe("kg");
    });

    it("throws when ingredient not found", async () => {
      mockIngredientRows = [];
      const { convertToBase } = await import("./unitConversionService.js");

      await expect(convertToBase("nonexistent", 5, "kg"))
        .rejects.toThrow("Ingredient not found");
    });

    it("throws when unit has no conversion", async () => {
      mockIngredientRows = [{ baseUnit: "kg" }];
      mockConversionRows = [];
      const { convertToBase, invalidateConversionCache } = await import("./unitConversionService.js");
      invalidateConversionCache("ing-3");

      await expect(convertToBase("ing-3", 5, "bogus"))
        .rejects.toThrow("No conversion found");
    });

    it("is case-insensitive for base unit matching", async () => {
      mockIngredientRows = [{ baseUnit: "kg" }];
      const { convertToBase } = await import("./unitConversionService.js");

      const result = await convertToBase("ing-4", 5, "KG");
      expect(result).toEqual({ baseQty: 5, baseUnit: "kg" });
    });

    it("handles zero quantity", async () => {
      mockIngredientRows = [{ baseUnit: "each" }];
      mockConversionRows = [{ fromUnit: "case", toBaseFactor: "12" }];
      const { convertToBase, invalidateConversionCache } = await import("./unitConversionService.js");
      invalidateConversionCache("ing-5");

      const result = await convertToBase("ing-5", 0, "case");
      expect(result).toEqual({ baseQty: 0, baseUnit: "each" });
    });
  });

  describe("getValidUnits", () => {
    it("returns base unit plus conversion units", async () => {
      mockIngredientRows = [{ baseUnit: "kg" }];
      mockConversionRows = [
        { fromUnit: "portion", toBaseFactor: "0.15" },
        { fromUnit: "case", toBaseFactor: "5" },
      ];
      const { getValidUnits, invalidateConversionCache } = await import("./unitConversionService.js");
      invalidateConversionCache("ing-6");

      const units = await getValidUnits("ing-6");
      expect(units).toContain("kg");
      expect(units).toContain("portion");
      expect(units).toContain("case");
      expect(units).toHaveLength(3);
    });

    it("returns empty array for nonexistent ingredient", async () => {
      mockIngredientRows = [];
      const { getValidUnits } = await import("./unitConversionService.js");

      const units = await getValidUnits("nonexistent");
      expect(units).toEqual([]);
    });
  });
});

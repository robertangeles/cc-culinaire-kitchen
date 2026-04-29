import { describe, it, expect } from "vitest";
import {
  convertUnit,
  convertToBaseUnit,
  normalizeUnit,
  unitsCompatibleWith,
  IncompatibleUnitsError,
} from "./units.js";

describe("convertUnit — mass family", () => {
  it("g → kg", () => {
    expect(convertUnit(50, "g", "kg")).toBeCloseTo(0.05, 5);
  });

  it("kg → g", () => {
    expect(convertUnit(0.5, "kg", "g")).toBeCloseTo(500, 5);
  });

  it("mg → g", () => {
    expect(convertUnit(2500, "mg", "g")).toBeCloseTo(2.5, 5);
  });

  it("identity (g → g)", () => {
    expect(convertUnit(123.45, "g", "g")).toBe(123.45);
  });
});

describe("convertUnit — volume family", () => {
  it("ml → L", () => {
    expect(convertUnit(750, "ml", "l")).toBeCloseTo(0.75, 5);
  });

  it("tbsp → tsp (1 tbsp = 3 tsp)", () => {
    expect(convertUnit(2, "tbsp", "tsp")).toBeCloseTo(6, 2);
  });

  it("cup → ml", () => {
    expect(convertUnit(1, "cup", "ml")).toBeCloseTo(236.588, 2);
  });
});

describe("convertUnit — count family", () => {
  it("dozen → each", () => {
    expect(convertUnit(2, "dozen", "each")).toBe(24);
  });

  it("each → portion treats them as 1:1 (app-internal alias)", () => {
    expect(convertUnit(5, "each", "portion")).toBe(5);
  });
});

describe("convertUnit — incompatible families", () => {
  it("kg → ml throws IncompatibleUnitsError", () => {
    expect(() => convertUnit(1, "kg", "ml")).toThrow(IncompatibleUnitsError);
  });

  it("each → g throws", () => {
    expect(() => convertUnit(1, "each", "g")).toThrow(/families differ/);
  });

  it("the error names the violating units", () => {
    try {
      convertUnit(1, "kg", "ml");
    } catch (e) {
      expect((e as Error).message).toContain("kg");
      expect((e as Error).message).toContain("ml");
    }
  });
});

describe("convertToBaseUnit", () => {
  it("delegates to convertUnit", () => {
    // Same behaviour, different intent — used inline in cost flow.
    expect(convertToBaseUnit(50, "g", "kg")).toBeCloseTo(0.05, 5);
  });
});

describe("normalizeUnit", () => {
  it("normalises common aliases", () => {
    expect(normalizeUnit("KG")).toBe("kg");
    expect(normalizeUnit("kilograms")).toBe("kg");
    expect(normalizeUnit(" L ")).toBe("l");
    expect(normalizeUnit("liters")).toBe("l");
    expect(normalizeUnit("Tablespoon")).toBe("tbsp");
    expect(normalizeUnit("ea")).toBe("each");
    expect(normalizeUnit("dz")).toBe("dozen");
    expect(normalizeUnit("serving")).toBe("portion");
  });

  it("returns null for unknown units", () => {
    expect(normalizeUnit("furlong")).toBeNull();
    expect(normalizeUnit("")).toBeNull();
  });
});

describe("unitsCompatibleWith", () => {
  it("groups units by family", () => {
    expect(unitsCompatibleWith("kg")).toContain("g");
    expect(unitsCompatibleWith("kg")).toContain("mg");
    expect(unitsCompatibleWith("kg")).not.toContain("ml");

    expect(unitsCompatibleWith("ml")).toContain("l");
    expect(unitsCompatibleWith("ml")).toContain("tbsp");
    expect(unitsCompatibleWith("ml")).not.toContain("g");

    expect(unitsCompatibleWith("each")).toEqual(["each", "dozen", "portion"]);
  });
});

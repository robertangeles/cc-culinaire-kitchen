import { describe, it, expect } from "vitest";
import { suggestDensity } from "./densities.js";

describe("suggestDensity", () => {
  it("matches common liquids", () => {
    expect(suggestDensity("Full Cream Milk")).toBe(1.03);
    expect(suggestDensity("Thickened Cream")).toBe(1.01);
    expect(suggestDensity("Vanilla Extract")).toBe(1.05);
    expect(suggestDensity("Organic Apple Juice")).toBe(1.045);
    expect(suggestDensity("Golden Syrup")).toBe(1.43);
    expect(suggestDensity("Spring Water")).toBe(1.0);
  });

  it("specific patterns beat generic ones (ordering regression)", () => {
    // "Ice Cream Vanilla" contains "cream" — must match "ice cream" (0.55),
    // not the generic "cream" (1.01). Caught live during dev seeding.
    expect(suggestDensity("Ice Cream Vanilla")).toBe(0.55);
    expect(suggestDensity("Condensed Milk")).toBe(1.29); // not generic "milk"
    expect(suggestDensity("Coconut Milk")).toBe(0.97);
  });

  it("returns null for non-liquids and unknowns", () => {
    expect(suggestDensity("Baker's Flour (T55)")).toBeNull();
    expect(suggestDensity("Eggs")).toBeNull();
    expect(suggestDensity("")).toBeNull();
  });
});

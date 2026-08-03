import { describe, it, expect } from "vitest";
import { toPurchasePackages, toPackCost, costForOrderedUnit } from "./packaging.js";

/**
 * Both directions of the kitchen<->package bridge shipped as live bugs on the
 * PO form. These lock the real numbers from that incident.
 */
describe("toPackCost", () => {
  it("prices the live flour case: $1.40/kg in a 12.5 kg bag is $17.50/bag", () => {
    expect(toPackCost(1.4, 12.5, "bag")).toBe(17.5);
  });

  it("returns null with no packaging — the per-kitchen-unit cost already fits", () => {
    expect(toPackCost(1.4, null, null)).toBeNull();
    expect(toPackCost(1.4, 12.5, null)).toBeNull();
  });

  it("guards a zero pack size instead of producing 0", () => {
    expect(toPackCost(1.4, 0, "bag")).toBeNull();
  });

  it("keeps 4dp so it never re-rounds what numeric(10,4) stores", () => {
    expect(toPackCost(0.3333, 3, "case")).toBe(0.9999);
  });
});

describe("costForOrderedUnit", () => {
  it("uses the pack cost when the line is ordered in packages", () => {
    expect(costForOrderedUnit(1.4, 12.5, "bag", "bag")).toBe(17.5);
  });

  it("uses the kitchen cost when the operator switches the line to kg", () => {
    expect(costForOrderedUnit(1.4, 12.5, "bag", "kg")).toBe(1.4);
  });

  it("round-trips: switching unit twice returns the original price", () => {
    const asPack = costForOrderedUnit(1.4, 12.5, "bag", "bag");
    const backToBase = costForOrderedUnit(1.4, 12.5, "bag", "kg");
    expect(asPack).toBe(17.5);
    expect(backToBase).toBe(1.4);
  });
});

describe("qty and cost stay reconciled", () => {
  it("packages x pack cost equals kitchen qty x kitchen cost", () => {
    // 25 kg needed, 12.5 kg bags at $1.40/kg.
    const packs = toPurchasePackages(25, 12.5, "bag")!;
    const packCost = toPackCost(1.4, 12.5, "bag")!;
    expect(packs).toBe(2);
    expect(packs * packCost).toBe(35); // 25 kg x $1.40 = $35, no double-conversion
  });
});

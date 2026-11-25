import { describe, it, expect } from "vitest";
import { planHiddenCostSave, type LineToSave } from "./hiddenCostLines.js";
import type { MenuIngredient } from "../../hooks/useMenuItems.js";

/** A save by someone who cannot see costs must not rewrite a line they did not change: its cost would be lost. */
const row = (id: number, over: Partial<MenuIngredient> = {}): MenuIngredient => ({
  id, menuItemId: "m1", ingredientId: null, ingredientName: `Line ${id}`, note: null, quantity: "0.100", unit: "kg", yieldPct: "100.00", ...over,
});
const line = (existingId: number | undefined, over: Partial<LineToSave> = {}): LineToSave => ({
  existingId, ingredientId: null, ingredientName: `Line ${existingId ?? "new"}`, note: null, quantity: "0.1", unit: "kg", yieldPct: "100", ...over,
});

describe("planHiddenCostSave", () => {
  it("does nothing when nothing changed, however the numbers are written", () => {
    expect(planHiddenCostSave([line(1), line(2)], [row(1), row(2)])).toEqual({ add: [], remove: [] });
  });

  it.each<[string, Partial<LineToSave>]>([
    ["quantity", { quantity: "0.2" }],
    ["unit", { unit: "g" }],
    ["yield", { yieldPct: "90" }],
    ["name", { ingredientName: "Other" }],
    ["link", { ingredientId: "i9" }],
    ["note", { note: "sifted" }],
  ])("replaces a line whose %s changed, and only that one", (_what, change) => {
    const changed = line(1, change);
    expect(planHiddenCostSave([changed, line(2)], [row(1), row(2)])).toEqual({ add: [changed], remove: [1] });
  });

  it("adds a new line and removes one taken out of the form", () => {
    const added = line(undefined);
    expect(planHiddenCostSave([line(1), added], [row(1), row(2)])).toEqual({ add: [added], remove: [2] });
  });

  it("a second try after a failed save removes what the first try left behind", () => {
    const changed = line(1, { quantity: "0.2" });
    expect(planHiddenCostSave([changed], [row(1), row(8, { ingredientName: "Line 1", quantity: "0.200" })])).toEqual({ add: [changed], remove: [1, 8] });
  });

  it("adds a line again when its row is gone from the server", () => {
    expect(planHiddenCostSave([line(1)], [row(2)])).toEqual({ add: [line(1)], remove: [2] });
  });
});

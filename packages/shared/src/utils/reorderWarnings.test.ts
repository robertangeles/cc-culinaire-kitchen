import { describe, it, expect } from "vitest";
import { reorderCheckLine } from "./reorderWarnings.js";

describe("reorderCheckLine", () => {
  it("says nothing when every quantity was worked out", () => {
    expect(reorderCheckLine([])).toBeNull();
  });

  it("names each item to check, and an item with no name as an item", () => {
    expect(reorderCheckLine([{ ingredientName: "Rye" }, { ingredientName: null }])).toBe(
      "Check the quantity of Rye, an item: a unit could not be converted, so the last order's quantity may have been kept.",
    );
  });
});

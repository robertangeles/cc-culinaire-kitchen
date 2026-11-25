import { describe, it, expect } from "vitest";
import { OrderGuideItemSchema, OrderItemSchema } from "@culinaire/shared/schemas/purchasing";
import { draftProblem, draftTotal, emptyDraft, lineFromGuide, lineFromItem, lineTotal, toBody, unitsOf, weekDays, withUnit, type Draft } from "./draft";

const flour = OrderItemSchema.parse({ ingredientId: "i1", ingredientName: "Flour", baseUnit: "kg", purchaseUnit: "bag", packQty: "12.5", locationUnitCost: "1.40" });
const salt = OrderItemSchema.parse({ ingredientId: "i2", ingredientName: "Salt", baseUnit: "kg" });
const draft = (over: Partial<Draft> = {}): Draft => ({ ...emptyDraft, supplierId: "s1", supplierName: "Fresh Farms", ...over });
const line = (over: object = {}) => ({ ingredientId: "i1", ingredientName: "Flour", qty: "2", unit: "bag", cost: "17.5", ...over });

describe("a line of the order", () => {
  it("starts in the package, priced per package from the kitchen-unit cost", () => {
    expect(lineFromItem(flour)).toEqual({ ingredientId: "i1", ingredientName: "Flour", qty: "1", unit: "bag", cost: "17.5" });
    expect(unitsOf(flour)).toEqual(["bag", "kg"]);
    expect(unitsOf(salt)).toEqual(["kg"]);
  });

  it("has no price where the server sent none, never zero", () => {
    expect(lineFromItem(salt)).toMatchObject({ unit: "kg", cost: "" });
    expect(lineTotal(lineFromItem(salt))).toBeNull();
  });

  it("is priced again when its unit changes, so the number never keeps a meaning it lost", () => {
    expect(withUnit(line(), "kg", flour)).toMatchObject({ unit: "kg", cost: "1.4" });
    expect(withUnit(line({ cost: "20" }), "kg", salt)).toMatchObject({ unit: "kg", cost: "" });
    expect(withUnit(line({ cost: "20" }), "bag", flour)).toMatchObject({ cost: "20" });
  });

  it("from a guide orders to par in packages at the package price, and 0 when already at par", () => {
    const g = (over: object) => OrderGuideItemSchema.parse({ ingredientId: "i1", ingredientName: "Flour", baseUnit: "kg", purchaseUnit: "bag", packQty: 12.5, onHand: 0, parLevel: 25, suggestedOrderQty: 25, suggestedPackages: 2, unitCost: 1.4, packUnitCost: 17.5, ...over });
    expect(lineFromGuide(g({}))).toEqual(line());
    expect(lineFromGuide(g({ purchaseUnit: null, suggestedPackages: null, packUnitCost: null }))).toMatchObject({ qty: "25", unit: "kg", cost: "1.4" });
    expect(lineFromGuide(g({ suggestedPackages: 0 })).qty).toBe("0");
    expect(lineFromGuide(g({ unitCost: null, packUnitCost: null })).cost).toBe("");
  });
});

describe("the order", () => {
  it("adds up the priced lines and counts the ones with no price", () => {
    expect(draftTotal(draft({ lines: [line(), line({ ingredientId: "i2", cost: "" }), line({ ingredientId: "i3", qty: "0", cost: "" })] }))).toEqual({ total: 35, unpriced: 1 });
  });

  it("says what stops it being saved", () => {
    expect(draftProblem(emptyDraft)).toBe("Choose a supplier.");
    expect(draftProblem(draft())).toBe("Add at least one item.");
    expect(draftProblem(draft({ lines: [line({ qty: "two" })] }))).toBe("Check the quantity of Flour.");
    expect(draftProblem(draft({ lines: [line({ qty: "-1" })] }))).toBe("Check the quantity of Flour.");
    expect(draftProblem(draft({ lines: [line({ cost: "x" })] }))).toBe("Check the price of Flour.");
    expect(draftProblem(draft({ lines: [line({ qty: "0" })] }))).toBe("Nothing to order yet: set a quantity on at least one item.");
    expect(draftProblem(draft({ lines: [line(), line({ qty: "", cost: "" })] }))).toBeNull();
  });

  it("is sent with only what is ordered, a comma read as a point, and no price where there is none", () => {
    expect(toBody(draft({ lines: [line({ qty: "2,5" }), line({ ingredientId: "i2", cost: "" }), line({ ingredientId: "i3", qty: "0" })], notes: "  Back door ", expectedDate: "2026-11-27" }), "L1")).toEqual({
      storeLocationId: "L1",
      supplierId: "s1",
      lines: [
        { ingredientId: "i1", orderedQty: "2.5", orderedUnit: "bag", unitCost: "17.5" },
        { ingredientId: "i2", orderedQty: "2", orderedUnit: "bag" },
      ],
      notes: "Back door",
      expectedDeliveryDate: "2026-11-27",
    });
    expect(toBody(draft({ lines: [line()] }), "L1")).not.toHaveProperty("notes");
  });

  it("offers the days of a week, across a month's end", () => {
    const days = weekDays(new Date(2026, 10, 25), 1);
    expect(days.map((d) => d.value)).toEqual(["2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06", "2026-12-07", "2026-12-08"]);
    expect(days[0].label).toMatch(/2/);
  });
});

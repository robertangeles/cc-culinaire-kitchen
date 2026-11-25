import { describe, it, expect } from "vitest";
import type { MenuItem } from "@culinaire/shared/schemas/menu";
import { allergensOf, categoriesOf, categoryRows, classInfo, costsOf, filterItems, money, overTarget, pct, withoutCosts } from "./menuView";

const item = (over: Partial<MenuItem> = {}): MenuItem => ({
  menuItemId: "m1", userId: 4, name: "Margherita", category: "Pasta", sellingPrice: 24, servings: 1, servingsPerSale: 1, qFactorPct: 0, foodCost: 6.1, foodCostPct: 25.42, contributionMargin: 17.9, unitsSold: 12, classification: "star",
  containsDairyInd: true, containsGlutenInd: true, containsNutsInd: false, containsShellfishInd: false, containsEggsInd: false, isVegetarianInd: true, canManage: true, ...over,
});

describe("menu view", () => {
  it("writes money and percentages as the web does, a negative margin with its sign first", () => {
    expect(money(6.1)).toBe("$6.10");
    expect(money(-3)).toBe("-$3.00");
    expect(pct(25.42)).toBe("25.4%");
  });

  it("shows the three costs only when the server sent all of them, never a computed or zero one", () => {
    expect(costsOf(item())).toEqual({ foodCost: 6.1, foodCostPct: 25.42, margin: 17.9 });
    expect(costsOf(item({ foodCost: undefined }))).toBeNull();
    expect(costsOf(item({ contributionMargin: null }))).toBeNull();
    expect(costsOf(withoutCosts(item()))).toBeNull();
    expect(withoutCosts(item())).toMatchObject({ name: "Margherita", sellingPrice: 24 });
  });

  it("filters by name or category text, category and class, A to Z", () => {
    const items = [item(), item({ menuItemId: "m2", name: "Affogato", category: "Desserts", classification: "dog" }), item({ menuItemId: "m3", name: "Cannelloni", classification: "puzzle" })];
    const names = (f: Parameters<typeof filterItems>[1]) => filterItems(items, f).map((i) => i.name);
    expect(names({ query: "", category: null, klass: null })).toEqual(["Affogato", "Cannelloni", "Margherita"]);
    expect(names({ query: "dess", category: null, klass: null })).toEqual(["Affogato"]);
    expect(names({ query: "", category: "Pasta", klass: null })).toEqual(["Cannelloni", "Margherita"]);
    expect(names({ query: "", category: "Pasta", klass: "puzzle" })).toEqual(["Cannelloni"]);
    expect(categoriesOf(items)).toEqual(["Desserts", "Pasta"]);
  });

  it("flags an item over its category's target only where a target was set and the cost is known, as the web table does", () => {
    expect(overTarget(item(), { Pasta: 20 })).toBe(20);
    expect(overTarget(item(), { Pasta: 30 })).toBeNull();
    expect(overTarget(item(), {})).toBeNull();
    expect(overTarget(withoutCosts(item()), { Pasta: 20 })).toBeNull();
  });

  it("sums up each category: its items, its target (30 when none is set), its actual and the items over; no actual when a cost is hidden", () => {
    const items = [item(), item({ menuItemId: "m2", name: "Carbonara", foodCostPct: 40 }), item({ menuItemId: "m3", name: "Affogato", category: "Desserts", foodCostPct: 10 })];
    expect(categoryRows(items, { Desserts: 25 })).toEqual([
      { category: "Desserts", count: 1, target: 25, actual: 10, over: [] },
      { category: "Pasta", count: 2, target: 30, actual: 32.71, over: [expect.objectContaining({ name: "Carbonara" })] },
    ]);
    expect(categoryRows(items.map(withoutCosts), {})[1]).toEqual({ category: "Pasta", count: 2, target: 30, actual: null, over: [] });
  });

  it("names the class and the allergens, and treats an unknown class as unclassified", () => {
    expect(classInfo("plowhorse").label).toBe("Plowhorse");
    expect(classInfo("comet")).toEqual(classInfo("unclassified"));
    expect(allergensOf(item())).toEqual(["Dairy", "Gluten", "Vegetarian"]);
  });
});

import { describe, it, expect } from "vitest";
import type { MenuItem } from "@culinaire/shared/schemas/menu";
import { summariseMenuAnalysis } from "@culinaire/shared";
import { actionLabel, allergensOf, categoriesOf, categoryRows, classInfo, costsOf, dashboardOf, filterItems, matrixOf, money, overTarget, pct, plateOf, varianceOf, wasteLabel, withoutCosts } from "./menuView";

const item = (over: Partial<MenuItem> = {}): MenuItem => ({
  menuItemId: "m1", userId: 4, name: "Margherita", category: "Pasta", sellingPrice: 24, servings: 1, servingsPerSale: 1, qFactorPct: 0, foodCost: 6.1, foodCostPct: 25.42, contributionMargin: 17.9, unitsSold: 12, menuMixPct: 60, classification: "star",
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

describe("the dashboard, the matrix and an item's extra figures", () => {
  const menu = [
    item(),
    item({ menuItemId: "m2", name: "Affogato", sellingPrice: 12, foodCost: 2, foodCostPct: 16.67, contributionMargin: 10, unitsSold: 4, menuMixPct: 20, classification: "puzzle" }),
    item({ menuItemId: "m3", name: "Soup", sellingPrice: 9, foodCost: null, foodCostPct: null, contributionMargin: 3, unitsSold: 4, menuMixPct: 20, classification: "dog" }),
    item({ menuItemId: "m4", name: "Special", unitsSold: 0, menuMixPct: 0, classification: "unclassified" }),
  ];

  it("counts the classes and works the averages out with the server's own summary, a cost stored as none counting 0 as there", () => {
    const d = dashboardOf(menu);
    const server = summariseMenuAnalysis(menu.map((i) => ({ ...i, foodCost: i.foodCost ?? 0, foodCostPct: i.foodCostPct ?? 0, contributionMargin: i.contributionMargin ?? 0 })));
    expect(d).toMatchObject({ totalItems: 4, counts: { star: 1, plowhorse: 0, puzzle: 1, dog: 1 } });
    expect(d.costs).toEqual({ avgFoodCostPct: Number(server.avgFoodCostPct), avgMargin: Number(server.avgContributionMargin), overallFoodCostPct: Number(server.overallFoodCostPct) });
    expect([d.highestMargin?.name, d.lowestMargin?.name, d.mostPopular?.name, d.leastPopular?.name]).toEqual(["Margherita", "Soup", "Margherita", "Special"]);
  });

  it("leaves every cost figure and the margin performers out when a cost is hidden, and keeps popularity", () => {
    const d = dashboardOf(menu.map(withoutCosts));
    expect([d.costs, d.highestMargin, d.lowestMargin]).toEqual([null, null, null]);
    expect(d.mostPopular?.name).toBe("Margherita");
    expect(dashboardOf([])).toMatchObject({ totalItems: 0, costs: { avgFoodCostPct: 0 }, mostPopular: null });
  });

  it("places the items that sold as the web's chart does, inside the edges, with the crosshair at the averages", () => {
    const m = matrixOf(menu)!;
    expect(m.points.map((p) => p.item.menuItemId)).toEqual(["m1", "m2", "m3"]);
    // Max mix 60 * 1.2 = 72, max margin 17.9 * 1.2 = 21.48; averages over the three that sold.
    expect(m.points[0].x).toBeCloseTo((60 / 72) * 100);
    expect(m.points[0].y).toBeCloseTo(100 - (17.9 / 21.48) * 100);
    expect(m.avgX).toBeCloseTo((((60 + 20 + 20) / 3) / 72) * 100);
    expect(matrixOf([item({ contributionMargin: 0, menuMixPct: 0 }), item({ menuItemId: "m2", contributionMargin: 0, menuMixPct: 0 })])!.points[0]).toMatchObject({ x: 2, y: 98 });
  });

  it("draws no matrix below two items that sold, or when a margin is hidden", () => {
    expect(matrixOf([menu[0], menu[3]])).toBeNull();
    expect(matrixOf(menu.map(withoutCosts))).toBeNull();
  });

  it("labels waste as the web's column does, a Dog's flagged", () => {
    expect(wasteLabel(menu[0], 40.4)).toBe("$40 wasted");
    expect(wasteLabel(menu[2], 40.6)).toBe("Dog + $41 waste");
    expect(wasteLabel(menu[0], 0)).toBeNull();
    expect(wasteLabel(menu[0], undefined)).toBeNull();
  });

  it("sets one serving's average cost against one serving's share of the price", () => {
    expect(plateOf(item({ sellingPrice: 30, servingsPerSale: 2 }), 5)).toEqual({ price: 15, foodCost: 5, margin: 10, foodCostPct: (5 / 15) * 100 });
    expect(plateOf(item({ sellingPrice: 0 }), 1)).toMatchObject({ margin: -1, foodCostPct: null });
  });

  it("puts the yield variance into words, with its figures only when the comparison was made", () => {
    const base = { theoretical: 100, actual: 110, variance: 10, variancePct: 10, unitsSold: 4, consumptionLogCount: 3, periodStart: "2026-11-01", periodEnd: "2026-11-27" };
    expect(varianceOf({ ...base, status: "ok", threshold: "alert" })).toEqual({ sentence: "10.0% more than the recipe says. Check portions and waste.", figures: { theoretical: 100, actual: 110, variance: 10, variancePct: 10 } });
    expect(varianceOf({ ...base, status: "ok", threshold: "warning", variance: -5, variancePct: -5 }).sentence).toBe("5.0% less than the recipe says. Worth a look.");
    expect(varianceOf({ ...base, status: "ok", threshold: "good" }).sentence).toBe("Within 3% of what the recipe says.");
    expect(varianceOf({ ...base, status: "no-period", threshold: null })).toEqual({ sentence: "No sales period is set for this dish yet, so there is nothing to compare.", figures: null });
    const { theoretical: _t, actual: _a, variance: _v, variancePct: _p, ...blind } = base;
    expect(varianceOf({ ...blind, status: "ok" }).figures).toBeNull();
    expect(varianceOf({ ...base, status: "comet" }).sentence).toBe("There is no comparison for this dish yet.");
  });

  it("names the model's actions as the web does and keeps an unknown one readable", () => {
    expect(actionLabel("raise_price")).toBe("Raise price");
    expect(actionLabel("bundle_with_drink")).toBe("bundle with drink");
  });
});

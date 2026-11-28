import { describe, it, expect } from "vitest";
import { CategoryTargetListSchema, ConversionListSchema, CreatedMenuItemSchema, ImportRecipeListSchema, MenuAnalysisSchema, MenuCatalogueSchema, MenuLineListSchema, PlateCostSchema, RecommendationSchema, ReplacementSchema, SaleListSchema, SaleResultSchema, SalesCsvPreviewSchema, SalesCsvReportSchema, UnitsImportSchema, WasteImpactListSchema, YieldVarianceSchema } from "./menu.js";

// Shaped like the replies of the Wave 7 server (PR 216). The point: a cost the server leaves out for a person without
// `inventory:cost` stays absent, never becomes 0, and one row the phone cannot read never hides the rest.

const item = {
  menuItemId: "m1", userId: 4, organisationId: 1, name: "Margherita", category: "Pasta", sellingPrice: 24, servings: 1, servingsPerSale: 1, qFactorPct: "5.00",
  foodCost: 6.1, foodCostPct: 25.42, contributionMargin: 17.9, unitsSold: 12, menuMixPct: 60, classification: "star", linkedIngredientId: null,
  containsDairyInd: true, containsGlutenInd: true, containsNutsInd: false, containsShellfishInd: false, containsEggsInd: false, isVegetarianInd: true, canManage: true,
};
const line = { id: 7, menuItemId: "m1", ingredientId: "i1", ingredientName: "Mozzarella", note: null, quantity: "0.120", unit: "kg", unitCost: "14.0000", yieldPct: "95.00", lineCost: "1.77", costStaleInd: false, costStaleAt: null, baseUnit: "kg", contentQty: null, contentUnit: null, densityGPerMl: null, purchaseUnit: "case", packQty: "6", catalogUnitCost: "14.0000" };

describe("menu schemas", () => {
  it("reads the analysis with numbers and numeric strings, skips a row it cannot show and keeps an unknown class", () => {
    const { items } = MenuAnalysisSchema.parse({ totalItems: 3, items: [item, { name: "no id" }, { ...item, menuItemId: "m2", sellingPrice: "9.50", classification: "comet", brandNew: 1 }] });
    expect(items.map((i) => i.menuItemId)).toEqual(["m1", "m2"]);
    expect(items[0]).toMatchObject({ sellingPrice: 24, qFactorPct: 5, foodCost: 6.1, canManage: true, containsDairyInd: true });
    expect(items[1]).toMatchObject({ sellingPrice: 9.5, classification: "comet" });
    expect(items[1]).not.toHaveProperty("brandNew");
  });

  it("leaves a hidden cost absent, not zero, and canManage absent from an older server", () => {
    const { foodCost: _a, foodCostPct: _b, contributionMargin: _c, canManage: _d, ...blind } = item;
    const [read] = MenuAnalysisSchema.parse({ items: [blind] }).items;
    expect(read.foodCost).toBeUndefined();
    expect(read.foodCostPct).toBeUndefined();
    expect(read.contributionMargin).toBeUndefined();
    expect(read.canManage).toBeUndefined();
  });

  it("reads recipe lines, with hidden costs absent", () => {
    const { unitCost: _u, lineCost: _l, catalogUnitCost: _c, ...blind } = line;
    const [seen, hidden] = MenuLineListSchema.parse([line, { ...blind, id: 8, ingredientId: null, baseUnit: null }]);
    expect(seen).toMatchObject({ id: 7, quantity: 0.12, unitCost: 14, yieldPct: 95, lineCost: 1.77, packQty: 6, purchaseUnit: "case" });
    expect(hidden).toMatchObject({ id: 8, ingredientId: null, baseUnit: null });
    expect(hidden.unitCost).toBeUndefined();
    expect(hidden.lineCost).toBeUndefined();
  });

  it("reads a created item by its id, which is all the create reply is used for", () => {
    expect(CreatedMenuItemSchema.parse({ menuItemId: "m9", sellingPrice: "1.00" })).toEqual({ menuItemId: "m9" });
    expect(() => CreatedMenuItemSchema.parse({})).toThrow();
  });

  it("reads category targets, the importable recipes, the catalogue and an item's conversions", () => {
    expect(CategoryTargetListSchema.parse([{ id: 1, userId: 4, categoryName: "Pasta", targetFoodCostPct: "28.50" }])).toEqual([{ categoryName: "Pasta", targetFoodCostPct: 28.5 }]);
    expect(ImportRecipeListSchema.parse({ recipes: [{ recipeId: "r1", title: "Gnocchi", domain: "recipe", yield: "4 servings", ingredients: [{ name: "Potato", amount: 500, unit: "g" }, { amount: "1" }] }] })).toEqual([
      { recipeId: "r1", title: "Gnocchi", domain: "recipe", yield: "4 servings", ingredients: [{ name: "Potato", amount: "500", unit: "g", note: null }] },
    ]);
    const [c] = MenuCatalogueSchema.parse([{ ingredientId: "i1", ingredientName: "Wine", ingredientCategory: "wine", baseUnit: "bottle", contentQty: "750.000", contentUnit: "ml", unitCost: "18.0000" }, { nope: 1 }]);
    expect(c).toMatchObject({ ingredientId: "i1", contentQty: 750, contentUnit: "ml", unitCost: 18 });
    expect(c.preferredUnitCost).toBeUndefined();
    expect(ConversionListSchema.parse({ baseUnit: "kg", conversions: [{ fromUnit: "tray", toBaseFactor: "2.5" }] })).toEqual([{ fromUnit: "tray", toBaseFactor: 2.5 }]);
  });

  it("reads a recorded sale, a replayed one and the recent sales", () => {
    expect(SaleResultSchema.parse({ saleId: "s1", depleted: [{ ingredientId: "i1", ingredientName: "Mozzarella", baseQty: 0.25, baseUnit: "kg", fohOnHand: -1, oversold: true }], skipped: [{ ingredientName: "Basil", reason: "free text" }], oversold: ["Mozzarella"] })).toMatchObject({ saleId: "s1", alreadyExists: false, voided: false, oversold: ["Mozzarella"] });
    expect(SaleResultSchema.parse({ saleId: "s1", alreadyExists: true, voided: true, depleted: [], skipped: [], oversold: [] })).toMatchObject({ alreadyExists: true, voided: true });
    expect(SaleListSchema.parse([{ saleId: "s1", menuItemId: "m1", menuItemName: "Margherita", qtySold: "2.000", source: "MANUAL", soldAt: "2026-11-25T01:00:00.000Z", voidedAt: null, canManage: false }, {}])).toEqual([
      { saleId: "s1", menuItemName: "Margherita", qtySold: 2, soldAt: "2026-11-25T01:00:00.000Z", voidedAt: null, canManage: false },
    ]);
  });

  it("reads the menu mix, the waste, the yield variance and the plate cost, a hidden figure absent", () => {
    expect(MenuAnalysisSchema.parse({ items: [item, { ...item, menuItemId: "m2", menuMixPct: "12.50" }, { ...item, menuItemId: "m3", menuMixPct: undefined }] }).items.map((i) => i.menuMixPct)).toEqual([60, 12.5, 0]);
    expect(WasteImpactListSchema.parse([{ menuItemId: "m1", wasteEstimate: 40.5 }, { menuItemId: "m2" }, { wasteEstimate: 3 }])).toEqual([{ menuItemId: "m1", wasteEstimate: 40.5 }, { menuItemId: "m2" }]);
    const variance = { menuItemId: "m1", status: "ok", theoretical: 20, actual: 23, variance: 3, variancePct: 15, threshold: "alert", unitsSold: 2, consumptionLogCount: 4, periodStart: "2026-11-01", periodEnd: "2026-11-27" };
    expect(YieldVarianceSchema.parse(variance)).toMatchObject({ status: "ok", variancePct: 15, threshold: "alert", periodEnd: "2026-11-27" });
    const { theoretical: _t, actual: _a, variance: _v, variancePct: _p, threshold: _h, ...blind } = variance;
    const hidden = YieldVarianceSchema.parse(blind);
    expect([hidden.theoretical, hidden.actual, hidden.variance, hidden.variancePct, hidden.threshold]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(PlateCostSchema.parse({ menuItemId: "m1", foodCost: 3.5 }).foodCost).toBe(3.5);
    expect(PlateCostSchema.parse({ menuItemId: "m1" }).foodCost).toBeUndefined();
  });

  it("reads recommendations, a replacement and both CSV imports, skipping a row it cannot read", () => {
    expect(RecommendationSchema.parse({ summary: "Rework it.", actions: [{ type: "raise_price", description: "Charge $11.", impact: "+$2" }, { type: "teleport" , description: "Move it." }, { description: "" }] })).toEqual({ summary: "Rework it.", actions: [{ type: "raise_price", description: "Charge $11.", impact: "+$2" }, { type: "teleport", description: "Move it." }] });
    expect(ReplacementSchema.parse({ request: "Generate a replacement recipe", domain: "recipe" })).toEqual({ request: "Generate a replacement recipe" });
    expect(SalesCsvPreviewSchema.parse({ matched: [{ rowIndex: 1, menuItemId: "m1", name: "Margherita", qtySold: 2 }, { rowIndex: 2 }], unmatched: [{ rowIndex: 3, name: "Pizza", reason: "no matching menu item" }] })).toEqual({
      matched: [{ rowIndex: 1, menuItemId: "m1", name: "Margherita", qtySold: 2 }],
      unmatched: [{ rowIndex: 3, name: "Pizza", reason: "no matching menu item" }],
    });
    expect(SalesCsvReportSchema.parse({ succeeded: [{ rowIndex: 1, saleId: "s1" }], alreadyExists: [], failed: [{ rowIndex: 2, reason: "failed" }] })).toMatchObject({ succeeded: [{}], failed: [{ rowIndex: 2, reason: "failed" }] });
    expect(UnitsImportSchema.parse({ updated: 2, notFound: ["Pizza"] })).toEqual({ updated: 2, notFound: ["Pizza"] });
  });
});

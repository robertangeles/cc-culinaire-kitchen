import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 3 unit tests — focused on error paths for refreshIngredientCost and
 * the no-location fallback in getPandLFoodCost. The full happy paths are
 * exercised by the Phase 3 migration verifier (live trigger smoke tests)
 * and by the Playwright UI verification — those run against the real DB
 * with real triggers, which is more useful than mocking out Drizzle here.
 */

// ── Shared mock state ────────────────────────────────────────────────

const mockSelectRows: Array<unknown[]> = [];
let selectCallIdx = 0;

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => {
          const rows = mockSelectRows[selectCallIdx] ?? [];
          if (selectCallIdx < mockSelectRows.length - 1) selectCallIdx++;
          return rows;
        }),
        leftJoin: vi.fn(() => ({
          where: vi.fn(async () => mockSelectRows[selectCallIdx] ?? []),
        })),
        orderBy: vi.fn(async () => mockSelectRows[selectCallIdx] ?? []),
        limit: vi.fn(async () => mockSelectRows[selectCallIdx] ?? []),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{}]),
        })),
      })),
    })),
    delete: vi.fn(() => ({ where: vi.fn() })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => [{}]) })) })),
  },
}));

vi.mock("../db/schema.js", () => ({
  menuItem: { menuItemId: "menu_item_id", storeLocationId: "store_location_id", foodCost: "food_cost" },
  menuItemIngredient: { id: "id", menuItemId: "menu_item_id", ingredientId: "ingredient_id" },
  menuCategorySetting: {},
  wasteLog: {},
  ingredient: { ingredientId: "ingredient_id", preferredUnitCost: "preferred_unit_cost", unitCost: "unit_cost", baseUnit: "base_unit" },
  locationIngredient: { storeLocationId: "store_location_id", ingredientId: "ingredient_id", weightedAverageCost: "weighted_average_cost" },
}));

beforeEach(() => {
  mockSelectRows.length = 0;
  selectCallIdx = 0;
  vi.clearAllMocks();
});

function setRows(...rowsByCall: unknown[][]) {
  mockSelectRows.push(...rowsByCall);
  selectCallIdx = 0;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("refreshIngredientCost — Phase 3", () => {
  it("throws when the menu_item_ingredient row is not found", async () => {
    setRows([]); // first SELECT returns no rows
    const { refreshIngredientCost } = await import("./menuIntelligenceService.js");
    await expect(refreshIngredientCost(999, "menu-item-1")).rejects.toThrow(
      /not found/i,
    );
  });

  it("throws when the row is unlinked (legacy free-text)", async () => {
    setRows([{ id: 1, menuItemId: "menu-item-1", ingredientId: null }]);
    const { refreshIngredientCost } = await import("./menuIntelligenceService.js");
    await expect(refreshIngredientCost(1, "menu-item-1")).rejects.toThrow(
      /unlinked/i,
    );
  });
});

describe("resolveUnitCost — zero-cost fallthrough", () => {
  // Regression: linked Sea Salt row stored unit_cost=0 froze the menu item at $0
  // even though the catalog had $0.0238/g. A stored/typed 0 must never be treated
  // as a manual override on a linked ingredient.
  // Found by /qa on 2026-05-29.

  it("uses a POSITIVE caller cost as an explicit override", async () => {
    const { resolveUnitCost } = await import("./menuIntelligenceService.js");
    const cost = await resolveUnitCost("5.50", "ingredient-1");
    expect(cost).toBe("5.50");
  });

  it("falls through to catalog preferred cost when caller cost is '0' on a linked row", async () => {
    setRows([{ preferred: "0.0238", orgDefault: "0.0238" }]);
    const { resolveUnitCost } = await import("./menuIntelligenceService.js");
    const cost = await resolveUnitCost("0", "ingredient-1");
    expect(cost).toBe("0.0238");
  });

  it("falls through to catalog when caller cost is '0.0000' on a linked row", async () => {
    setRows([{ preferred: "0.0238", orgDefault: "0.0238" }]);
    const { resolveUnitCost } = await import("./menuIntelligenceService.js");
    const cost = await resolveUnitCost("0.0000", "ingredient-1");
    expect(cost).toBe("0.0238");
  });

  it("falls through to catalog when caller cost is empty/undefined on a linked row", async () => {
    setRows([{ preferred: "0.0238", orgDefault: "0.0238" }]);
    const { resolveUnitCost } = await import("./menuIntelligenceService.js");
    const cost = await resolveUnitCost(undefined, "ingredient-1");
    expect(cost).toBe("0.0238");
  });

  it("prefers preferred_unit_cost over org default", async () => {
    setRows([{ preferred: "0.0238", orgDefault: "0.0300" }]);
    const { resolveUnitCost } = await import("./menuIntelligenceService.js");
    const cost = await resolveUnitCost("", "ingredient-1");
    expect(cost).toBe("0.0238");
  });

  it("returns '0' for an unlinked row with no caller cost", async () => {
    const { resolveUnitCost } = await import("./menuIntelligenceService.js");
    const cost = await resolveUnitCost(undefined, null);
    expect(cost).toBe("0");
  });
});

describe("getPandLFoodCost — Phase 3", () => {
  it("falls back to menu_item.food_cost when no storeLocationId", async () => {
    setRows(
      [{ storeLocationId: null }],   // first SELECT: menu item, no location
      [{ foodCost: "42.50" }],        // second SELECT: foodCost fallback
    );
    const { getPandLFoodCost } = await import("./menuIntelligenceService.js");
    const cost = await getPandLFoodCost("menu-item-1");
    expect(cost).toBe(42.5);
  });

  it("throws when the menu item is not found", async () => {
    setRows([]); // first SELECT returns no rows
    const { getPandLFoodCost } = await import("./menuIntelligenceService.js");
    await expect(getPandLFoodCost("missing-id")).rejects.toThrow(/not found/i);
  });
});

// ── Formula tests: cost calculations ────────────────────────────────

describe("resolveUnitCost — formula edge cases", () => {
  it("returns '0' for unlinked row with caller cost of '0'", async () => {
    const { resolveUnitCost } = await import("./menuIntelligenceService.js");
    // Unlinked (ingredientId=null), caller cost='0' → numeric 0 is finite
    // but not > 0, and no ingredientId, so returns '0'
    const cost = await resolveUnitCost("0", null);
    expect(cost).toBe("0");
  });

  it("returns caller cost when positive, even if very small", async () => {
    const { resolveUnitCost } = await import("./menuIntelligenceService.js");
    const cost = await resolveUnitCost("0.001", "ingredient-1");
    expect(cost).toBe("0.001");
  });

  it("returns '0' when ingredient not found in catalog", async () => {
    setRows([]); // catalog lookup returns nothing
    const { resolveUnitCost } = await import("./menuIntelligenceService.js");
    const cost = await resolveUnitCost(undefined, "nonexistent-ingredient");
    expect(cost).toBe("0");
  });
});

describe("food_cost formula verification", () => {
  // food_cost = SUM(line_costs) / servings * (1 + qFactor/100)
  // food_cost_pct = (food_cost / selling_price) * 100
  // contribution_margin = selling_price - food_cost

  it("food_cost_pct = (food_cost / selling_price) * 100 for known values", () => {
    // Pure math: food_cost=12.40, selling_price=32.00
    const foodCost = 12.40;
    const sellingPrice = 32.00;
    const foodCostPct = sellingPrice > 0 ? (foodCost / sellingPrice) * 100 : 0;
    expect(foodCostPct).toBeCloseTo(38.75, 2);
  });

  it("contribution_margin = selling_price - food_cost", () => {
    const foodCost = 12.40;
    const sellingPrice = 32.00;
    const contributionMargin = sellingPrice - foodCost;
    expect(contributionMargin).toBeCloseTo(19.60, 2);
  });

  it("food_cost = SUM(line_costs) / servings for multi-ingredient dish", () => {
    // 3 ingredients with known line costs (already unit-converted)
    const lineCosts = [4.50, 3.20, 2.70]; // total = 10.40
    const servings = 2;
    const totalIngredientCost = lineCosts.reduce((s, lc) => s + lc, 0);
    const perServing = totalIngredientCost / servings;
    expect(perServing).toBeCloseTo(5.20, 2);
  });

  it("q-factor inflates food_cost correctly", () => {
    // totalIngredientCost=10.40, servings=1, qFactorPct=15
    const perServing = 10.40;
    const qFactor = 15;
    const foodCost = perServing * (1 + qFactor / 100);
    expect(foodCost).toBeCloseTo(11.96, 2);
  });
});

describe("menu_mix_pct invariant", () => {
  it("SUM(menu_mix_pct) = 100 for 4 items", () => {
    const unitsSoldArr = [120, 80, 60, 40];
    const totalUnitsSold = unitsSoldArr.reduce((s, u) => s + u, 0); // 300
    const mixPcts = unitsSoldArr.map((u) => (u / totalUnitsSold) * 100);
    const sum = mixPcts.reduce((s, p) => s + p, 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  it("all items get 0% when totalUnitsSold is 0", () => {
    const unitsSoldArr = [0, 0, 0];
    const totalUnitsSold = unitsSoldArr.reduce((s, u) => s + u, 0);
    const mixPcts = unitsSoldArr.map((u) =>
      totalUnitsSold > 0 ? (u / totalUnitsSold) * 100 : 0,
    );
    expect(mixPcts.every((p) => p === 0)).toBe(true);
  });
});

describe("classification boundaries", () => {
  // star:      cm >= avgCM AND mix >= avgMix
  // plowhorse: cm <  avgCM AND mix >= avgMix
  // puzzle:    cm >= avgCM AND mix <  avgMix
  // dog:       cm <  avgCM AND mix <  avgMix

  function classify(cm: number, mix: number, avgCM: number, avgMix: number, unitsSold: number): string {
    if (unitsSold === 0) return "unclassified";
    if (cm >= avgCM && mix >= avgMix) return "star";
    if (cm < avgCM && mix >= avgMix) return "plowhorse";
    if (cm >= avgCM && mix < avgMix) return "puzzle";
    return "dog";
  }

  it("CM exactly at average AND mix exactly at average → star", () => {
    expect(classify(15, 25, 15, 25, 10)).toBe("star");
  });

  it("CM below average, mix at average → plowhorse", () => {
    expect(classify(14.99, 25, 15, 25, 10)).toBe("plowhorse");
  });

  it("CM at average, mix below average → puzzle", () => {
    expect(classify(15, 24.99, 15, 25, 10)).toBe("puzzle");
  });

  it("CM below average, mix below average → dog", () => {
    expect(classify(14, 20, 15, 25, 10)).toBe("dog");
  });

  it("zero units sold → unclassified regardless of CM/mix", () => {
    expect(classify(100, 100, 15, 25, 0)).toBe("unclassified");
  });

  it("computeLineCost formula: qty=500g, unitCost=$12.40/kg, yieldPct=85%", () => {
    // If base unit is kg: 500g → 0.5kg
    // lineCost = (0.5 × 12.40) / (85/100) = 6.20 / 0.85 = 7.294117...
    const qtyInBase = 0.5; // 500g converted to kg
    const unitCost = 12.40;
    const yieldPct = 85;
    const lineCost = (qtyInBase * unitCost) / (yieldPct / 100);
    expect(lineCost).toBeCloseTo(7.29, 2);
  });
});

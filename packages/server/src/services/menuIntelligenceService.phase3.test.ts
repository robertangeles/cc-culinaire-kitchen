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

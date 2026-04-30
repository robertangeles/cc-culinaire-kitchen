import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 4a — focused error/empty-state tests for yieldVarianceService.
 * Real DB happy path is exercised by the Playwright variance-pill check.
 */

const mockSelectRows: Array<unknown[]> = [];
let selectCallIdx = 0;
const mockExecuteRows: unknown[] = [];

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => {
          const rows = mockSelectRows[selectCallIdx] ?? [];
          if (selectCallIdx < mockSelectRows.length - 1) selectCallIdx++;
          return rows;
        }),
      })),
    })),
    execute: vi.fn(async () => mockExecuteRows),
  },
}));

vi.mock("../db/schema.js", () => ({
  menuItem: {
    menuItemId: "menu_item_id",
    unitsSold: "units_sold",
    periodStart: "period_start",
    periodEnd: "period_end",
    userId: "user_id",
  },
  menuItemIngredient: {
    menuItemId: "menu_item_id",
    quantity: "quantity",
    unitCost: "unit_cost",
    yieldPct: "yield_pct",
  },
  ingredient: {},
  consumptionLog: {},
}));

beforeEach(() => {
  mockSelectRows.length = 0;
  selectCallIdx = 0;
  mockExecuteRows.length = 0;
  vi.clearAllMocks();
});

function setRows(...rowsByCall: unknown[][]) {
  mockSelectRows.push(...rowsByCall);
  selectCallIdx = 0;
}

describe("getYieldVariance — error + empty states", () => {
  it("throws when the menu item does not exist", async () => {
    setRows([]); // menu_item lookup returns no row
    const { getYieldVariance } = await import("./yieldVarianceService.js");
    await expect(getYieldVariance("missing-uuid")).rejects.toThrow(/not found/i);
  });

  it("returns no-period when periodStart/periodEnd are unset", async () => {
    setRows([{
      menuItemId: "m1",
      unitsSold: 10,
      periodStart: null,
      periodEnd: null,
    }]);
    const { getYieldVariance } = await import("./yieldVarianceService.js");
    const result = await getYieldVariance("m1");
    expect(result.status).toBe("no-period");
    expect(result.theoretical).toBe(0);
    expect(result.actual).toBe(0);
    expect(result.threshold).toBeNull();
  });

  it("returns no-recipe when the dish has no ingredients", async () => {
    setRows(
      [{
        menuItemId: "m1",
        unitsSold: 10,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      }],
      [], // recipe rows empty
    );
    const { getYieldVariance } = await import("./yieldVarianceService.js");
    const result = await getYieldVariance("m1");
    expect(result.status).toBe("no-recipe");
  });

  it("returns thin-data and preserves theoretical when the period has zero logs", async () => {
    setRows(
      [{
        menuItemId: "m1",
        unitsSold: 10,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      }],
      [{ quantity: "0.5", unitCost: "10.00", yieldPct: "100" }], // recipe row
    );
    mockExecuteRows.push({ actual_cost: "0", log_count: 0 });
    const { getYieldVariance } = await import("./yieldVarianceService.js");
    const result = await getYieldVariance("m1");
    expect(result.status).toBe("thin-data");
    // theoretical = 10 units × (0.5 × 10 / 1.0) = 50
    expect(result.theoretical).toBe(50);
    expect(result.actual).toBe(0);
  });
});

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
    servings: "servings",
    periodStart: "period_start",
    periodEnd: "period_end",
    userId: "user_id",
  },
  menuItemIngredient: {
    menuItemId: "menu_item_id",
    lineCost: "line_cost",
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
      servings: 1,
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
        servings: 1,
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
        servings: 1,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      }],
      [{ lineCost: "5.00" }], // recipe row — lineCost already unit-converted
    );
    mockExecuteRows.push({ actual_cost: "0", log_count: 0 });
    const { getYieldVariance } = await import("./yieldVarianceService.js");
    const result = await getYieldVariance("m1");
    expect(result.status).toBe("thin-data");
    // theoretical = (5.00 / 1 serving) × 10 units = 50
    expect(result.theoretical).toBe(50);
    expect(result.actual).toBe(0);
  });
});

// ── Formula tests ───────────────────────────────────────────────────

describe("getYieldVariance — forward reconciliation", () => {
  it("theoretical = SUM(lineCost) / servings × unitsSold", async () => {
    // 3 ingredient rows: lineCosts 12.40, 3.50, 8.10 → total 24.00
    // servings=2, unitsSold=50 → theoretical = (24.00/2) × 50 = 600
    setRows(
      [{
        menuItemId: "m1",
        unitsSold: 50,
        servings: 2,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      }],
      [
        { lineCost: "12.40" },
        { lineCost: "3.50" },
        { lineCost: "8.10" },
      ],
    );
    mockExecuteRows.push({ actual_cost: "610.00", log_count: 5 });
    const { getYieldVariance } = await import("./yieldVarianceService.js");
    const result = await getYieldVariance("m1");
    expect(result.status).toBe("ok");
    expect(result.theoretical).toBe(600);
    expect(result.unitsSold).toBe(50);
  });

  it("uses servings=1 when servings is 0 (guard against division by zero)", async () => {
    setRows(
      [{
        menuItemId: "m1",
        unitsSold: 10,
        servings: 0,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      }],
      [{ lineCost: "20.00" }],
    );
    mockExecuteRows.push({ actual_cost: "200.00", log_count: 2 });
    const { getYieldVariance } = await import("./yieldVarianceService.js");
    const result = await getYieldVariance("m1");
    // Number(0) || 1 → 1, so theoretical = (20/1) × 10 = 200
    expect(result.theoretical).toBe(200);
  });
});

describe("getYieldVariance — backward reconciliation", () => {
  it("perUnitRecipeCost = theoretical / unitsSold", async () => {
    // lineCost total = 15.00, servings=1, unitsSold=30
    // theoretical = (15/1)×30 = 450 → per-unit = 450/30 = 15
    setRows(
      [{
        menuItemId: "m1",
        unitsSold: 30,
        servings: 1,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      }],
      [{ lineCost: "15.00" }],
    );
    mockExecuteRows.push({ actual_cost: "460.00", log_count: 10 });
    const { getYieldVariance } = await import("./yieldVarianceService.js");
    const result = await getYieldVariance("m1");
    // Derived per-unit cost = theoretical / unitsSold = 450 / 30 = 15
    expect(result.theoretical / result.unitsSold).toBeCloseTo(15, 2);
  });
});

describe("getYieldVariance — variance calculation", () => {
  it("variance = actual - theoretical with known values", async () => {
    // lineCost=10.00, servings=1, unitsSold=20 → theoretical=200
    // actual=230 → variance=30
    setRows(
      [{
        menuItemId: "m1",
        unitsSold: 20,
        servings: 1,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      }],
      [{ lineCost: "10.00" }],
    );
    mockExecuteRows.push({ actual_cost: "230.00", log_count: 5 });
    const { getYieldVariance } = await import("./yieldVarianceService.js");
    const result = await getYieldVariance("m1");
    expect(result.variance).toBe(30);
    expect(result.actual).toBe(230);
    expect(result.theoretical).toBe(200);
  });

  it("negative variance (underuse) is reported correctly", async () => {
    setRows(
      [{
        menuItemId: "m1",
        unitsSold: 10,
        servings: 1,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      }],
      [{ lineCost: "20.00" }],
    );
    // actual=180, theoretical=200 → variance=-20
    mockExecuteRows.push({ actual_cost: "180.00", log_count: 3 });
    const { getYieldVariance } = await import("./yieldVarianceService.js");
    const result = await getYieldVariance("m1");
    expect(result.variance).toBe(-20);
  });
});

describe("getYieldVariance — variance percentage", () => {
  it("variancePct = (variance / theoretical) × 100", async () => {
    // theoretical=200, actual=210 → variance=10, pct=5%
    setRows(
      [{
        menuItemId: "m1",
        unitsSold: 20,
        servings: 1,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      }],
      [{ lineCost: "10.00" }],
    );
    mockExecuteRows.push({ actual_cost: "210.00", log_count: 5 });
    const { getYieldVariance } = await import("./yieldVarianceService.js");
    const result = await getYieldVariance("m1");
    expect(result.variancePct).toBe(5);
  });
});

describe("getYieldVariance — threshold boundaries", () => {
  // Helper: given a target variancePct, compute what actual_cost should be
  // for theoretical=100 (lineCost=10, servings=1, unitsSold=10)
  function setupThresholdTest(targetPct: number) {
    setRows(
      [{
        menuItemId: "m1",
        unitsSold: 10,
        servings: 1,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      }],
      [{ lineCost: "10.00" }],
    );
    // theoretical = 100, actual = 100 + (pct/100 * 100) = 100 + pct
    const actual = 100 + targetPct;
    mockExecuteRows.push({ actual_cost: actual.toString(), log_count: 5 });
  }

  it("exactly 3% → good", async () => {
    setupThresholdTest(3);
    const { getYieldVariance } = await import("./yieldVarianceService.js");
    const result = await getYieldVariance("m1");
    expect(result.threshold).toBe("good");
    expect(result.variancePct).toBe(3);
  });

  it("exactly 3.01% → warning", async () => {
    setupThresholdTest(3.01);
    const { getYieldVariance } = await import("./yieldVarianceService.js");
    const result = await getYieldVariance("m1");
    expect(result.threshold).toBe("warning");
  });

  it("exactly 8% → warning", async () => {
    setupThresholdTest(8);
    const { getYieldVariance } = await import("./yieldVarianceService.js");
    const result = await getYieldVariance("m1");
    expect(result.threshold).toBe("warning");
  });

  it("exactly 8.01% → alert", async () => {
    setupThresholdTest(8.01);
    const { getYieldVariance } = await import("./yieldVarianceService.js");
    const result = await getYieldVariance("m1");
    expect(result.threshold).toBe("alert");
  });

  it("negative variance (underuse) at -5% → good (absolute ≤ 3% check uses abs)", async () => {
    setupThresholdTest(-5);
    const { getYieldVariance } = await import("./yieldVarianceService.js");
    const result = await getYieldVariance("m1");
    // abs(-5) = 5, so this is "warning" (3 < 5 ≤ 8)
    expect(result.threshold).toBe("warning");
    expect(result.variancePct).toBe(-5);
  });
});

describe("getYieldVariance — zero theoretical", () => {
  it("variancePct is 0 when theoretical is 0 (not NaN/Infinity)", async () => {
    // All lineCosts are 0 → theoretical = 0
    setRows(
      [{
        menuItemId: "m1",
        unitsSold: 10,
        servings: 1,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      }],
      [{ lineCost: "0.00" }],
    );
    mockExecuteRows.push({ actual_cost: "50.00", log_count: 3 });
    const { getYieldVariance } = await import("./yieldVarianceService.js");
    const result = await getYieldVariance("m1");
    expect(result.variancePct).toBe(0);
    expect(Number.isFinite(result.variancePct)).toBe(true);
  });

  it("null lineCost treated as 0", async () => {
    setRows(
      [{
        menuItemId: "m1",
        unitsSold: 5,
        servings: 1,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      }],
      [{ lineCost: null }],
    );
    mockExecuteRows.push({ actual_cost: "10.00", log_count: 2 });
    const { getYieldVariance } = await import("./yieldVarianceService.js");
    const result = await getYieldVariance("m1");
    expect(result.theoretical).toBe(0);
    expect(result.variancePct).toBe(0);
  });
});

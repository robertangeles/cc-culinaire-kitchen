/**
 * @module utils/formulaParity.test
 *
 * Client-server formula parity tests.
 *
 * Verifies that the same inputs produce the same outputs between:
 *   - Client: MenuItemFormModal.tsx calcLineCost  (Math.round pattern)
 *   - Server: menuIntelligenceService.ts computeLineCost (.toFixed pattern)
 *   - Client: PurchaseOrderForm.tsx line total  (inline Number * Number)
 *   - Server: poMath.ts sumPOLineTotal / estimatedLineCost
 *
 * Since both client and server formulas are inlined in component/service
 * files and not independently importable, we replicate the exact logic here
 * and test for parity. The replicated formulas are annotated with their
 * source location.
 */

import { describe, it, expect } from "vitest";
import { convertToBaseUnit, normalizeUnit, type BaseUnit } from "./units.js";

// ---------------------------------------------------------------------------
// Replicated formulas — kept in sync with source files
// ---------------------------------------------------------------------------

/**
 * Client formula: MenuItemFormModal.tsx lines 123-142
 *
 *   const raw = (qtyInBase * cost) / (yld / 100);
 *   return Math.round(raw * 100) / 100;
 */
function clientCalcLineCost(
  qty: number,
  unit: string,
  cost: number,
  yieldPct: number,
  baseUnit: string | null,
): number {
  if (yieldPct === 0) return 0;
  let qtyInBase = qty;
  if (baseUnit && unit !== baseUnit) {
    const from = normalizeUnit(unit);
    const to = normalizeUnit(baseUnit);
    if (from && to) {
      try {
        qtyInBase = convertToBaseUnit(qty, from as BaseUnit, to as BaseUnit);
      } catch {
        return 0;
      }
    }
  }
  const raw = (qtyInBase * cost) / (yieldPct / 100);
  return Math.round(raw * 100) / 100;
}

/**
 * Server formula: menuIntelligenceService.ts lines 156-192
 *
 *   return ((qtyInBase * cost) / (yld / 100)).toFixed(2);
 *
 * Returns a string (like the real server), but we Number() it for comparison.
 */
function serverComputeLineCost(
  qty: number,
  unit: string,
  cost: number,
  yieldPct: number,
  baseUnit: string | null,
): number {
  if (!Number.isFinite(qty) || !Number.isFinite(cost) || !Number.isFinite(yieldPct) || yieldPct === 0) {
    return 0;
  }
  let qtyInBase = qty;
  if (baseUnit && unit !== baseUnit) {
    const from = normalizeUnit(unit);
    const to = normalizeUnit(baseUnit);
    if (from && to) {
      try {
        qtyInBase = convertToBaseUnit(qty, from as BaseUnit, to as BaseUnit);
      } catch {
        return 0;
      }
    }
  }
  return Number(((qtyInBase * cost) / (yieldPct / 100)).toFixed(2));
}

/**
 * Client PO line total: PurchaseOrderForm.tsx line 454
 *
 *   ((Number(line.orderedQty) || 0) * (Number(line.unitCost) || 0)).toFixed(2)
 *
 * This is display-only — the .toFixed(2) is on the rendered string.
 * The accumulated total (line 189-195) does NOT round per-line.
 */
// Kept as the documented reference for the client's per-line display formula:
// the PO Total tests below exist precisely because this rounding does NOT feed
// the accumulated total.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function clientPOLineTotal(orderedQty: string, unitCost: string): number {
  return (Number(orderedQty) || 0) * (Number(unitCost) || 0);
}

/**
 * Client PO total: PurchaseOrderForm.tsx lines 189-195
 *
 *   lines.reduce((sum, l) => sum + qty * cost, 0)
 *
 * No per-line rounding — raw float accumulation, .toFixed(2) on display.
 */
function clientPOTotal(lines: { orderedQty: string; unitCost: string }[]): number {
  return lines.reduce((sum, l) => {
    const qty = Number(l.orderedQty) || 0;
    const cost = Number(l.unitCost) || 0;
    return sum + qty * cost;
  }, 0);
}

/**
 * Server PO total: poMath.ts sumPOLineTotal
 *
 *   Accumulates raw then Math.round(total * 100) / 100
 */
function serverPOTotal(lines: { orderedQty: number; unitCost: number }[]): number {
  let total = 0;
  for (const line of lines) {
    const qty = Number.isFinite(line.orderedQty) ? line.orderedQty : 0;
    const cost = Number.isFinite(line.unitCost) ? line.unitCost : 0;
    total += qty * cost;
  }
  return Math.round(total * 100) / 100;
}

// ---------------------------------------------------------------------------
// Menu Item Line Cost Parity
// ---------------------------------------------------------------------------

describe("Client-Server Formula Parity: Line Cost", () => {
  const testCases = [
    { qty: 0.5, unit: "kg", cost: 12.40, yieldPct: 85, baseUnit: "kg", desc: "standard ingredient, same unit, yield loss" },
    { qty: 1, unit: "kg", cost: 25.50, yieldPct: 100, baseUnit: "kg", desc: "no yield loss" },
    { qty: 0.005, unit: "kg", cost: 100, yieldPct: 100, baseUnit: "kg", desc: "precision boundary — small qty" },
    { qty: 100, unit: "ml", cost: 8.75, yieldPct: 90, baseUnit: "ml", desc: "volume unit with yield" },
    { qty: 500, unit: "g", cost: 12.40, yieldPct: 85, baseUnit: "kg", desc: "cross-unit conversion g→kg" },
    { qty: 2, unit: "tbsp", cost: 0.50, yieldPct: 100, baseUnit: "ml", desc: "volume conversion tbsp→ml" },
    { qty: 12, unit: "each", cost: 0.35, yieldPct: 100, baseUnit: "each", desc: "count unit" },
    { qty: 1, unit: "dozen", cost: 6.00, yieldPct: 100, baseUnit: "each", desc: "dozen→each conversion" },
    { qty: 250, unit: "g", cost: 45.00, yieldPct: 70, baseUnit: "kg", desc: "high-value, low yield" },
    { qty: 0, unit: "g", cost: 10.00, yieldPct: 100, baseUnit: "g", desc: "zero qty" },
    { qty: 10, unit: "g", cost: 0, yieldPct: 100, baseUnit: "g", desc: "zero cost" },
  ];

  for (const tc of testCases) {
    it(`should agree on line cost for: ${tc.desc}`, () => {
      const client = clientCalcLineCost(tc.qty, tc.unit, tc.cost, tc.yieldPct, tc.baseUnit);
      const server = serverComputeLineCost(tc.qty, tc.unit, tc.cost, tc.yieldPct, tc.baseUnit);
      expect(client).toBe(server);
    });
  }

  it("should agree when no baseUnit (free-text ingredient, no conversion)", () => {
    const client = clientCalcLineCost(2, "kg", 15.99, 100, null);
    const server = serverComputeLineCost(2, "kg", 15.99, 100, null);
    expect(client).toBe(server);
  });

  it("should both return 0 for zero yield", () => {
    const client = clientCalcLineCost(10, "g", 5.00, 0, "g");
    const server = serverComputeLineCost(10, "g", 5.00, 0, "g");
    expect(client).toBe(0);
    expect(server).toBe(0);
  });

  it("should both return 0 for incompatible units (kg→ml)", () => {
    const client = clientCalcLineCost(1, "kg", 10, 100, "ml");
    const server = serverComputeLineCost(1, "kg", 10, 100, "ml");
    expect(client).toBe(0);
    expect(server).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PO Total Parity
// ---------------------------------------------------------------------------

describe("Client-Server Formula Parity: PO Total", () => {
  it("DIVERGES for a standard multi-line PO: client .toFixed vs server Math.round", () => {
    const lines = [
      { orderedQty: "12", unitCost: "4.75" },
      { orderedQty: "3.5", unitCost: "18.99" },
      { orderedQty: "24", unitCost: "2.30" },
    ];
    const clientTotal = clientPOTotal(lines);
    const serverTotal = serverPOTotal(lines.map(l => ({
      orderedQty: Number(l.orderedQty),
      unitCost: Number(l.unitCost),
    })));
    // CONFIRMED DIVERGENCE (LATENT BUG):
    // Raw sum = 178.665
    // Client display: (178.665).toFixed(2) = "178.66" (toFixed sees .665 as .6649...)
    // Server: Math.round(178.665 * 100) / 100 = Math.round(17866.5) = 17867 → 178.67
    // The client shows $178.66, the server stores $178.67 — $0.01 drift.
    expect(Number(clientTotal.toFixed(2))).toBe(178.66);
    expect(serverTotal).toBe(178.67);
    expect(Number(clientTotal.toFixed(2))).not.toBe(serverTotal);
  });

  it("should agree for single-line PO", () => {
    const lines = [{ orderedQty: "7", unitCost: "12.345" }];
    const clientTotal = clientPOTotal(lines);
    const serverTotal = serverPOTotal([{ orderedQty: 7, unitCost: 12.345 }]);
    expect(Number(clientTotal.toFixed(2))).toBe(serverTotal);
  });

  it("should agree for empty PO", () => {
    const clientTotal = clientPOTotal([]);
    const serverTotal = serverPOTotal([]);
    expect(clientTotal).toBe(0);
    expect(serverTotal).toBe(0);
  });

  it("documents that client raw total differs from server rounded total for 10 small lines", () => {
    const lines = Array.from({ length: 10 }, () => ({
      orderedQty: "0.1",
      unitCost: "0.1",
    }));
    const clientRaw = clientPOTotal(lines);
    const serverRounded = serverPOTotal(lines.map(l => ({
      orderedQty: Number(l.orderedQty),
      unitCost: Number(l.unitCost),
    })));
    // Client raw: 10 × 0.01 = 0.09999999999999999 (float drift)
    // Server: Math.round(0.09999... * 100) / 100 = Math.round(9.9999...) / 100 = 10/100 = 0.1
    // Display parity: client .toFixed(2) = "0.10", server = 0.1
    expect(Number(clientRaw.toFixed(2))).toBe(serverRounded);
  });

  it("PO per-line display vs server estimatedLineCost (toFixed pattern)", () => {
    // Client line total display: ((qty * cost)).toFixed(2) — just display formatting
    // Server estimatedLineCost: Number((qty * cost).toFixed(2))
    const qty = 7.5;
    const cost = 3.33;
    const clientDisplay = Number((qty * cost).toFixed(2));
    // Replicate server estimatedLineCost
    const serverLine = Number((qty * cost).toFixed(2));
    // Both use the same pattern here — display-only parity
    expect(clientDisplay).toBe(serverLine);
  });
});

// ---------------------------------------------------------------------------
// Aggregation Parity: recalculateItemCosts pattern
// ---------------------------------------------------------------------------

describe("Client-Server Formula Parity: Cost Aggregation", () => {
  /**
   * Client: MenuItemFormModal.tsx line 386
   *   ingredients.reduce((sum, row) => sum + calcLineCost(row), 0)
   *   Then: perServing = totalBatchCost / servings
   *   Then: foodCostWithQ = perServing * (1 + qPct / 100)
   *
   * Server: menuIntelligenceService.ts line 393
   *   ingredients.reduce((sum, ing) => sum + parseFloat(ing.lineCost ?? "0"), 0)
   *   Then: perServing = total / servings
   *   Then: foodCost = perServing * (1 + qFactor / 100)
   */
  it("total batch cost aggregation agrees when line costs are 2dp-clean", () => {
    const lineCosts = [1.23, 4.56, 0.99, 12.34, 7.89];

    // Client: sums the numbers directly
    const clientTotal = lineCosts.reduce((s, c) => s + c, 0);

    // Server: sums parseFloat of .toFixed(2) strings
    const serverTotal = lineCosts
      .map(c => c.toFixed(2))
      .reduce((s, v) => s + parseFloat(v), 0);

    expect(Number(clientTotal.toFixed(2))).toBe(Number(serverTotal.toFixed(2)));
  });

  it("food cost with Q-factor agrees", () => {
    const totalIngredientCost = 27.01; // sum of line costs
    const servings = 4;
    const qFactorPct = 5;
    const sellingPrice = 28.50;

    // Client formula (MenuItemFormModal.tsx)
    const clientPerServing = totalIngredientCost / servings;
    const clientFoodCost = clientPerServing * (1 + qFactorPct / 100);
    const clientFoodCostPct = (clientFoodCost / sellingPrice) * 100;
    const clientCM = sellingPrice - clientFoodCost;

    // Server formula (menuIntelligenceService.ts)
    const serverPerServing = totalIngredientCost / servings;
    const serverFoodCost = qFactorPct > 0 ? serverPerServing * (1 + qFactorPct / 100) : serverPerServing;
    const serverFoodCostPct = sellingPrice > 0 ? (serverFoodCost / sellingPrice) * 100 : 0;
    const serverCM = sellingPrice - serverFoodCost;

    // Both use the same arithmetic — parity expected
    expect(clientFoodCost).toBe(serverFoodCost);
    expect(clientFoodCostPct).toBe(serverFoodCostPct);
    expect(clientCM).toBe(serverCM);

    // Document the server's stored precision after .toFixed(2)
    expect(Number(serverFoodCost.toFixed(2))).toBe(7.09);
    expect(Number(serverFoodCostPct.toFixed(2))).toBe(24.88);
    expect(Number(serverCM.toFixed(2))).toBe(21.41);
  });

  it("documents drift when line costs come from different rounding paths", () => {
    // Simulate: client calculates line costs with Math.round,
    // server calculates with .toFixed, then both aggregate.
    const inputs = [
      { qty: 0.5, cost: 12.40, yld: 85 },
      { qty: 100, cost: 0.0875, yld: 90 },
      { qty: 2, cost: 14.7868, yld: 100 }, // tbsp→ml scenario cost
      { qty: 12, cost: 0.35, yld: 100 },
      { qty: 0.25, cost: 45.00, yld: 70 },
    ];

    let clientTotal = 0;
    let serverTotal = 0;
    for (const inp of inputs) {
      const raw = (inp.qty * inp.cost) / (inp.yld / 100);
      const clientLine = Math.round(raw * 100) / 100;
      const serverLine = Number(raw.toFixed(2));
      clientTotal += clientLine;
      serverTotal += serverLine;
    }

    // Both should agree at 2dp after final rounding
    expect(Number(clientTotal.toFixed(2))).toBe(Number(serverTotal.toFixed(2)));
  });
});

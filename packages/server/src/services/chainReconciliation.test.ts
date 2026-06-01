import { describe, it, expect } from "vitest";
import {
  suggestedOrderQty,
  estimatedLineCost,
  sumPOLineTotal,
} from "./poMath.js";
import { varianceQty, variancePct } from "./stockMath.js";
import {
  dailyUsageRate,
  daysUntilDepletion,
  suggestedReorderQty,
  forecastConfidence,
} from "./forecastMath.js";
import {
  scaledLineQuantity,
  computeSuggestedSelections,
  attachRateFor,
  DEFAULT_PREP_BUFFER,
  attachOnHand,
  aggregatePrepLines,
  type PrepSourceLine,
  type AggregatedPrepLine,
} from "./prepMath.js";
import { convertToBaseUnit, convertUnit } from "@culinaire/shared";

// =============================================================================
// Chain 1: Forecast → Auto-PO → Stock Balance
// =============================================================================

describe("Chain 1: Forecast → Auto-PO → Stock Balance", () => {
  it("should maintain stock balance through the full cycle", () => {
    // Given: starting stock and consumption data
    const startStock = 100; // kg
    const totalConsumed = 30; // kg over 30 days
    const parLevel = 80;
    const preferredCost = 12.5; // $/kg

    // Step 1: Forecast — compute daily usage rate and days until depletion
    const rate = dailyUsageRate(totalConsumed, 30);
    expect(rate).toBe(1); // 30 / 30 = 1 kg/day

    const daysLeft = daysUntilDepletion(startStock, rate);
    expect(daysLeft).toBe(100); // floor(100 / 1) = 100

    // Step 2: Auto-PO suggestion
    const currentQty = startStock - totalConsumed; // 70 kg remaining
    const suggested = suggestedOrderQty(parLevel, currentQty, null);
    expect(suggested).toBe(10); // shortfall = 80 - 70 = 10

    // Step 3: PO line cost
    const lineCost = estimatedLineCost(suggested, preferredCost);
    expect(lineCost).toBe(125); // 10 × 12.50

    // Step 4: After receiving, stock should balance
    const stockAfterReceiving = currentQty + suggested;
    expect(stockAfterReceiving).toBe(parLevel); // exactly at par

    // Chain invariant: receiving suggested qty always reaches par
    expect(stockAfterReceiving).toBeGreaterThanOrEqual(parLevel);
  });

  it("should prefer reorderQty when it exceeds shortfall", () => {
    const parLevel = 80;
    const currentQty = 70; // shortfall = 10
    const reorderQty = 25; // supplier minimum case size

    // suggestedOrderQty returns max(shortfall, reorderQty)
    const suggested = suggestedOrderQty(parLevel, currentQty, reorderQty);
    expect(suggested).toBe(25); // reorder > shortfall

    const preferredCost = 8.0;
    const lineCost = estimatedLineCost(suggested, preferredCost);
    expect(lineCost).toBe(200); // 25 × 8

    // After receiving with reorderQty, stock exceeds par
    const stockAfterReceiving = currentQty + suggested;
    expect(stockAfterReceiving).toBe(95); // 70 + 25
    expect(stockAfterReceiving).toBeGreaterThanOrEqual(parLevel);
  });

  it("should produce zero order when stock is at or above par", () => {
    const rate = dailyUsageRate(5, 30); // very low consumption
    expect(rate).toBeCloseTo(0.1667, 3);

    const daysLeft = daysUntilDepletion(100, rate);
    expect(daysLeft).toBe(600); // floor(100 / (5/30)) = floor(600) = 600

    // Stock is above par — no order needed
    const suggested = suggestedOrderQty(80, 100, null);
    expect(suggested).toBe(0);

    const lineCost = estimatedLineCost(suggested, 12.5);
    expect(lineCost).toBe(0);
  });

  it("should handle zero consumption (no forecast data)", () => {
    const rate = dailyUsageRate(0, 30);
    expect(rate).toBe(0);

    // daysUntilDepletion returns 0 when rate is 0 (no forecast possible)
    const daysLeft = daysUntilDepletion(50, rate);
    expect(daysLeft).toBe(0);

    // PO chain still works — shortfall is independent of forecast
    const suggested = suggestedOrderQty(80, 50, null);
    expect(suggested).toBe(30);

    const lineCost = estimatedLineCost(suggested, 4.0);
    expect(lineCost).toBe(120);

    const stockAfter = 50 + suggested;
    expect(stockAfter).toBe(80);
  });

  it("should accumulate small daily rates into correct PO line total", () => {
    // Precision test: small rate over many days
    const rate = dailyUsageRate(7, 30); // 0.2333... kg/day
    expect(rate).toBeCloseTo(0.2333, 3);

    // After 90 days at this rate, how much consumed?
    const consumed90 = rate * 90; // ~21 kg
    const startStock = 50;
    const remaining = startStock - consumed90; // ~29 kg

    const suggested = suggestedOrderQty(40, remaining, null);
    // shortfall = 40 - 29 = 11
    expect(suggested).toBeGreaterThan(0);

    // Build a multi-line PO and verify sumPOLineTotal
    const lines = [
      { orderedQty: suggested, unitCost: 6.75 },
      { orderedQty: 5, unitCost: 3.2 },
    ];
    const poTotal = sumPOLineTotal(lines);
    const expectedTotal =
      Math.round((suggested * 6.75 + 5 * 3.2) * 100) / 100;
    expect(poTotal).toBe(expectedTotal);
  });
});

// =============================================================================
// Chain 2: Stock Take → Forecast Recalculation
// =============================================================================

describe("Chain 2: Stock Take → Forecast Recalculation", () => {
  it("should update forecast after stock take adjustment (shrinkage)", () => {
    const expected = 50; // kg — system thinks we have
    const counted = 42; // kg — physical count

    // Step 1: Stock take variance
    const varQty = varianceQty(counted, expected);
    expect(varQty).toBe(-8); // short 8 kg

    const varPct = variancePct(varQty, expected);
    expect(varPct).toBe(-16); // -16%

    // Step 2: New stock level = counted qty (truth from the floor)
    const newStock = counted;

    // Step 3: Forecast with corrected stock
    const rate = dailyUsageRate(30, 30); // 1 kg/day
    const daysLeft = daysUntilDepletion(newStock, rate);
    expect(daysLeft).toBe(42); // floor(42 / 1)

    // Chain invariant: stock take sets stock to counted value
    expect(newStock).toBe(counted);

    // Verify the forecast confidence based on data window
    const confidence = forecastConfidence(30, 30);
    expect(confidence).toBe(1); // full 30-day window
  });

  it("should handle surplus found during stock take", () => {
    const expected = 30;
    const counted = 38; // surplus

    const varQty = varianceQty(counted, expected);
    expect(varQty).toBe(8); // +8 surplus

    const varPct = variancePct(varQty, expected);
    expect(varPct).toBeCloseTo(26.67, 1); // (8/30)*100

    // With more stock than expected, days until depletion increases
    const rate = dailyUsageRate(15, 30); // 0.5 kg/day
    const daysBeforeStockTake = daysUntilDepletion(expected, rate);
    const daysAfterStockTake = daysUntilDepletion(counted, rate);

    expect(daysAfterStockTake).toBeGreaterThan(daysBeforeStockTake);
    expect(daysBeforeStockTake).toBe(60); // floor(30 / 0.5)
    expect(daysAfterStockTake).toBe(76); // floor(38 / 0.5)
  });

  it("should chain stock take → reorder suggestion with corrected stock", () => {
    const expected = 50;
    const counted = 20; // big shortage

    const varQty = varianceQty(counted, expected);
    expect(varQty).toBe(-30);

    // After stock take, forecast with corrected stock
    const rate = dailyUsageRate(10, 30); // 0.333 kg/day
    const reorderQty = suggestedReorderQty(rate, 14); // 2 weeks buffer
    expect(reorderQty).toBe(Math.ceil(rate * 14)); // ceil(4.667) = 5

    // PO suggestion based on corrected stock
    const parLevel = 40;
    const suggested = suggestedOrderQty(parLevel, counted, reorderQty);
    // shortfall = 40 - 20 = 20, reorderQty = 5 → max(20, 5) = 20
    expect(suggested).toBe(20);

    const stockAfter = counted + suggested;
    expect(stockAfter).toBeGreaterThanOrEqual(parLevel);
  });

  it("should handle zero expected quantity (new ingredient first count)", () => {
    const expected = 0;
    const counted = 15;

    const varQty = varianceQty(counted, expected);
    expect(varQty).toBe(15);

    // variancePct returns null when expected is 0
    const varPct = variancePct(varQty, expected);
    expect(varPct).toBeNull();

    // Forecast still works with counted value
    const rate = dailyUsageRate(0, 1); // no consumption history
    const daysLeft = daysUntilDepletion(counted, rate);
    expect(daysLeft).toBe(0); // no forecast possible (rate = 0)

    // Low confidence with no data
    const confidence = forecastConfidence(0, 30);
    expect(confidence).toBe(0);
  });
});

// =============================================================================
// Chain 3: Prep Planning End-to-End
// =============================================================================

describe("Chain 3: Prep Planning End-to-End", () => {
  it("should chain covers → portions → scaling → prep needed", () => {
    const covers = 100;
    const buffer = DEFAULT_PREP_BUFFER; // 1.25

    // Step 1: Attach rate for dessert category
    const attachRate = attachRateFor("Dessert");
    expect(attachRate).toBe(0.4);

    // Step 2: Suggested portions via computeSuggestedSelections (single item, 100% mix)
    const items = [
      { menuItemId: "item-1", category: "Dessert", unitsSold: 0 },
    ];
    const selections = computeSuggestedSelections(covers, items, { buffer });
    expect(selections).toHaveLength(1);
    // 100 × 0.4 × (1/1) × 1.25 = 50
    expect(selections[0].suggestedPortions).toBe(50);
    expect(selections[0].basis).toBe("estimated"); // unitsSold = 0

    // Step 3: Scale an ingredient line
    const recipeQty = 500; // grams per 4 servings
    const servings = 4;
    const yieldPct = 85;
    const scaled = scaledLineQuantity(
      recipeQty,
      selections[0].suggestedPortions,
      servings,
      yieldPct,
    );
    // 500 × (50 / 4) / (85 / 100) = 500 × 12.5 / 0.85 = 7352.941176...
    expect(scaled).toBeCloseTo(7352.941, 2);

    // Step 4: Prep needed = scaled - on hand
    const onHand = 2000; // grams available
    const prepNeeded = Math.max(0, scaled - onHand);
    expect(prepNeeded).toBeCloseTo(5352.941, 2);

    // Chain invariant: prep needed + on hand >= scaled quantity
    expect(prepNeeded + onHand).toBeGreaterThanOrEqual(scaled);
  });

  it("should chain multiple items with historical mix ratios", () => {
    const covers = 80;
    const items = [
      { menuItemId: "a", category: "Main", unitsSold: 60 },
      { menuItemId: "b", category: "Main", unitsSold: 40 },
    ];
    const selections = computeSuggestedSelections(covers, items);
    // attachRate("Main") = 1.0, buffer = 1.25
    // totalSold = 100, mix(a) = 0.6, mix(b) = 0.4
    // a: round(80 × 1.0 × 0.6 × 1.25) = round(60) = 60
    // b: round(80 × 1.0 × 0.4 × 1.25) = round(40) = 40
    expect(selections[0].suggestedPortions).toBe(60);
    expect(selections[0].basis).toBe("historical");
    expect(selections[1].suggestedPortions).toBe(40);

    // Scale each item's ingredient and verify aggregate
    const scaledA = scaledLineQuantity(200, 60, 4, 100);
    // 200 × (60/4) / 1.0 = 3000
    expect(scaledA).toBe(3000);

    const scaledB = scaledLineQuantity(200, 40, 4, 100);
    // 200 × (40/4) / 1.0 = 2000
    expect(scaledB).toBe(2000);

    // If both dishes use the same ingredient, aggregate = sum
    const totalIngredient = scaledA + scaledB;
    expect(totalIngredient).toBe(5000);
  });

  it("should chain through aggregatePrepLines and attachOnHand", () => {
    const covers = 50;
    const items = [
      { menuItemId: "m1", category: "Main", unitsSold: 0 },
    ];
    const selections = computeSuggestedSelections(covers, items);
    // 50 × 1.0 × 1.0 × 1.25 = 62.5 → round = 63
    expect(selections[0].suggestedPortions).toBe(63);

    // Build prep source lines for aggregation
    const sourceLines: PrepSourceLine[] = [
      {
        ingredientId: "ing-1",
        ingredientName: "Chicken Breast",
        unit: "g",
        category: "proteins",
        quantity: 250,
        yieldPct: 90,
        servings: 4,
        expectedPortions: selections[0].suggestedPortions,
        dishName: "Grilled Chicken",
        menuItemId: "m1",
        recipeId: null,
        classificationWeight: 1,
        prepTimeMinutes: 15,
      },
    ];

    const aggregated = aggregatePrepLines(sourceLines);
    expect(aggregated).toHaveLength(1);

    // Verify the aggregated totalQuantity matches scaledLineQuantity
    const manualScaled = scaledLineQuantity(250, 63, 4, 90);
    expect(aggregated[0].totalQuantity).toBeCloseTo(manualScaled, 6);

    // Attach on-hand stock
    const stockMap = new Map<string, { qty: number; baseUnit: string }>();
    stockMap.set("ing-1", { qty: 1000, baseUnit: "g" });

    const withOnHand = attachOnHand(aggregated, stockMap, (qty, from, to) => {
      if (from === to) return qty;
      return convertUnit(qty, from as any, to as any);
    });

    expect(withOnHand[0].onHandQty).toBe(1000);
    expect(withOnHand[0].prepNeeded).toBe(
      Math.round(Math.max(0, manualScaled - 1000) * 1000) / 1000,
    );

    // Chain invariant: prepNeeded + onHand >= totalQuantity
    expect(withOnHand[0].prepNeeded! + withOnHand[0].onHandQty!).toBeGreaterThanOrEqual(
      withOnHand[0].totalQuantity - 0.001, // tolerance for rounding
    );
  });

  it("should produce zero prep when on-hand exceeds demand", () => {
    const scaled = scaledLineQuantity(100, 10, 4, 100); // 250
    expect(scaled).toBe(250);

    const onHand = 500;
    const prepNeeded = Math.max(0, scaled - onHand);
    expect(prepNeeded).toBe(0);
  });
});

// =============================================================================
// Chain 4: Unit Conversion Consistency
// =============================================================================

describe("Chain 4: Unit Conversion Consistency", () => {
  it("should produce identical base quantities through any consumer path", () => {
    const qty = 500;

    // Path A: direct conversion via convertToBaseUnit
    const pathA = convertToBaseUnit(qty, "g", "kg");

    // Path B: same call — deterministic
    const pathB = convertToBaseUnit(qty, "g", "kg");

    expect(pathA).toBe(pathB);
    expect(pathA).toBe(0.5); // 500g = 0.5kg
  });

  it("round-trip conversion preserves value", () => {
    const original = 2.5; // kg
    const converted = convertToBaseUnit(original, "kg", "g"); // → 2500g
    expect(converted).toBe(2500);

    const roundTrip = convertToBaseUnit(converted, "g", "kg"); // → 2.5kg
    expect(roundTrip).toBe(original);
  });

  it("same-unit conversion is identity", () => {
    expect(convertToBaseUnit(42, "g", "g")).toBe(42);
    expect(convertToBaseUnit(0, "kg", "kg")).toBe(0);
    expect(convertToBaseUnit(3.14, "ml", "ml")).toBe(3.14);
  });

  it("volume round-trip preserves value within floating-point tolerance", () => {
    const original = 2; // tbsp
    const inMl = convertUnit(original, "tbsp", "ml");
    const roundTrip = convertUnit(inMl, "ml", "tbsp");
    expect(roundTrip).toBeCloseTo(original, 10);
  });

  it("conversion feeds correctly into estimatedLineCost", () => {
    // Scenario: ingredient priced at $12.40/kg, recipe uses 500g
    const recipeQty = 500; // g
    const baseUnit = "kg";
    const preferredCost = 12.4; // per kg

    // Convert recipe qty to base unit
    const qtyInBase = convertToBaseUnit(recipeQty, "g", baseUnit);
    expect(qtyInBase).toBe(0.5);

    // Line cost via the PO math
    const cost = estimatedLineCost(qtyInBase, preferredCost);
    expect(cost).toBe(6.2); // 0.5 × 12.40

    // Same conversion done differently (unit → reference → target)
    const altQtyInBase = convertUnit(recipeQty, "g", "kg");
    const altCost = estimatedLineCost(altQtyInBase, preferredCost);
    expect(altCost).toBe(cost); // must agree
  });

  it("count family converts dozen to each correctly in cost chain", () => {
    const qty = 2; // dozen eggs
    const inEach = convertToBaseUnit(qty, "dozen", "each");
    expect(inEach).toBe(24);

    const costPerEach = 0.35;
    const totalCost = estimatedLineCost(inEach, costPerEach);
    expect(totalCost).toBe(8.4); // 24 × 0.35
  });
});

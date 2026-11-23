/**
 * @module utils/menuCosting.test
 *
 * Characterisation of the costing that moved here from menuIntelligenceService.ts, the web item editor
 * (IngredientsSection.tsx, MenuItemFormModal.tsx, MenuEngineeringMatrix.tsx, CategorySettings.tsx) and the two
 * prep services. The "legacy" functions below are those expressions copied verbatim from commit aa105e5, the
 * last one before the move; the shared functions must agree with them on every input, and the golden values
 * are what the real service stored for the same menu (menuCosting.integration.test.ts).
 *
 * The last block lists where the web and the server disagree. Each is a needs-decision: both behaviours are
 * kept, so this block must keep passing until someone decides which one wins.
 */

import { describe, it, expect } from "vitest";
import {
  CLASSIFICATION_PREP_WEIGHTS, DEFAULT_CATEGORY_TARGET_PCT, FOOD_COST_ALERT_PCT,
  categoryActualFoodCostPct, classificationPrepWeight, classifyAgainstWholeMenu, editorItemCosts, matrixAverages,
  menuMixPct, plateFoodCost, previewLineCost, rawLineCost, storedItemCosts, storedLineCost, summariseMenuAnalysis,
  type EngineeringRow,
} from "./menuCosting.js";

// ---------------------------------------------------------------------------
// Legacy expressions, as they were
// ---------------------------------------------------------------------------

/** IngredientsSection.tsx calcLineCost, with the kitchen-quantity lookup passed in. */
function legacyCalcLineCost(quantity: string, unitCost: string, yieldPct: string, qtyInBase: (q: number) => number | null): number {
  const qty = parseFloat(quantity) || 0;
  const cost = parseFloat(unitCost) || 0;
  const yld = parseFloat(yieldPct) || 100;
  if (yld === 0) return 0;

  const q = qtyInBase(qty);
  if (q === null) return 0;
  const raw = (q * cost) / (yld / 100);
  return Math.round(raw * 100) / 100;
}

/** menuIntelligenceService.ts computeLineCost, after the unit lookup. */
function legacyComputeLineCost(quantity: string, unitCost: string, yieldPct: string, qtyInBase: (q: number) => number): string {
  const qty = parseFloat(quantity);
  const cost = parseFloat(unitCost);
  const yld = parseFloat(yieldPct);
  if (!Number.isFinite(qty) || !Number.isFinite(cost) || !Number.isFinite(yld) || yld === 0) {
    return "0.00";
  }
  return ((qtyInBase(qty) * cost) / (yld / 100)).toFixed(2);
}

/** MenuItemFormModal.tsx, the block under "Auto-calculated totals". */
function legacyEditor(totalBatchCost: number, servings: number, qFactorPct: string, servingsPerSale: number, sellingPrice: string) {
  const perServingCost = servings > 1 ? totalBatchCost / servings : totalBatchCost;
  const qPct = parseFloat(qFactorPct) || 0;
  const foodCostWithQ = qPct > 0 ? perServingCost * (1 + qPct / 100) : perServingCost;
  const price = parseFloat(sellingPrice) || 0;
  const salePack = Math.max(1, servingsPerSale || 1);
  const foodCostPerSale = foodCostWithQ * salePack;
  const foodCostPct = price > 0 ? (foodCostPerSale / price) * 100 : 0;
  const contributionMargin = price - foodCostPerSale;
  return { perServingCost, foodCostWithQ, salePack, foodCostPerSale, foodCostPct, contributionMargin };
}

/** menuIntelligenceService.ts recalculateItemCosts, up to the update. */
function legacyStored(lineCosts: Array<string | null>, servings: number | null, servingsPerSale: number | null, qFactorPct: string | null, sellingPriceStr: string) {
  const totalIngredientCost = lineCosts.reduce((sum, c) => sum + parseFloat(c ?? "0"), 0);
  const s = servings ?? 1;
  const perServing = s > 1 ? totalIngredientCost / s : totalIngredientCost;
  const qFactor = parseFloat(qFactorPct ?? "0");
  const perServingWithQ = qFactor > 0 ? perServing * (1 + qFactor / 100) : perServing;
  const foodCost = perServingWithQ * (servingsPerSale ?? 1);
  const sellingPrice = parseFloat(sellingPriceStr);
  const foodCostPct = sellingPrice > 0 ? (foodCost / sellingPrice) * 100 : 0;
  const contributionMargin = sellingPrice - foodCost;
  return { foodCost: foodCost.toFixed(2), foodCostPct: foodCostPct.toFixed(2), contributionMargin: contributionMargin.toFixed(2) };
}

/** menuIntelligenceService.ts getPandLFoodCost, after the sum. */
function legacyPandL(total: number, servingsIn: number | null, qFactorPct: string | null): number {
  const servings = servingsIn ?? 1;
  const perServing = servings > 1 ? total / servings : total;
  const qFactor = parseFloat(qFactorPct ?? "0");
  const withQ = qFactor > 0 ? perServing * (1 + qFactor / 100) : perServing;
  return Number(withQ.toFixed(2));
}

/** menuIntelligenceService.ts recalculateMenu, the averages and the if-chain. */
function legacyClassify(rows: EngineeringRow[]): string[] {
  const avgCM = rows.reduce((sum, i) => sum + i.contributionMargin, 0) / rows.length;
  const avgMix = rows.reduce((sum, i) => sum + i.menuMixPct, 0) / rows.length;
  return rows.map((item) => {
    const cm = item.contributionMargin;
    const mix = item.menuMixPct;
    let classification: string;
    if (item.unitsSold === 0) {
      classification = "unclassified";
    } else if (cm >= avgCM && mix >= avgMix) {
      classification = "star";
    } else if (cm < avgCM && mix >= avgMix) {
      classification = "plowhorse";
    } else if (cm >= avgCM && mix < avgMix) {
      classification = "puzzle";
    } else {
      classification = "dog";
    }
    return classification;
  });
}

/** MenuEngineeringMatrix.tsx, the averages and bounds memo. */
function legacyMatrix(classified: EngineeringRow[]) {
  if (classified.length === 0) {
    return { avgCM: 0, avgMix: 0, maxCM: 1, maxMix: 1 };
  }
  const aCM = classified.reduce((s, i) => s + i.contributionMargin, 0) / classified.length;
  const aMix = classified.reduce((s, i) => s + i.menuMixPct, 0) / classified.length;
  const mCM = Math.max(...classified.map((i) => i.contributionMargin)) * 1.2 || 1;
  const mMix = Math.max(...classified.map((i) => i.menuMixPct)) * 1.2 || 1;
  return { avgCM: aCM, avgMix: aMix, maxCM: mCM, maxMix: mMix };
}

type Analysed = { sellingPrice: number; foodCost: number; foodCostPct: number; contributionMargin: number; unitsSold: number; classification: string };

/** menuIntelligenceService.ts getMenuAnalysis, after the numbers are parsed. */
function legacyAnalysis(items: Analysed[]) {
  const totalItems = items.length;
  const classified = items.filter((i) => i.classification !== "unclassified");
  const stars = classified.filter((i) => i.classification === "star").length;
  const plowhorses = classified.filter((i) => i.classification === "plowhorse").length;
  const puzzles = classified.filter((i) => i.classification === "puzzle").length;
  const dogs = classified.filter((i) => i.classification === "dog").length;
  const avgFoodCostPct = totalItems > 0 ? items.reduce((sum, i) => sum + i.foodCostPct, 0) / totalItems : 0;
  const avgContributionMargin = totalItems > 0 ? items.reduce((sum, i) => sum + i.contributionMargin, 0) / totalItems : 0;
  const totalRevenue = items.reduce((sum, i) => sum + (i.sellingPrice * i.unitsSold), 0);
  const totalFoodCost = items.reduce((sum, i) => sum + (i.foodCost * i.unitsSold), 0);
  return {
    totalItems, stars, plowhorses, puzzles, dogs, unclassified: totalItems - classified.length,
    avgFoodCostPct: avgFoodCostPct.toFixed(1),
    avgContributionMargin: avgContributionMargin.toFixed(2),
    totalRevenue: totalRevenue.toFixed(2),
    totalFoodCost: totalFoodCost.toFixed(2),
    overallFoodCostPct: totalRevenue > 0 ? ((totalFoodCost / totalRevenue) * 100).toFixed(1) : "0",
  };
}

/** A small deterministic generator, so the grids are the same on every run. */
function lcg(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

// ---------------------------------------------------------------------------
// Golden samples: the Margherita menu of menuCosting.integration.test.ts
// ---------------------------------------------------------------------------

const identity = (q: number) => q;
const MENU: Array<EngineeringRow & { name: string }> = [
  { name: "Margherita", unitsSold: 120, contributionMargin: 9.76, menuMixPct: 61.54 },
  { name: "House Salad", unitsSold: 40, contributionMargin: 6.06, menuMixPct: 20.51 },
  { name: "Free Bread", unitsSold: 10, contributionMargin: -0.72, menuMixPct: 5.13 },
  { name: "Truffle Pasta", unitsSold: 25, contributionMargin: 18.39, menuMixPct: 12.82 },
  { name: "Soup", unitsSold: 0, contributionMargin: 8.26, menuMixPct: 0 },
];

describe("stored line cost: what the server writes", () => {
  it("costs the Margherita lines to the cent", async () => {
    // 1.2 kg x 3.35 / 87.5%; 0.35 kg x 14.20; 0.5 kg (500 g) x 2.10 / 92%; 0.15 L (150 mL) x 41.25.
    expect(await storedLineCost({ quantity: "1.2", unitCost: "3.35", yieldPct: "87.5" }, identity)).toBe("4.59");
    expect(await storedLineCost({ quantity: "0.35", unitCost: "14.20", yieldPct: "100" }, identity)).toBe("4.97");
    expect(await storedLineCost({ quantity: "500", unitCost: "2.10", yieldPct: "92" }, (g) => g / 1000)).toBe("1.14");
    expect(await storedLineCost({ quantity: "150", unitCost: "41.2500", yieldPct: "100" }, (ml) => ml / 1000)).toBe("6.19");
  });

  it("stores 0.00 for an unreadable input or a zero yield, without looking the unit up", async () => {
    const never = () => { throw new Error("must not be called"); };
    for (const line of [
      { quantity: "x", unitCost: "5", yieldPct: "100" },
      { quantity: "1", unitCost: "", yieldPct: "100" },
      { quantity: "1", unitCost: "5", yieldPct: "abc" },
      { quantity: "1", unitCost: "5", yieldPct: "0" },
    ]) {
      expect(await storedLineCost(line, never)).toBe("0.00");
    }
  });

  it("agrees with the legacy expression over a grid", async () => {
    const rnd = lcg(7);
    const pick = () => ["", "0", "abc", "-50", "0.125", "0.35", "1.2", "7", "14.20", "87.5", "100", "120"][Math.floor(rnd() * 12)];
    for (let i = 0; i < 400; i++) {
      const line = { quantity: pick(), unitCost: pick(), yieldPct: pick() };
      expect(await storedLineCost(line, (q) => q * 2)).toBe(legacyComputeLineCost(line.quantity, line.unitCost, line.yieldPct, (q) => q * 2));
    }
  });
});

describe("preview line cost: what the web editor shows", () => {
  it("agrees with the legacy expression over a grid, with and without a unit path", () => {
    const rnd = lcg(11);
    const pick = () => ["", "0", "abc", "-50", "0.125", "0.35", "1.2", "7", "14.20", "87.5", "100", "120"][Math.floor(rnd() * 12)];
    for (let i = 0; i < 400; i++) {
      const line = { quantity: pick(), unitCost: pick(), yieldPct: pick() };
      for (const toKitchen of [identity, (q: number) => q / 1000, () => null]) {
        expect(previewLineCost(line, toKitchen)).toBe(legacyCalcLineCost(line.quantity, line.unitCost, line.yieldPct, toKitchen));
      }
    }
  });

  it("explains a line without rounding, and a zero yield as 0", () => {
    expect(rawLineCost(0.5, 4, 80)).toBe(2.5);
    expect(rawLineCost(0.5, 4, 0)).toBe(0);
  });
});

describe("item cost", () => {
  it("stores the Margherita, House Salad, Free Bread and Truffle Pasta costs the service stored", () => {
    expect(storedItemCosts({ lineCosts: ["4.59", "4.97", "1.14", "6.19"], servings: 4, servingsPerSale: 2, qFactorPct: "3.50", sellingPrice: "18.50" }))
      .toEqual({ foodCost: "8.74", foodCostPct: "47.25", contributionMargin: "9.76" });
    expect(storedItemCosts({ lineCosts: ["1.77", "4.17", "0.00"], servings: 1, servingsPerSale: 1, qFactorPct: "0.00", sellingPrice: "12.00" }))
      .toEqual({ foodCost: "5.94", foodCostPct: "49.50", contributionMargin: "6.06" });
    expect(storedItemCosts({ lineCosts: ["0.72"], servings: 1, servingsPerSale: 1, qFactorPct: "0", sellingPrice: "0.00" }))
      .toEqual({ foodCost: "0.72", foodCostPct: "0.00", contributionMargin: "-0.72" });
    expect(storedItemCosts({ lineCosts: ["38.00", "1.21"], servings: 2, servingsPerSale: 1, qFactorPct: "0", sellingPrice: "29.00" }))
      .toEqual({ foodCost: "19.61", foodCostPct: "67.60", contributionMargin: "9.39" });
    expect(storedItemCosts({ lineCosts: ["38.00", "1.21"], servings: 2, servingsPerSale: 1, qFactorPct: "0", sellingPrice: "38.00" }))
      .toEqual({ foodCost: "19.61", foodCostPct: "51.59", contributionMargin: "18.39" });
  });

  it("agrees with the legacy stored and editor expressions over a grid", () => {
    const rnd = lcg(3);
    for (let i = 0; i < 400; i++) {
      const lineCosts = Array.from({ length: Math.floor(rnd() * 5) }, () => (rnd() < 0.1 ? null : (rnd() * 20).toFixed(2)));
      const servings = Math.floor(rnd() * 12) + 1;
      const servingsPerSale = Math.floor(rnd() * 4) + 1;
      const q = ["0", "0.00", "3.50", "12", "", "x"][Math.floor(rnd() * 6)];
      const price = ["0.00", "9.50", "18.50", "120"][Math.floor(rnd() * 4)];
      expect(storedItemCosts({ lineCosts, servings, servingsPerSale, qFactorPct: q || null, sellingPrice: price }))
        .toEqual(legacyStored(lineCosts, servings, servingsPerSale, q || null, price));
      const total = lineCosts.reduce((s, c) => s + parseFloat(c ?? "0"), 0);
      expect(editorItemCosts({ totalBatchCost: total, servings, qFactorPct: q, servingsPerSale, sellingPrice: price }))
        .toEqual(legacyEditor(total, servings, q, servingsPerSale, price));
    }
  });

  it("agrees with the legacy plate P&L expression", () => {
    const rnd = lcg(5);
    for (let i = 0; i < 200; i++) {
      const total = rnd() * 60;
      const servings = [null, 1, 2, 4, 12][Math.floor(rnd() * 5)];
      const q = [null, "0", "3.50", "x"][Math.floor(rnd() * 4)];
      expect(plateFoodCost(total, servings, q)).toBe(legacyPandL(total, servings, q));
    }
    // Margherita at the location's cost: dough 4.59, cheese 4.97, flour 500 g x 2 / 92% = 1.09, brandy 0.15 L x 44.125 = 6.62.
    expect(plateFoodCost(4.59 + 4.97 + 1.09 + 6.62, 4, "3.50")).toBe(4.47);
    expect(plateFoodCost(38 + 1.21, 2, "0")).toBe(19.61);
  });
});

describe("menu engineering", () => {
  it("classifies the sample menu the way the service stored it, then one category on its own", () => {
    expect(classifyAgainstWholeMenu(MENU).classifications).toEqual(["star", "plowhorse", "dog", "puzzle", "unclassified"]);
    const mains = [
      { unitsSold: 120, contributionMargin: 9.76, menuMixPct: 82.76 },
      { unitsSold: 25, contributionMargin: 18.39, menuMixPct: 17.24 },
      { unitsSold: 0, contributionMargin: 8.26, menuMixPct: 0 },
    ];
    expect(classifyAgainstWholeMenu(mains).classifications).toEqual(["plowhorse", "puzzle", "unclassified"]);
  });

  it("computes the mix the way the service stores it", () => {
    expect([120, 40, 10, 25, 0].map((u) => menuMixPct(u, 195).toFixed(2))).toEqual(["61.54", "20.51", "5.13", "12.82", "0.00"]);
    expect(menuMixPct(5, 0)).toBe(0);
  });

  it("agrees with the legacy classification and matrix expressions over a grid", () => {
    const rnd = lcg(9);
    for (let i = 0; i < 200; i++) {
      const rows: EngineeringRow[] = Array.from({ length: Math.floor(rnd() * 8) + 1 }, () => ({
        unitsSold: rnd() < 0.25 ? 0 : Math.floor(rnd() * 200),
        contributionMargin: Number((rnd() * 30 - 5).toFixed(2)),
        menuMixPct: Number((rnd() * 70).toFixed(2)),
      }));
      expect(classifyAgainstWholeMenu(rows).classifications).toEqual(legacyClassify(rows));
      const sold = rows.filter((r) => r.unitsSold > 0);
      expect(matrixAverages(sold)).toEqual(legacyMatrix(sold));
    }
    expect(matrixAverages([])).toEqual({ avgCM: 0, avgMix: 0, maxCM: 1, maxMix: 1 });
  });

  it("summarises the analysis the way the service returned it", () => {
    const items: Analysed[] = [
      { sellingPrice: 18.5, foodCost: 8.74, foodCostPct: 47.25, contributionMargin: 9.76, unitsSold: 120, classification: "star" },
      { sellingPrice: 9.5, foodCost: 1.24, foodCostPct: 13.05, contributionMargin: 8.26, unitsSold: 0, classification: "unclassified" },
      { sellingPrice: 38, foodCost: 19.61, foodCostPct: 51.59, contributionMargin: 18.39, unitsSold: 25, classification: "puzzle" },
      { sellingPrice: 0, foodCost: 0.72, foodCostPct: 0, contributionMargin: -0.72, unitsSold: 10, classification: "dog" },
      { sellingPrice: 12, foodCost: 5.94, foodCostPct: 49.5, contributionMargin: 6.06, unitsSold: 40, classification: "plowhorse" },
    ];
    expect(summariseMenuAnalysis(items)).toEqual({
      totalItems: 5, stars: 1, plowhorses: 1, puzzles: 1, dogs: 1, unclassified: 1,
      avgFoodCostPct: "32.3", avgContributionMargin: "8.35", totalRevenue: "3650.00", totalFoodCost: "1783.85", overallFoodCostPct: "48.9",
    });
    expect(summariseMenuAnalysis(items)).toEqual(legacyAnalysis(items));
    expect(summariseMenuAnalysis([])).toEqual({
      totalItems: 0, stars: 0, plowhorses: 0, puzzles: 0, dogs: 0, unclassified: 0,
      avgFoodCostPct: "0.0", avgContributionMargin: "0.00", totalRevenue: "0.00", totalFoodCost: "0.00", overallFoodCostPct: "0",
    });
  });

  it("averages a category's food cost %, 0 when it has no items", () => {
    expect(categoryActualFoodCostPct([{ foodCostPct: 47.25 }, { foodCostPct: 51.59 }])).toBe((47.25 + 51.59) / 2);
    expect(categoryActualFoodCostPct([])).toBe(0);
  });
});

describe("thresholds and weights", () => {
  it("keeps the numbers the screens and prep services had hard-coded", () => {
    expect(FOOD_COST_ALERT_PCT).toBe(35);
    expect(DEFAULT_CATEGORY_TARGET_PCT).toBe(30);
    expect(CLASSIFICATION_PREP_WEIGHTS).toEqual({ star: 4, plowhorse: 3, puzzle: 2, dog: 1, unclassified: 2 });
  });

  it("weighs an unknown or missing class like an unclassified one", () => {
    expect(["star", "plowhorse", "puzzle", "dog", "unclassified", "new-class", null, undefined].map(classificationPrepWeight))
      .toEqual([4, 3, 2, 1, 2, 2, 2, 2]);
  });
});

// ---------------------------------------------------------------------------
// Where the web and the server disagree (needs-decision; both behaviours are kept)
// ---------------------------------------------------------------------------

describe("needs-decision: the web editor and the server disagree", () => {
  it("1. a half-cent line: the editor rounds up (Math.round), the server stores the cent below (toFixed)", async () => {
    // 0.125 kg x $14.20 = 1.7749999999999999 in floating point.
    const line = { quantity: "0.125", unitCost: "14.20", yieldPct: "100" };
    expect(previewLineCost(line, identity)).toBe(1.78);
    expect(await storedLineCost(line, identity)).toBe("1.77");
  });

  it("2. a zero yield: the editor costs it at 100%, the server stores 0.00 (the API accepts a yield of 0)", async () => {
    const line = { quantity: "0.2", unitCost: "5", yieldPct: "0" };
    expect(previewLineCost(line, identity)).toBe(1);
    expect(await storedLineCost(line, identity)).toBe("0.00");
  });

  it("3. units with no path between them: the editor shows $0 and a warning, the server refuses the row", async () => {
    const line = { quantity: "1", unitCost: "5", yieldPct: "100" };
    expect(previewLineCost(line, () => null)).toBe(0);
    await expect(storedLineCost(line, () => { throw new Error("incompatible units"); })).rejects.toThrow("incompatible units");
  });

  it("4. the average the chart draws is not the average the class came from", () => {
    // The chart averages the 4 items that sold (mix 25.0), the server all 5 (mix 20.0): the House Salad (mix 20.51)
    // is stored as a Plowhorse (high mix) but is drawn left of the crosshair.
    const sold = MENU.filter((m) => m.unitsSold > 0);
    expect(matrixAverages(sold).avgMix).toBeCloseTo(25, 2);
    expect(MENU.reduce((s, m) => s + m.menuMixPct, 0) / MENU.length).toBeCloseTo(20, 2);
    expect(classifyAgainstWholeMenu(MENU).classifications[1]).toBe("plowhorse");
    expect(MENU[1].menuMixPct).toBeLessThan(matrixAverages(sold).avgMix);
  });

  it("5. the plate P&L cost is per serving, the stored food cost is per sale: a 2-serving pack differs by 2x", () => {
    expect(plateFoodCost(16.89, 4, "3.50")).toBe(4.37);
    expect(storedItemCosts({ lineCosts: ["16.89"], servings: 4, servingsPerSale: 2, qFactorPct: "3.50", sellingPrice: "18.50" }).foodCost).toBe("8.74");
  });

  it("6. a servings-per-sale below 1: the editor counts 1, the server multiplies by it (the API requires at least 1)", () => {
    expect(editorItemCosts({ totalBatchCost: 10, servings: 1, qFactorPct: "0", servingsPerSale: 0, sellingPrice: "20" }).foodCostPerSale).toBe(10);
    expect(storedItemCosts({ lineCosts: ["10.00"], servings: 1, servingsPerSale: 0, qFactorPct: "0", sellingPrice: "20" }).foodCost).toBe("0.00");
  });
});

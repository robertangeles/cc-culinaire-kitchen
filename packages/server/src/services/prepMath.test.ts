import { describe, it, expect } from "vitest";
import {
  attachRateFor,
  computeSuggestedSelections,
  DEFAULT_PREP_BUFFER,
  scaledLineQuantity,
  stationFor,
  aggregatePrepLines,
  attachOnHand,
  type SuggestInputItem,
  type PrepSourceLine,
} from "./prepMath.js";

/** Minimal source line with sane defaults; override per test. */
function line(over: Partial<PrepSourceLine>): PrepSourceLine {
  return {
    ingredientId: null,
    ingredientName: "Salt",
    unit: "g",
    category: null,
    quantity: 10,
    yieldPct: 100,
    servings: 1,
    expectedPortions: 1,
    dishName: "Dish A",
    menuItemId: null,
    recipeId: null,
    classificationWeight: 2,
    prepTimeMinutes: 0,
    ...over,
  };
}

const noBuffer = { buffer: 1 };

describe("attachRateFor", () => {
  it("maps courses to attach rates", () => {
    expect(attachRateFor("Mains")).toBe(1.0);
    expect(attachRateFor("Desserts")).toBe(0.4);
    expect(attachRateFor("Starters")).toBe(0.5);
    expect(attachRateFor("Sides")).toBe(0.5);
    expect(attachRateFor("Soup")).toBe(0.6);
  });
  it("defaults unknown / empty categories to 1.0 (treat as a main)", () => {
    expect(attachRateFor("Wizardry")).toBe(1.0);
    expect(attachRateFor("")).toBe(1.0);
    expect(attachRateFor(null)).toBe(1.0);
  });
});

describe("computeSuggestedSelections", () => {
  it("returns [] for no items", () => {
    expect(computeSuggestedSelections(100, [])).toEqual([]);
  });

  it("returns all-zero suggestions when covers <= 0 (no divide-by-zero)", () => {
    const items: SuggestInputItem[] = [
      { menuItemId: "a", category: "Mains", unitsSold: 0 },
      { menuItemId: "b", category: "Mains", unitsSold: 0 },
    ];
    const r = computeSuggestedSelections(0, items);
    expect(r.map((x) => x.suggestedPortions)).toEqual([0, 0]);
  });

  it("uses an even 1/N within-category baseline when there is no sales history", () => {
    const items: SuggestInputItem[] = [
      { menuItemId: "a", category: "Mains", unitsSold: 0 },
      { menuItemId: "b", category: "Mains", unitsSold: 0 },
    ];
    const r = computeSuggestedSelections(100, items, noBuffer);
    // 100 covers × attach 1.0 × (1/2) × buffer 1 = 50 each; sums to covers.
    expect(r).toEqual([
      { menuItemId: "a", suggestedPortions: 50, basis: "estimated" },
      { menuItemId: "b", suggestedPortions: 50, basis: "estimated" },
    ]);
  });

  it("uses historical mix within category when units sold exist", () => {
    const items: SuggestInputItem[] = [
      { menuItemId: "a", category: "Mains", unitsSold: 75 },
      { menuItemId: "b", category: "Mains", unitsSold: 25 },
    ];
    const r = computeSuggestedSelections(100, items, noBuffer);
    expect(r).toEqual([
      { menuItemId: "a", suggestedPortions: 75, basis: "historical" },
      { menuItemId: "b", suggestedPortions: 25, basis: "historical" },
    ]);
  });

  it("applies the per-category attach rate (desserts < mains)", () => {
    const items: SuggestInputItem[] = [{ menuItemId: "d", category: "Desserts", unitsSold: 0 }];
    const r = computeSuggestedSelections(100, items, noBuffer);
    // 100 × 0.4 × (1/1) × 1 = 40
    expect(r[0].suggestedPortions).toBe(40);
  });

  it("applies the default 1.25 rush buffer", () => {
    const items: SuggestInputItem[] = [{ menuItemId: "m", category: "Mains", unitsSold: 0 }];
    const r = computeSuggestedSelections(100, items);
    // 100 × 1.0 × 1 × 1.25 = 125
    expect(DEFAULT_PREP_BUFFER).toBe(1.25);
    expect(r[0].suggestedPortions).toBe(125);
  });

  it("rounds to the nearest whole portion and never goes negative", () => {
    const items: SuggestInputItem[] = [
      { menuItemId: "a", category: "Mains", unitsSold: 0 },
      { menuItemId: "b", category: "Mains", unitsSold: 0 },
      { menuItemId: "c", category: "Mains", unitsSold: 0 },
    ];
    const r = computeSuggestedSelections(10, items, noBuffer);
    // 10 × 1 × (1/3) = 3.33 → 3
    expect(r.every((x) => x.suggestedPortions === 3)).toBe(true);
  });

  it("gives 0 to a zero-selling item in a category that has sales (historical basis)", () => {
    const items: SuggestInputItem[] = [
      { menuItemId: "a", category: "Mains", unitsSold: 100 },
      { menuItemId: "b", category: "Mains", unitsSold: 0 },
    ];
    const r = computeSuggestedSelections(100, items, noBuffer);
    expect(r[1]).toEqual({ menuItemId: "b", suggestedPortions: 0, basis: "historical" });
  });

  it("splits attach correctly across mixed categories (no double-count)", () => {
    const items: SuggestInputItem[] = [
      { menuItemId: "m1", category: "Mains", unitsSold: 0 },
      { menuItemId: "m2", category: "Mains", unitsSold: 0 },
      { menuItemId: "d1", category: "Desserts", unitsSold: 0 },
    ];
    const r = computeSuggestedSelections(100, items, noBuffer);
    // Mains: 100 × 1.0 × 1/2 = 50 each (sum 100). Dessert: 100 × 0.4 × 1/1 = 40.
    expect(r.find((x) => x.menuItemId === "m1")!.suggestedPortions).toBe(50);
    expect(r.find((x) => x.menuItemId === "d1")!.suggestedPortions).toBe(40);
  });
});

describe("scaledLineQuantity (T0: per-batch ÷ servings)", () => {
  it("servings=1: quantity × portions", () => {
    expect(scaledLineQuantity(50, 10, 1, 100)).toBe(500);
  });
  it("servings=4 (batch recipe): divides by servings — the over-prep fix", () => {
    // 1000g flour for a 4-serving batch, prepping 100 portions → 1000 × 100/4 = 25000
    expect(scaledLineQuantity(1000, 100, 4, 100)).toBe(25000);
    // The OLD (buggy) behaviour would have been 1000 × 100 = 100000 (4× too much).
  });
  it("applies yield loss (divide by the decimal)", () => {
    // 80% yield → need more raw: 100 × 1 / 0.8 = 125
    expect(scaledLineQuantity(100, 1, 1, 80)).toBe(125);
  });
  it("floors bad servings/yield to safe values (no divide-by-zero)", () => {
    expect(scaledLineQuantity(10, 2, 0, 0)).toBe(20); // servings→1, yield→100
  });
});

describe("stationFor", () => {
  it("maps catalog categories to stations", () => {
    expect(stationFor("proteins")).toBe("Grill / Protein");
    expect(stationFor("produce")).toBe("Garde Manger");
    expect(stationFor("bakery")).toBe("Pastry / Bakery");
  });
  it("unknown / null category → Other", () => {
    expect(stationFor("wizardry")).toBe("Other");
    expect(stationFor(null)).toBe("Other");
  });
});

describe("aggregatePrepLines", () => {
  it("merges by ingredient_id across dishes (one batch number, summed)", () => {
    const out = aggregatePrepLines([
      line({ ingredientId: "tom", ingredientName: "Tomato Sauce", unit: "ml", quantity: 100, dishName: "Pasta" }),
      line({ ingredientId: "tom", ingredientName: "tomato sauce", unit: "ml", quantity: 50, dishName: "Pizza" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].totalQuantity).toBe(150);
    expect(out[0].dishes.sort()).toEqual(["Pasta", "Pizza"]);
    expect(out[0].ingredientId).toBe("tom");
  });

  it("does NOT merge the same ingredient across different units", () => {
    const out = aggregatePrepLines([
      line({ ingredientId: "x", unit: "g", quantity: 100 }),
      line({ ingredientId: "x", unit: "kg", quantity: 1 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("name-keys recipe/free-text lines (null ingredient_id)", () => {
    const out = aggregatePrepLines([
      line({ ingredientId: null, ingredientName: "Basil", unit: "g", quantity: 5, dishName: "A" }),
      line({ ingredientId: null, ingredientName: "basil", unit: "g", quantity: 3, dishName: "B" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].totalQuantity).toBe(8);
    expect(out[0].ingredientId).toBeNull();
  });

  it("assigns station from catalog category; recipe lines → Other", () => {
    const out = aggregatePrepLines([
      line({ ingredientId: "beef", category: "proteins", unit: "g" }),
      line({ ingredientId: null, ingredientName: "Mystery", unit: "g" }),
    ]);
    expect(out.find((l) => l.ingredientId === "beef")!.station).toBe("Grill / Protein");
    expect(out.find((l) => l.ingredientId === null)!.station).toBe("Other");
  });

  it("applies the servings-correct scaling during aggregation", () => {
    const out = aggregatePrepLines([
      line({ ingredientId: "f", unit: "g", quantity: 1000, servings: 4, expectedPortions: 100, yieldPct: 100 }),
    ]);
    expect(out[0].totalQuantity).toBe(25000); // not 100000
  });

  it("dedupes the same dish contributing one ingredient twice", () => {
    const out = aggregatePrepLines([
      line({ ingredientId: "s", unit: "g", quantity: 5, dishName: "Stew" }),
      line({ ingredientId: "s", unit: "g", quantity: 3, dishName: "Stew" }),
    ]);
    expect(out[0].totalQuantity).toBe(8);
    expect(out[0].dishes).toEqual(["Stew"]); // counted once, not twice
  });
});

describe("regression — legacy parity (IRON RULE)", () => {
  it("servings=1 + yield=100 reproduces the legacy menu-path formula (qty × portions)", () => {
    // Legacy generateTasksFromSelections menu path: Number(ing.quantity) * portionsNeeded.
    // New path must be byte-identical for the common servings=1, yield=100 case.
    expect(scaledLineQuantity(50, 8, 1, 100)).toBe(400);
    const out = aggregatePrepLines([
      line({ ingredientId: "x", unit: "g", quantity: 50, servings: 1, yieldPct: 100, expectedPortions: 8 }),
    ]);
    expect(out[0].totalQuantity).toBe(400);
  });

  it("legacy free-text lines (null ingredientId) still name-key + merge across dishes", () => {
    const out = aggregatePrepLines([
      line({ ingredientId: null, ingredientName: "Olive Oil", unit: "ml", quantity: 20, servings: 1, expectedPortions: 5, dishName: "A" }),
      line({ ingredientId: null, ingredientName: "Olive Oil", unit: "ml", quantity: 10, servings: 1, expectedPortions: 5, dishName: "B" }),
    ]);
    // 20×5 + 10×5 = 150, merged under one name key (legacy behaviour preserved).
    expect(out).toHaveLength(1);
    expect(out[0].totalQuantity).toBe(150);
    expect(out[0].dishes.sort()).toEqual(["A", "B"]);
  });

  it("servings>1 is the intended FIX (diverges from legacy, matches the cost subsystem)", () => {
    // Legacy would have returned 1000×100 = 100000 (4× over-prep). New divides by servings.
    expect(scaledLineQuantity(1000, 100, 4, 100)).toBe(25000);
  });
});

describe("attachOnHand (P1-1: forecast - on_hand = prep_needed)", () => {
  const simpleConvert = (qty: number, from: string, to: string): number | null => {
    if (from === to) return qty;
    if (from === "kg" && to === "g") return qty * 1000;
    if (from === "g" && to === "kg") return qty / 1000;
    return null;
  };

  it("subtracts on-hand from forecast demand", () => {
    const lines = aggregatePrepLines([
      line({ ingredientId: "salt", unit: "g", quantity: 500, servings: 1, expectedPortions: 1 }),
    ]);
    const stock = new Map([["salt", { qty: 200, baseUnit: "g" }]]);
    const result = attachOnHand(lines, stock, simpleConvert);
    expect(result[0].onHandQty).toBe(200);
    expect(result[0].prepNeeded).toBe(300);
  });

  it("floors prep_needed at 0 when on-hand exceeds forecast", () => {
    const lines = aggregatePrepLines([
      line({ ingredientId: "salt", unit: "g", quantity: 100, servings: 1, expectedPortions: 1 }),
    ]);
    const stock = new Map([["salt", { qty: 999, baseUnit: "g" }]]);
    const result = attachOnHand(lines, stock, simpleConvert);
    expect(result[0].prepNeeded).toBe(0);
  });

  it("converts units (stock in kg, prep in g)", () => {
    const lines = aggregatePrepLines([
      line({ ingredientId: "flour", unit: "g", quantity: 1000, servings: 1, expectedPortions: 1 }),
    ]);
    const stock = new Map([["flour", { qty: 0.5, baseUnit: "kg" }]]);
    const result = attachOnHand(lines, stock, simpleConvert);
    expect(result[0].onHandQty).toBe(500);
    expect(result[0].prepNeeded).toBe(500);
  });

  it("leaves null for free-text ingredients (no catalog id)", () => {
    const lines = aggregatePrepLines([
      line({ ingredientId: null, ingredientName: "mystery", unit: "g", quantity: 100 }),
    ]);
    const result = attachOnHand(lines, new Map(), simpleConvert);
    expect(result[0].onHandQty).toBeNull();
    expect(result[0].prepNeeded).toBeNull();
  });

  it("sets on-hand 0 when ingredient has no stock_level row", () => {
    const lines = aggregatePrepLines([
      line({ ingredientId: "new-item", unit: "g", quantity: 100 }),
    ]);
    const result = attachOnHand(lines, new Map(), simpleConvert);
    expect(result[0].onHandQty).toBe(0);
    expect(result[0].prepNeeded).toBe(100);
  });

  it("leaves null when units are incompatible (no converter)", () => {
    const lines = aggregatePrepLines([
      line({ ingredientId: "eggs", unit: "each", quantity: 12 }),
    ]);
    const stock = new Map([["eggs", { qty: 2, baseUnit: "kg" }]]);
    const result = attachOnHand(lines, stock, simpleConvert);
    expect(result[0].onHandQty).toBeNull();
    expect(result[0].prepNeeded).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Backward reconciliation tests (added for formula audit)
// ---------------------------------------------------------------------------

describe("scaledLineQuantity — backward reconciliation", () => {
  it("output / (portions / servings) = quantity when yield=100%", () => {
    const qty = 250;
    const portions = 40;
    const servings = 4;
    const scaled = scaledLineQuantity(qty, portions, servings, 100);
    // Inverse: scaled × servings / portions = qty
    expect((scaled * servings) / portions).toBeCloseTo(qty, 10);
  });

  it("output × (yieldPct/100) reverses the yield adjustment", () => {
    const qty = 100;
    const yieldPct = 85;
    const scaled = scaledLineQuantity(qty, 1, 1, yieldPct);
    // scaled = qty / (85/100) = qty / 0.85
    // scaled × 0.85 = qty
    expect(scaled * (yieldPct / 100)).toBeCloseTo(qty, 10);
  });

  it("full inverse: (scaled × servings × (yieldPct/100)) / portions = quantity", () => {
    const qty = 333.33;
    const portions = 17;
    const servings = 6;
    const yieldPct = 92;
    const scaled = scaledLineQuantity(qty, portions, servings, yieldPct);
    const recovered = (scaled * servings * (yieldPct / 100)) / portions;
    expect(recovered).toBeCloseTo(qty, 8);
  });
});

describe("computeSuggestedSelections — backward reconciliation", () => {
  it("sum of suggestions across a category ≈ covers × attachRate × buffer (invariant)", () => {
    const covers = 120;
    const items: SuggestInputItem[] = [
      { menuItemId: "a", category: "Mains", unitsSold: 60 },
      { menuItemId: "b", category: "Mains", unitsSold: 30 },
      { menuItemId: "c", category: "Mains", unitsSold: 10 },
    ];
    const buffer = 1.0;
    const r = computeSuggestedSelections(covers, items, { buffer });
    const total = r.reduce((s, x) => s + x.suggestedPortions, 0);
    // Attach rate for Mains = 1.0. Total ≈ 120 × 1.0 × 1.0 = 120
    // Rounding may cause ±1 per item (3 items max drift ±3).
    expect(total).toBeGreaterThanOrEqual(covers - 3);
    expect(total).toBeLessThanOrEqual(covers + 3);
  });
});

describe("attachOnHand — backward reconciliation", () => {
  const simpleConvert2 = (qty: number, from: string, to: string): number | null => {
    if (from === to) return qty;
    return null;
  };

  it("onHandQty + prepNeeded = totalQuantity (conservation law)", () => {
    const lines = aggregatePrepLines([
      line({ ingredientId: "butter", unit: "g", quantity: 750, servings: 1, expectedPortions: 1 }),
    ]);
    const stock = new Map([["butter", { qty: 300, baseUnit: "g" }]]);
    const result = attachOnHand(lines, stock, simpleConvert2);
    const { onHandQty, prepNeeded, totalQuantity } = result[0];
    expect(onHandQty! + prepNeeded!).toBeCloseTo(totalQuantity, 3);
  });
});

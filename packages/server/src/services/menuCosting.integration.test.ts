import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { ingredient, locationIngredient, menuItem, menuItemIngredient, user } from "../db/schema.js";
import {
  addIngredient, createMenuItem, getMenuAnalysis, getPandLFoodCost, recalculateMenu, updateMenuItem,
} from "./menuIntelligenceService.js";
import { resolveMenuScope, type MenuScope } from "./menuAccess.js";
import { createLineLoopFx, removeLineLoopFx, type LineLoopFx } from "./lineLoopFixture.js";

/**
 * Characterisation of the server's menu costing, written before the maths moved to packages/shared: the
 * stored line cost, food cost, food cost %, contribution margin, menu mix, classification, plate P&L cost and
 * the analysis totals for one realistic menu, driven through the real service on a real DB. The expected
 * values are what the service produced before the move; they must not change when the maths is imported from
 * shared. Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

let fx: LineLoopFx;
let chef: MenuScope;
let brandyId: string;
const ids: Record<string, string> = {};

async function item(name: string, category: string, price: string, extra: Partial<Parameters<typeof createMenuItem>[1]> = {}) {
  const row = await createMenuItem(chef, { name, category, sellingPrice: price, ...extra });
  ids[name] = row.menuItemId;
  return row.menuItemId;
}

const stored = async (name: string) => {
  const [r] = await db
    .select({
      foodCost: menuItem.foodCost, foodCostPct: menuItem.foodCostPct, contributionMargin: menuItem.contributionMargin,
      menuMixPct: menuItem.menuMixPct, classification: menuItem.classification,
    })
    .from(menuItem)
    .where(eq(menuItem.menuItemId, ids[name]));
  return r;
};

const lineCosts = async (name: string) =>
  (await db
    .select({ n: menuItemIngredient.ingredientName, c: menuItemIngredient.lineCost, u: menuItemIngredient.unitCost })
    .from(menuItemIngredient)
    .where(eq(menuItemIngredient.menuItemId, ids[name]))
    .orderBy(menuItemIngredient.id)
  ).map((r) => `${r.n}=${r.c}@${r.u}`);

describe.skipIf(!RUN)("menu costing (real DB) — characterisation before the move to shared", () => {
  beforeAll(async () => {
    fx = await createLineLoopFx(`mc_${Date.now().toString(36)}`);
    await db.update(user).set({ selectedLocationId: fx.locA }).where(eq(user.userId, fx.chef));
    chef = await resolveMenuScope(fx.chef);
    // Catalogue: flour is kg (fixture, location cost 2); brandy is counted in L with a preferred supplier cost.
    [{ id: brandyId }] = await db
      .insert(ingredient)
      .values({
        organisationId: fx.orgId, ingredientName: `${fx.tag}-brandy`, ingredientCategory: "spirits", itemType: "KITCHEN_INGREDIENT",
        baseUnit: "L", preferredUnitCost: "41.2500", unitCost: "39.9000",
      })
      .returning({ id: ingredient.ingredientId });
    await db.insert(locationIngredient).values({ ingredientId: brandyId, storeLocationId: fx.locA, activeInd: true, weightedAverageCost: "44.1250" });
  });

  afterAll(async () => {
    await db.delete(locationIngredient).where(eq(locationIngredient.ingredientId, brandyId));
    await db.delete(menuItemIngredient).where(eq(menuItemIngredient.ingredientId, brandyId));
    await db.delete(ingredient).where(eq(ingredient.ingredientId, brandyId));
    await removeLineLoopFx(fx);
  });

  it("costs a dish: yield, unit conversion, servings, Q factor and a pack of servings per sale", async () => {
    await item("Margherita", "Mains", "18.50", { servings: 4, servingsPerSale: 2, qFactorPct: "3.5" });
    await addIngredient(ids.Margherita, chef, { ingredientName: "Dough", quantity: "1.2", unit: "kg", unitCost: "3.35", yieldPct: "87.5" });
    await addIngredient(ids.Margherita, chef, { ingredientName: "Cheese", quantity: "0.35", unit: "kg", unitCost: "14.20" });
    // Linked to a kg-counted catalogue item: 500 g converts to 0.5 kg. The manual 2.10 wins over the catalogue.
    await addIngredient(ids.Margherita, chef, { ingredientId: fx.ingId, ingredientName: "Flour", quantity: "500", unit: "g", unitCost: "2.10", yieldPct: "92" });
    // Linked to an L-counted spirit with no manual cost: 150 mL is 0.15 L at the catalogue's preferred 41.25.
    await addIngredient(ids.Margherita, chef, { ingredientId: brandyId, ingredientName: "Brandy", quantity: "150", unit: "mL" });

    expect(await lineCosts("Margherita")).toMatchInlineSnapshot(`
      [
        "Dough=4.59@3.3500",
        "Cheese=4.97@14.2000",
        "Flour=1.14@2.1000",
        "Brandy=6.19@41.2500",
      ]
    `);
    expect(await stored("Margherita")).toMatchInlineSnapshot(`
      {
        "classification": "unclassified",
        "contributionMargin": "9.76",
        "foodCost": "8.74",
        "foodCostPct": "47.25",
        "menuMixPct": "0.00",
      }
    `);
  });

  it("rounds a half-cent line with toFixed and a zero yield to 0.00", async () => {
    await item("House Salad", "Starters", "12.00");
    // 0.125 kg x 14.20 = 1.775 in floating point (1.7749999...): the stored cost is 1.77.
    await addIngredient(ids["House Salad"], chef, { ingredientName: "Lettuce", quantity: "0.125", unit: "kg", unitCost: "14.20" });
    await addIngredient(ids["House Salad"], chef, { ingredientName: "Dressing", quantity: "0.5", unit: "kg", unitCost: "8.35" });
    await addIngredient(ids["House Salad"], chef, { ingredientName: "Croutons", quantity: "0.2", unit: "kg", unitCost: "5", yieldPct: "0" });

    expect(await lineCosts("House Salad")).toMatchInlineSnapshot(`
      [
        "Lettuce=1.77@14.2000",
        "Dressing=4.17@8.3500",
        "Croutons=0.00@5.0000",
      ]
    `);
    expect(await stored("House Salad")).toMatchInlineSnapshot(`
      {
        "classification": "unclassified",
        "contributionMargin": "6.06",
        "foodCost": "5.94",
        "foodCostPct": "49.50",
        "menuMixPct": "0.00",
      }
    `);
  });

  it("a free item has a 0 food cost % and a negative margin; a price change recalculates the stored costs", async () => {
    await item("Free Bread", "Starters", "0.00");
    await addIngredient(ids["Free Bread"], chef, { ingredientId: fx.ingId, ingredientName: "Flour", quantity: "300", unit: "g", unitCost: "2.40" });
    const free = await stored("Free Bread");

    await item("Truffle Pasta", "Mains", "29.00", { servings: 2 });
    await addIngredient(ids["Truffle Pasta"], chef, { ingredientName: "Truffle", quantity: "0.04", unit: "kg", unitCost: "950" });
    await addIngredient(ids["Truffle Pasta"], chef, { ingredientName: "Pasta", quantity: "0.25", unit: "kg", unitCost: "4.60", yieldPct: "95" });
    const before = await stored("Truffle Pasta");
    await updateMenuItem(ids["Truffle Pasta"], chef, { sellingPrice: "38.00" });
    const after = await stored("Truffle Pasta");

    await item("Soup", "Mains", "9.50");
    await addIngredient(ids.Soup, chef, { ingredientName: "Stock", quantity: "0.4", unit: "kg", unitCost: "3.10", yieldPct: "100" });

    expect({ free, before, after, soup: await stored("Soup") }).toMatchInlineSnapshot(`
      {
        "after": {
          "classification": "unclassified",
          "contributionMargin": "18.39",
          "foodCost": "19.61",
          "foodCostPct": "51.59",
          "menuMixPct": "0.00",
        },
        "before": {
          "classification": "unclassified",
          "contributionMargin": "9.39",
          "foodCost": "19.61",
          "foodCostPct": "67.60",
          "menuMixPct": "0.00",
        },
        "free": {
          "classification": "unclassified",
          "contributionMargin": "-0.72",
          "foodCost": "0.72",
          "foodCostPct": "0.00",
          "menuMixPct": "0.00",
        },
        "soup": {
          "classification": "unclassified",
          "contributionMargin": "8.26",
          "foodCost": "1.24",
          "foodCostPct": "13.05",
          "menuMixPct": "0.00",
        },
      }
    `);
  });

  it("stores mix % and classification over the whole menu; one category is classified on its own only in the analysis", async () => {
    const sold: Record<string, number> = { Margherita: 120, "House Salad": 40, "Free Bread": 10, "Truffle Pasta": 25, Soup: 0 };
    for (const [name, unitsSold] of Object.entries(sold)) await updateMenuItem(ids[name], chef, { unitsSold });

    await recalculateMenu(chef);
    const whole = Object.fromEntries(await Promise.all(Object.keys(sold).map(async (n) => [n, await stored(n)])));
    // A category recalculation refreshes that category's costs; the stored mix and class stay menu-wide.
    await recalculateMenu(chef, "Mains");
    const afterMains = Object.fromEntries(await Promise.all(Object.keys(sold).map(async (n) => [n, await stored(n)])));
    expect(afterMains).toEqual(whole);
    const mainsOnly = Object.fromEntries((await getMenuAnalysis(chef, "Mains")).items.map((i) => [i.name, { classification: i.classification, menuMixPct: i.menuMixPct }]));

    expect({ whole, mainsOnly }).toMatchInlineSnapshot(`
      {
        "mainsOnly": {
          "Margherita": {
            "classification": "plowhorse",
            "menuMixPct": 82.76,
          },
          "Soup": {
            "classification": "unclassified",
            "menuMixPct": 0,
          },
          "Truffle Pasta": {
            "classification": "puzzle",
            "menuMixPct": 17.24,
          },
        },
        "whole": {
          "Free Bread": {
            "classification": "dog",
            "contributionMargin": "-0.72",
            "foodCost": "0.72",
            "foodCostPct": "0.00",
            "menuMixPct": "5.13",
          },
          "House Salad": {
            "classification": "plowhorse",
            "contributionMargin": "6.06",
            "foodCost": "5.94",
            "foodCostPct": "49.50",
            "menuMixPct": "20.51",
          },
          "Margherita": {
            "classification": "star",
            "contributionMargin": "9.76",
            "foodCost": "8.74",
            "foodCostPct": "47.25",
            "menuMixPct": "61.54",
          },
          "Soup": {
            "classification": "unclassified",
            "contributionMargin": "8.26",
            "foodCost": "1.24",
            "foodCostPct": "13.05",
            "menuMixPct": "0.00",
          },
          "Truffle Pasta": {
            "classification": "puzzle",
            "contributionMargin": "18.39",
            "foodCost": "19.61",
            "foodCostPct": "51.59",
            "menuMixPct": "12.82",
          },
        },
      }
    `);
  });

  it("summarises the analysis: counts, averages, revenue, food cost and overall food cost %", async () => {
    const a = await getMenuAnalysis(chef);
    const { items, ...summary } = a;
    expect({
      summary,
      items: items.map((i) => ({ name: i.name, sellingPrice: i.sellingPrice, foodCost: i.foodCost, foodCostPct: i.foodCostPct, contributionMargin: i.contributionMargin, menuMixPct: i.menuMixPct, classification: i.classification })),
    }).toMatchInlineSnapshot(`
      {
        "items": [
          {
            "classification": "star",
            "contributionMargin": 9.76,
            "foodCost": 8.74,
            "foodCostPct": 47.25,
            "menuMixPct": 61.54,
            "name": "Margherita",
            "sellingPrice": 18.5,
          },
          {
            "classification": "unclassified",
            "contributionMargin": 8.26,
            "foodCost": 1.24,
            "foodCostPct": 13.05,
            "menuMixPct": 0,
            "name": "Soup",
            "sellingPrice": 9.5,
          },
          {
            "classification": "puzzle",
            "contributionMargin": 18.39,
            "foodCost": 19.61,
            "foodCostPct": 51.59,
            "menuMixPct": 12.82,
            "name": "Truffle Pasta",
            "sellingPrice": 38,
          },
          {
            "classification": "dog",
            "contributionMargin": -0.72,
            "foodCost": 0.72,
            "foodCostPct": 0,
            "menuMixPct": 5.13,
            "name": "Free Bread",
            "sellingPrice": 0,
          },
          {
            "classification": "plowhorse",
            "contributionMargin": 6.06,
            "foodCost": 5.94,
            "foodCostPct": 49.5,
            "menuMixPct": 20.51,
            "name": "House Salad",
            "sellingPrice": 12,
          },
        ],
        "summary": {
          "avgContributionMargin": "8.35",
          "avgFoodCostPct": "32.3",
          "dogs": 1,
          "overallFoodCostPct": "48.9",
          "plowhorses": 1,
          "puzzles": 1,
          "stars": 1,
          "totalFoodCost": "1783.85",
          "totalItems": 5,
          "totalRevenue": "3650.00",
          "unclassified": 1,
        },
      }
    `);
    // A person in no organisation reads only their own items: none here.
    const empty = await getMenuAnalysis({ userId: fx.boss, organisationId: null, isOrgAdmin: false });
    expect(empty).toMatchInlineSnapshot(`
      {
        "avgContributionMargin": "0.00",
        "avgFoodCostPct": "0.0",
        "dogs": 0,
        "items": [],
        "overallFoodCostPct": "0",
        "plowhorses": 0,
        "puzzles": 0,
        "stars": 0,
        "totalFoodCost": "0.00",
        "totalItems": 0,
        "totalRevenue": "0.00",
        "unclassified": 0,
      }
    `);
  });

  it("plate P&L: location cost for linked rows, stored cost for free-text rows, per serving with Q, one sale pack ignored", async () => {
    // Margherita: flour at the location cost 2 (not the stored 2.10), brandy at 44.125, free-text rows at their own cost.
    const margherita = await getPandLFoodCost(ids.Margherita);
    const pasta = await getPandLFoodCost(ids["Truffle Pasta"]);
    // No location: the stored food cost is returned untouched.
    await db.update(menuItem).set({ storeLocationId: null }).where(eq(menuItem.menuItemId, ids["House Salad"]));
    const noLocation = await getPandLFoodCost(ids["House Salad"]);
    expect({ margherita, pasta, noLocation }).toMatchInlineSnapshot(`
      {
        "margherita": 4.47,
        "noLocation": 5.94,
        "pasta": 19.61,
      }
    `);
  });

  it("a line changed by someone who may not see costs keeps the cost it had; anyone who may see them gets the catalogue's", async () => {
    const id = await item("Flambé", "Mains", "30");
    await addIngredient(id, chef, { ingredientId: brandyId, ingredientName: "Brandy", quantity: "100", unit: "mL", unitCost: "50" }); // a cost of this dish's own
    await addIngredient(id, chef, { ingredientName: "Sugar", quantity: "0.1", unit: "kg", unitCost: "3.2" });
    const blind = { keepHiddenCost: true };

    await addIngredient(id, chef, { ingredientId: brandyId, ingredientName: "Brandy", quantity: "0.2", unit: "L" }, blind); // per kitchen unit, so the line's unit may change
    await addIngredient(id, chef, { ingredientName: "Sugar", quantity: "0.2", unit: "kg" }, blind);
    await addIngredient(id, chef, { ingredientName: "Sugar", quantity: "200", unit: "g" }, blind); // $3.20 was per kg: not kept for g
    await addIngredient(id, chef, { ingredientName: "Salt", quantity: "1", unit: "kg" }, blind); // nothing to keep
    await addIngredient(id, chef, { ingredientName: "Sugar", quantity: "0.2", unit: "kg", unitCost: "4" }, blind); // a cost sent is used
    await addIngredient(id, chef, { ingredientId: brandyId, ingredientName: "Brandy", quantity: "0.2", unit: "L" });
    await addIngredient(id, chef, { ingredientName: "Sugar", quantity: "0.2", unit: "kg" });

    expect((await lineCosts("Flambé")).slice(2)).toEqual([
      "Brandy=10.00@50.0000", "Sugar=0.64@3.2000", "Sugar=0.00@0.0000", "Salt=0.00@0.0000", "Sugar=0.80@4.0000",
      "Brandy=8.25@41.2500", "Sugar=0.00@0.0000",
    ]);
  });
});

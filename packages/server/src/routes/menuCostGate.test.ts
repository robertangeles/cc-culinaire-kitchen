import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Owner's rule: menu food cost, margin, line costs and on-hand stock are for holders of `inventory:cost`. Everyone
 * else with `menu:read` (or `prep:read`, for the dish list) keeps the rest of the menu. The fields are left out, not
 * null, so an older app keeps parsing. Walks the real routers with services that answer every figure.
 */

// A bearer token here is just the payload as JSON; the real signature check is covered by the auth suites.
vi.mock("../services/authService.js", async (orig) => ({ ...(await orig<object>()), verifyAccessToken: (token: string) => JSON.parse(token) }));
vi.mock("../services/locationContextService.js", async (orig) => ({ ...(await orig<object>()), assertLocationAccess: vi.fn() }));
vi.mock("../services/menuAccess.js", async (orig) => ({
  ...(await orig<object>()),
  resolveMenuScope: async (userId: number) => ({ userId, organisationId: 7, isOrgAdmin: true }),
}));

const ITEM = {
  menuItemId: "m1", userId: 1, organisationId: 7, name: "Risotto", category: "mains", sellingPrice: "24.00", servings: 1, servingsPerSale: 1, qFactorPct: "5.00",
  foodCost: "6.00", foodCostPct: "25.00", contributionMargin: "18.00", unitsSold: 10, menuMixPct: "50.00", classification: "star",
};
const LINE = {
  id: 1, menuItemId: "m1", ingredientId: "i1", ingredientName: "Rice", note: null, quantity: "0.100", unit: "kg", unitCost: "4.0000", yieldPct: "100.00", lineCost: "0.40",
  costStaleInd: true, baseUnit: "kg", packQty: "5", catalogUnitCost: "4.2000",
};
const ANALYSIS = {
  totalItems: 1, stars: 1, plowhorses: 0, puzzles: 0, dogs: 0, unclassified: 0,
  avgFoodCostPct: "25.0", avgContributionMargin: "18.00", totalRevenue: "240.00", totalFoodCost: "60.00", overallFoodCostPct: "25.0",
  items: [{ ...ITEM, sellingPrice: 24, foodCost: 6, foodCostPct: 25, contributionMargin: 18, menuMixPct: 50 }],
};
const SALE = { saleId: "s1", depleted: [{ ingredientId: "i1", ingredientName: "Rice", baseQty: 0.1, baseUnit: "kg", fohOnHand: -2, oversold: true }], skipped: [], oversold: ["Rice"] };
const VARIANCE = {
  menuItemId: "m1", status: "ok", theoretical: 60, actual: 70, variance: 10, variancePct: 16.67, threshold: "alert", unitsSold: 10, consumptionLogCount: 4, periodStart: null, periodEnd: null,
};

const getPandLFoodCost = vi.fn(async (_id: string) => 6.4);
const getItemRecommendations = vi.fn(async (..._a: unknown[]) => ({ summary: "Protect it.", actions: [] }));
const addIngredient = vi.fn(async (..._a: unknown[]) => LINE);
vi.mock("../services/menuIntelligenceService.js", async (orig) => ({
  ...(await orig<object>()), // generateReplacementContext is the real one
  createMenuItem: async () => ITEM,
  getMenuItems: async () => [ITEM],
  requireMenuItem: async () => ITEM,
  requireManageableMenuItem: async () => ITEM,
  updateMenuItem: async () => {},
  deleteMenuItem: async () => {},
  addIngredient: (...a: unknown[]) => addIngredient(...a),
  getIngredients: async () => [LINE],
  deleteIngredient: async () => {},
  refreshIngredientCost: async () => LINE,
  getPandLFoodCost: (id: string) => getPandLFoodCost(id),
  getMenuAnalysis: async () => ANALYSIS,
  recalculateMenu: async () => {},
  getCategorySettings: async () => [{ categoryName: "mains", targetFoodCostPct: "30.00" }],
  upsertCategorySetting: async () => {},
  importCsvSalesData: async () => ({ updated: 0, notFound: [] }),
  getItemRecommendations: (...a: unknown[]) => getItemRecommendations(...a),
  getWasteImpactForMenuItems: async () => [{ menuItemId: "m1", wasteEstimate: 12 }],
}));
vi.mock("../services/yieldVarianceService.js", () => ({ getYieldVariance: async () => VARIANCE, listYieldVariance: async () => [VARIANCE] }));
vi.mock("../services/saleService.js", async (orig) => ({
  ...(await orig<object>()),
  recordSale: async () => SALE,
  recordConsumableSale: async () => SALE,
  voidSale: async () => ({ saleId: "s1", restored: 1 }),
  listSales: async () => [],
  listSellableConsumables: async () => [],
  previewSalesCsv: async () => ({ matched: [], unmatched: [] }),
  commitSalesCsv: async () => ({ succeeded: [], alreadyExists: [], failed: [] }),
}));
vi.mock("../services/prepService.js", async (orig) => ({
  ...(await orig<object>()),
  getMenuForSelection: async () => ({
    menuItems: [{ menuItemId: "m1", name: "Risotto", category: "mains", classification: "star", foodCostPct: 25, sellingPrice: 24 }],
    recipes: [],
    hasMenuItems: true,
  }),
}));

const { menuIntelligenceRouter } = await import("./menuIntelligence.js");
const { prepRouter } = await import("./prep.js");
const { errorHandler } = await import("../middleware/errorHandler.js");

/** Every figure the rule covers, by the name it has on the wire. */
const HIDDEN = [
  "foodCost", "foodCostPct", "contributionMargin", "unitCost", "lineCost", "catalogUnitCost", "fohOnHand",
  "avgFoodCostPct", "avgContributionMargin", "totalFoodCost", "overallFoodCostPct",
  "theoretical", "actual", "variance", "variancePct", "threshold",
];

const omit = (row: object, ...keys: string[]) => Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));
/** Every key anywhere in a JSON body. */
const keysOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap(keysOf) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : [];
const hiddenIn = (body: unknown) => [...new Set(keysOf(body).filter((k) => HIDDEN.includes(k)))].sort();

let server: Server;
const base = ["menu:read", "menu:manage", "prep:read"];
async function call(permissions: string[], method: string, path: string, body?: unknown, roles: string[] = []) {
  const csv = body === "csv";
  const form = new FormData();
  if (csv) form.append("file", new Blob(["name,qty\nRisotto,1"], { type: "text/csv" }), "s.csv");
  const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
    method,
    headers: { authorization: `Bearer ${JSON.stringify({ sub: 1, roles, permissions })}`, ...(csv ? {} : { "content-type": "application/json" }) },
    body: csv ? form : body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}
const holder = (method: string, path: string, body?: unknown) => call([...base, "inventory:cost"], method, path, body);
const other = (method: string, path: string, body?: unknown) => call(base, method, path, body);

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/menu", menuIntelligenceRouter);
  app.use("/api/prep", prepRouter);
  app.use(errorHandler);
  server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
});
afterAll(() => server?.close());
beforeEach(() => vi.clearAllMocks());

const newLine = { ingredientName: "Rice", quantity: "0.1", unit: "kg" };
/** [method, path, body, the figures a holder of `inventory:cost` gets]. */
const menuRoutes: Array<[string, string, unknown, string[]]> = [
  ["GET", "/items", undefined, ["contributionMargin", "foodCost", "foodCostPct"]],
  ["POST", "/items", { name: "Risotto", category: "mains", sellingPrice: "24.00" }, ["contributionMargin", "foodCost", "foodCostPct"]],
  ["PATCH", "/items/:id", { sellingPrice: "24.00" }, ["contributionMargin", "foodCost", "foodCostPct"]],
  ["DELETE", "/items/:id", undefined, []],
  ["GET", "/items/:id/ingredients", undefined, ["catalogUnitCost", "lineCost", "unitCost"]],
  ["POST", "/items/:id/ingredients", newLine, ["catalogUnitCost", "lineCost", "unitCost"]],
  ["DELETE", "/items/:id/ingredients/:ingredientId", undefined, []],
  ["POST", "/items/:id/ingredients/:ingredientId/refresh-cost", {}, ["catalogUnitCost", "lineCost", "unitCost"]],
  ["GET", "/items/:id/pandl-cost", undefined, ["foodCost"]],
  ["GET", "/analysis", undefined, ["avgContributionMargin", "avgFoodCostPct", "contributionMargin", "foodCost", "foodCostPct", "overallFoodCostPct", "totalFoodCost"]],
  ["POST", "/analysis/recalculate", {}, []],
  ["GET", "/categories", undefined, []],
  ["PUT", "/categories/:name", { targetFoodCostPct: "30" }, []],
  ["GET", "/items/:id/recommendations", undefined, []],
  ["POST", "/items/:id/generate-replacement", {}, []],
  ["GET", "/waste-impact", undefined, []],
  ["POST", "/import-sales", "csv", []],
  ["GET", "/yield-variance", undefined, ["actual", "theoretical", "threshold", "variance", "variancePct"]],
  ["GET", "/items/:id/yield-variance", undefined, ["actual", "theoretical", "threshold", "variance", "variancePct"]],
  ["POST", "/items/:id/sales", { qtySold: 1 }, ["fohOnHand"]],
  ["POST", "/sales/:saleId/void", {}, []],
  ["GET", "/locations/:locId/sales", undefined, []],
  ["POST", "/sales/import/preview", "csv", []],
  ["POST", "/sales/import/commit", { lines: [{ rowIndex: 1, name: "Risotto", qtySold: 1 }] }, []],
  ["GET", "/consumables", undefined, []],
  ["POST", "/consumables/:ingredientId/sales", { qtySold: 1 }, ["fohOnHand"]],
];
const url = (path: string) => `/api/menu${path.replace(/:(ingredientId)/, "1").replace(/:\w+/g, "x")}`;

describe("menu figures are for holders of inventory:cost", () => {
  it.each(menuRoutes)("%s %s leaves them out for anyone else", async (method, path, body) => {
    const res = await other(method, url(path), body);
    expect(res.status).toBeLessThan(300);
    expect(hiddenIn(res.body)).toEqual([]);
  });

  it.each(menuRoutes)("%s %s still sends them to a holder", async (method, path, body, expected) => {
    const res = await holder(method, url(path), body);
    expect(res.status).toBeLessThan(300);
    expect(hiddenIn(res.body)).toEqual(expected);
  });

  it("Administrator sees them without holding the key", async () => {
    const res = await call([], "GET", "/api/menu/items", undefined, ["Administrator"]);
    expect(res.body[0]).toMatchObject({ foodCost: "6.00", contributionMargin: "18.00" });
  });

  it("every route in the router is in the table, so a new route cannot skip the choice", () => {
    type Layer = { route?: { path: string; methods: Record<string, boolean> } };
    const routes = (menuIntelligenceRouter as unknown as { stack: Layer[] }).stack.flatMap((l) =>
      l.route ? Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route!.path}`) : [],
    );
    expect(routes.sort()).toEqual(menuRoutes.map(([m, p]) => `${m} ${p}`).sort());
  });
});

describe("everyone with menu:read keeps the rest of the menu", () => {
  it("items: price, servings, sales, mix and class", async () => {
    expect((await other("GET", "/api/menu/items")).body).toEqual([{ ...omit(ITEM, "foodCost", "foodCostPct", "contributionMargin"), canManage: true }]);
  });

  it("analysis: class counts, revenue and the items", async () => {
    const { body } = await other("GET", "/api/menu/analysis");
    expect(body).toMatchObject({ totalItems: 1, stars: 1, totalRevenue: "240.00", items: [{ name: "Risotto", sellingPrice: 24, menuMixPct: 50, classification: "star", canManage: true }] });
  });

  it("recipe lines: ingredient, quantity, unit, yield and packaging", async () => {
    expect((await other("GET", "/api/menu/items/x/ingredients")).body).toEqual([omit(LINE, "unitCost", "lineCost", "catalogUnitCost")]);
  });

  it("a sale: what was used and that it ran over, without what is left", async () => {
    expect((await other("POST", "/api/menu/items/x/sales", { qtySold: 1 })).body).toEqual({ ...SALE, depleted: [omit(SALE.depleted[0], "fohOnHand")] });
  });
});

describe("a hidden figure is not worked out either", () => {
  it("the P&L cost is not computed", async () => {
    expect((await other("GET", "/api/menu/items/m1/pandl-cost")).body).toEqual({ menuItemId: "m1" });
    expect(getPandLFoodCost).not.toHaveBeenCalled();
    expect((await holder("GET", "/api/menu/items/m1/pandl-cost")).body).toEqual({ menuItemId: "m1", foodCost: 6.4 });
  });

  it("the replacement request says the price, not the cost", async () => {
    const hidden = (await other("POST", "/api/menu/items/m1/generate-replacement", {})).body.request as string;
    expect(hidden).toContain('"Risotto" in the mains category');
    expect(hidden).toContain("classified as a star.");
    expect(hidden).not.toMatch(/25\.00|18\.00|food cost of|contribution margin of|undefined|unknown/);
    const seen = (await holder("POST", "/api/menu/items/m1/generate-replacement", {})).body.request as string;
    expect(seen).toContain("classified as a star with food cost of 25.00% and contribution margin of $18.00.");
  });

  it("the model is not given them for a caller who may not see them", async () => {
    await other("GET", "/api/menu/items/m1/recommendations");
    expect(getItemRecommendations).toHaveBeenLastCalledWith("m1", expect.anything(), { withCosts: false });
    await holder("GET", "/api/menu/items/m1/recommendations");
    expect(getItemRecommendations).toHaveBeenLastCalledWith("m1", expect.anything(), { withCosts: true });
  });
});

describe("changing a recipe line without seeing its cost", () => {
  it("a line sent without a cost keeps the hidden one only for a caller who cannot see it", async () => {
    await other("POST", "/api/menu/items/m1/ingredients", newLine);
    expect(addIngredient).toHaveBeenLastCalledWith("m1", expect.anything(), expect.objectContaining(newLine), { keepHiddenCost: true });
    await holder("POST", "/api/menu/items/m1/ingredients", newLine);
    expect(addIngredient).toHaveBeenLastCalledWith("m1", expect.anything(), expect.objectContaining(newLine), { keepHiddenCost: false });
  });
});

describe("GET /api/prep/menu lists the same dishes, under the same rule", () => {
  it("leaves the food cost % out without inventory:cost, and keeps price and class", async () => {
    const { body } = await other("GET", "/api/prep/menu");
    expect(body.menuItems).toEqual([{ menuItemId: "m1", name: "Risotto", category: "mains", classification: "star", sellingPrice: 24 }]);
    expect(body.hasMenuItems).toBe(true);
  });

  it("sends it to a holder", async () => {
    expect((await holder("GET", "/api/prep/menu")).body.menuItems[0].foodCostPct).toBe(25);
  });
});

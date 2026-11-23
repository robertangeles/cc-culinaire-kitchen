import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  ingredient, ingredientSupplier, locationIngredient, stockLevel, storeLocation, stockTakeSession, stockTakeCategory, stockTakeLine, supplier, user,
} from "../db/schema.js";
import { openSession, openOpeningCount, claimCategory, flagSession, approveSession } from "./stockTakeService.js";
import {
  handleSaveLineItem, handleGetCategoryLines, handleGetSessionDetail, handleGetPreviousLines, handleGetCountSheets,
  handleSubmitCategory, handleSubmitForReview, handleGetLocationDashboard, handleGetOrgDashboard, handleClaimCategory,
} from "../controllers/stockTakeController.js";
import {
  handleListIngredients, handleListIngredientSuppliers, handleListLocationIngredients, handleUpdateLocationIngredient,
} from "../controllers/ingredientController.js";
import { asUser, callHandler, createLineLoopFx, removeLineLoopFx, type LineLoopFx } from "./lineLoopFixture.js";

/**
 * Wave 3 stock-take and dashboard server work: stock reads take the back-of-house row only (a front-of-house
 * item is not counted twice), the dashboard's value and low/critical figures come from the server, cost and
 * expected quantities reach only holders of `inventory:cost`, the opening count is finished by a manager,
 * count-sheets serves a category count, and a flagged recount round goes back to review by itself.
 * Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

let fx: LineLoopFx;
let other: LineLoopFx;
let colaId = "";
let supplierId = "";

const COUNT = ["inventory:count"];
const COST = ["inventory:count", "inventory:cost"];
const HIDDEN = ["expectedQty", "varianceQty", "variancePct", "unitCost"];

async function removeSessions(orgId: number) {
  const sessions = (await db.select({ id: stockTakeSession.sessionId }).from(stockTakeSession).where(eq(stockTakeSession.organisationId, orgId))).map((r) => r.id);
  if (!sessions.length) return;
  const cats = (await db.select({ id: stockTakeCategory.categoryId }).from(stockTakeCategory).where(inArray(stockTakeCategory.sessionId, sessions))).map((r) => r.id);
  if (cats.length) await db.delete(stockTakeLine).where(inArray(stockTakeLine.categoryId, cats));
  await db.delete(stockTakeCategory).where(inArray(stockTakeCategory.sessionId, sessions));
  await db.delete(stockTakeSession).where(inArray(stockTakeSession.sessionId, sessions));
}

describe.skipIf(!RUN)("stock take and dashboard, Wave 3 (real DB)", () => {
  beforeAll(async () => {
    const tag = `w3st_${Date.now().toString(36)}`;
    fx = await createLineLoopFx(tag);
    other = await createLineLoopFx(`${tag}x`);
    [{ id: colaId }] = await db
      .insert(ingredient)
      .values({ organisationId: fx.orgId, ingredientName: `${tag}-cola`, ingredientCategory: "beverages", itemType: "FOH_CONSUMABLE", baseUnit: "each", unitCost: "2" })
      .returning({ id: ingredient.ingredientId });
    [{ id: supplierId }] = await db.insert(supplier).values({ organisationId: fx.orgId, supplierName: `${tag}-drinks` }).returning({ id: supplier.supplierId });
    await db.insert(ingredientSupplier).values({ ingredientId: colaId, supplierId, packCost: "28.8", costPerUnit: "1.2" });
    // Flour: 10 kg on hand, par 50 (critical), $3/kg here. Cola: 24 in the store room and 6 on the bar shelf, par 40 (low), $1.50 each.
    await db.update(locationIngredient).set({ parLevel: "50", unitCost: "3" }).where(and(eq(locationIngredient.ingredientId, fx.ingId), eq(locationIngredient.storeLocationId, fx.locA)));
    await db.insert(locationIngredient).values({ ingredientId: colaId, storeLocationId: fx.locA, activeInd: true, parLevel: "40", unitCost: "1.5" });
    await db.insert(stockLevel).values([
      { storeLocationId: fx.locA, ingredientId: colaId, zone: "BOH", currentQty: "24" },
      { storeLocationId: fx.locA, ingredientId: colaId, zone: "FOH", currentQty: "6" },
    ]);
    await db.update(user).set({ selectedLocationId: fx.locA }).where(eq(user.userId, fx.chef));
  });
  afterAll(async () => {
    await removeSessions(fx.orgId);
    await removeSessions(other.orgId);
    await db.delete(stockLevel).where(eq(stockLevel.ingredientId, colaId));
    await db.delete(ingredientSupplier).where(eq(ingredientSupplier.ingredientId, colaId));
    await db.delete(supplier).where(eq(supplier.supplierId, supplierId));
    await db.delete(locationIngredient).where(eq(locationIngredient.ingredientId, colaId));
    await db.delete(ingredient).where(eq(ingredient.ingredientId, colaId));
    await removeLineLoopFx(fx);
    await removeLineLoopFx(other);
  });

  // ─── Zone: back-of-house rows only ───────────────────────────

  it("the location item list has one row per item, with the store-room quantity and costs for a holder of inventory:cost", async () => {
    const out = await callHandler(handleListLocationIngredients, asUser(fx.chef, COST), { params: { locId: fx.locA } });
    const cola = out.body.filter((r: { ingredientId: string }) => r.ingredientId === colaId);
    expect(cola).toHaveLength(1);
    expect(Number(cola[0].currentQty)).toBe(24);
    expect(Number(cola[0].locationUnitCost)).toBe(1.5);
    expect(Number(cola[0].orgUnitCost)).toBe(2);
  });

  it("the location item list leaves out the book quantity and unit costs for someone without inventory:cost", async () => {
    const out = await callHandler(handleListLocationIngredients, asUser(fx.chef, COUNT), { params: { locId: fx.locA } });
    const cola = out.body.filter((r: { ingredientId: string }) => r.ingredientId === colaId);
    expect(cola).toHaveLength(1);
    expect(Number(cola[0].parLevel)).toBe(40);
    for (const k of ["currentQty", "locationUnitCost", "orgUnitCost"]) expect(cola[0]).not.toHaveProperty(k);
  });

  it("the catalogue list carries unit costs only for a holder of inventory:cost", async () => {
    const find = async (perms: string[]) =>
      (await callHandler(handleListIngredients, asUser(fx.chef, perms), { query: {} })).body.find((r: { ingredientId: string }) => r.ingredientId === colaId);

    expect(Number((await find(COST)).unitCost)).toBe(2);
    const blind = await find(COUNT);
    expect(blind.baseUnit).toBe("each");
    for (const k of ["unitCost", "preferredUnitCost"]) expect(blind).not.toHaveProperty(k);
  });

  it("an item's supplier list carries prices only for a holder of inventory:cost", async () => {
    const list = async (perms: string[]) => (await callHandler(handleListIngredientSuppliers, asUser(fx.chef, perms), { params: { id: colaId } })).body;

    expect(await list(COST)).toMatchObject([{ supplierId, packCost: expect.anything(), costPerUnit: expect.anything() }]);
    const blind = await list(COUNT);
    expect(blind).toMatchObject([{ supplierId }]);
    for (const k of ["packCost", "costPerUnit"]) expect(blind[0]).not.toHaveProperty(k);
  });

  it("the dashboard counts each item once and returns value and low/critical figures to a holder of inventory:cost", async () => {
    const out = await callHandler(handleGetLocationDashboard, asUser(fx.chef, COST), { params: { locId: fx.locA } });
    expect(out.status).toBe(200);
    expect(out.body.stockLevels.filter((r: { ingredientId: string }) => r.ingredientId === colaId)).toHaveLength(1);
    // Value counts every unit once, store room and shelf: flour 10 x 3 + cola (24 + 6) x 1.5.
    expect(out.body.stockSummary).toMatchObject({ stockValue: 75, lowCount: 1, criticalCount: 1 });
    expect(out.body.stockSummary.criticalIngredientIds).toEqual([fx.ingId]);
    expect(out.body.stockSummary.lowIngredientIds).toEqual([colaId]);
    expect(out.body.stockSummary.valueByCategory).toEqual(expect.arrayContaining([{ category: "dry_goods", value: 30 }, { category: "beverages", value: 45 }]));
  });

  it("the dashboard leaves out stock value for someone without inventory:cost, but keeps low/critical", async () => {
    const out = await callHandler(handleGetLocationDashboard, asUser(fx.chef, COUNT), { params: { locId: fx.locA } });
    expect(out.body.stockSummary).toMatchObject({ lowCount: 1, criticalCount: 1 });
    expect(out.body.stockSummary).not.toHaveProperty("stockValue");
    expect(out.body.stockSummary).not.toHaveProperty("valueByCategory");
    expect(out.body.stockLevels.length).toBeGreaterThan(0);
    for (const row of out.body.stockLevels) expect(row).not.toHaveProperty("currentQty");
  });

  it("another organisation's location dashboard is 404 NOT_FOUND", async () => {
    const out = await callHandler(handleGetLocationDashboard, asUser(other.boss, COST), { params: { locId: fx.locA } });
    expect(out).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
  });

  it("the organisation summary counts each item once and values store room plus shelf", async () => {
    const out = await callHandler(handleGetOrgDashboard, asUser(fx.boss, ["inventory:hq", "inventory:cost"]));
    const row = out.body.find((l: { storeLocationId: string }) => l.storeLocationId === fx.locA);
    expect(row).toMatchObject({ totalItems: 2, lowStock: 1, critical: 1, inventoryValue: 75 });
  });

  it("the organisation summary leaves out value for someone without inventory:cost", async () => {
    const out = await callHandler(handleGetOrgDashboard, asUser(fx.boss, ["inventory:hq"]));
    const row = out.body.find((l: { storeLocationId: string }) => l.storeLocationId === fx.locA);
    expect(row).toMatchObject({ totalItems: 2 });
    expect(row).not.toHaveProperty("inventoryValue");
  });

  it("fohParLevel is stored, and cleared with null", async () => {
    const send = (fohParLevel: string | null) =>
      callHandler(handleUpdateLocationIngredient, asUser(fx.boss, ["inventory:manage"]), { params: { locId: fx.locA, id: colaId }, body: { fohParLevel } });
    expect((await send("18")).body.fohParLevel).toBe("18");
    expect((await send(null)).body.fohParLevel).toBeNull();
  });

  // ─── A count: blind for counters, category sheets, the recount round ──

  describe("a category count at location A", () => {
    let sessionId = "";
    beforeAll(async () => {
      sessionId = (await openSession(fx.locA, fx.orgId, fx.boss, ["dry_goods", "beverages"])).sessionId;
      await claimCategory(sessionId, "dry_goods", fx.chef);
      await claimCategory(sessionId, "beverages", fx.chef);
    });

    const save = (perms: string[], cat: string, ingredientId: string, rawQty: number, countedUnit: string) =>
      callHandler(handleSaveLineItem, asUser(fx.chef, perms), { params: { id: sessionId, cat }, body: { ingredientId, rawQty, countedUnit } });

    it("a counter without inventory:cost gets no cost or expected quantity back from a line save", async () => {
      const out = await save(COUNT, "dry_goods", fx.ingId, 9, "kg");
      expect(out.status).toBe(200);
      for (const k of HIDDEN) expect(out.body).not.toHaveProperty(k);
      expect(Number(out.body.countedQty)).toBe(9);
    });

    it("a holder of inventory:cost gets the expected quantity, taken from the store room only", async () => {
      const out = await save(COST, "beverages", colaId, 20, "each");
      expect(Number(out.body.expectedQty)).toBe(24);
      expect(Number(out.body.varianceQty)).toBe(-4);
    });

    it("category lines and session detail carry cost and expected figures only for inventory:cost", async () => {
      const blind = await callHandler(handleGetCategoryLines, asUser(fx.chef, COUNT), { params: { id: sessionId, cat: "beverages" } });
      const full = await callHandler(handleGetCategoryLines, asUser(fx.chef, COST), { params: { id: sessionId, cat: "beverages" } });
      for (const k of HIDDEN) expect(blind.body[0]).not.toHaveProperty(k);
      expect(Number(full.body[0].unitCost)).toBe(1.5);

      const detail = await callHandler(handleGetSessionDetail, asUser(fx.chef, COUNT), { params: { id: sessionId } });
      const lines = detail.body.categories.flatMap((c: { lines: object[] }) => c.lines);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) for (const k of HIDDEN) expect(line).not.toHaveProperty(k);
    });

    it("count-sheets serves a category count: one sheet per category with its items", async () => {
      const out = await callHandler(handleGetCountSheets, asUser(fx.chef, COUNT), { params: { id: sessionId } });
      expect(out.status).toBe(200);
      const byName = Object.fromEntries(out.body.areas.map((a: { categoryName: string; items: Array<{ ingredientId: string }> }) => [a.categoryName, a.items.map((i) => i.ingredientId)]));
      expect(byName.dry_goods).toEqual(expect.arrayContaining([fx.ingId, fx.ingNoStockId]));
      expect(byName.beverages).toEqual([colaId]);
    });

    it("count-sheets of another organisation's session is 404 NOT_FOUND", async () => {
      const out = await callHandler(handleGetCountSheets, asUser(other.chef, COUNT), { params: { id: sessionId } });
      expect(out).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
    });

    it("a flagged recount round goes back to review by itself once the flagged category is submitted again", async () => {
      await callHandler(handleSubmitCategory, asUser(fx.chef, COUNT), { params: { id: sessionId, cat: "dry_goods" } });
      await callHandler(handleSubmitCategory, asUser(fx.chef, COUNT), { params: { id: sessionId, cat: "beverages" } });
      const status = async () => (await db.select({ s: stockTakeSession.sessionStatus }).from(stockTakeSession).where(eq(stockTakeSession.sessionId, sessionId)))[0].s;
      expect(await status()).toBe("PENDING_REVIEW");

      await flagSession(sessionId, ["beverages"], "Cola looks short", fx.orgId);
      expect(await status()).toBe("FLAGGED");

      expect((await callHandler(handleClaimCategory, asUser(fx.chef, COUNT), { params: { id: sessionId, cat: "beverages" } })).status).toBe(200);
      await save(COUNT, "beverages", colaId, 23, "each");
      await callHandler(handleSubmitCategory, asUser(fx.chef, COUNT), { params: { id: sessionId, cat: "beverages" } });
      expect(await status()).toBe("PENDING_REVIEW");

      await approveSession(sessionId, fx.boss, fx.orgId);
      expect(await status()).toBe("APPROVED");
    });

    it("previous-lines carries no cost or expected quantity for a counter", async () => {
      const out = await callHandler(handleGetPreviousLines, asUser(fx.chef, COUNT), { params: { cat: "beverages" } });
      expect(out.body).toHaveLength(1);
      for (const k of HIDDEN) expect(out.body[0]).not.toHaveProperty(k);
    });
  });

  // ─── Opening inventory ───────────────────────────────────────

  describe("an opening count at location B", () => {
    let sessionId = "";
    beforeAll(async () => {
      await db.update(storeLocation).set({ inventoryActive: false }).where(eq(storeLocation.storeLocationId, fx.locB));
      await db.insert(locationIngredient).values([
        { ingredientId: fx.ingId, storeLocationId: fx.locB, activeInd: true },
        { ingredientId: colaId, storeLocationId: fx.locB, activeInd: true },
      ]);
      sessionId = (await openOpeningCount(fx.locB, fx.orgId, fx.boss)).sessionId;
    });

    const roamer = (perms: string[]) => asUser(fx.roamer, perms);
    const sessionRow = async () => (await db.select().from(stockTakeSession).where(eq(stockTakeSession.sessionId, sessionId)))[0];

    it("submitting one category leaves the opening count open, so the next category can still be claimed", async () => {
      await callHandler(handleClaimCategory, roamer(COUNT), { params: { id: sessionId, cat: "dry_goods" } });
      await callHandler(handleSaveLineItem, roamer(COUNT), { params: { id: sessionId, cat: "dry_goods" }, body: { ingredientId: fx.ingId, rawQty: 5, countedUnit: "kg" } });
      await callHandler(handleSubmitCategory, roamer(COUNT), { params: { id: sessionId, cat: "dry_goods" } });
      expect((await sessionRow()).sessionStatus).toBe("OPEN");

      const claim = await callHandler(handleClaimCategory, roamer(COUNT), { params: { id: sessionId, cat: "beverages" } });
      expect(claim.status).toBe(200);
      await callHandler(handleSaveLineItem, roamer(COUNT), { params: { id: sessionId, cat: "beverages" }, body: { ingredientId: colaId, rawQty: 12, countedUnit: "each" } });
      await callHandler(handleSubmitCategory, roamer(COUNT), { params: { id: sessionId, cat: "beverages" } });
      expect((await sessionRow()).sessionStatus).toBe("OPEN");
    });

    it("a counter cannot finish the opening count: 403 FORBIDDEN", async () => {
      const out = await callHandler(handleSubmitForReview, roamer(COUNT), { params: { id: sessionId } });
      expect(out).toMatchObject({ status: 403, body: { code: "FORBIDDEN" } });
      expect((await sessionRow()).sessionStatus).toBe("OPEN");
    });

    it("a manager finishes it: approved, the location's inventory goes live", async () => {
      const out = await callHandler(handleSubmitForReview, roamer(["inventory:count", "inventory:manage"]), { params: { id: sessionId } });
      expect(out.status).toBe(200);
      expect(out.body.sessionStatus).toBe("APPROVED");
      const [loc] = await db.select({ live: storeLocation.inventoryActive }).from(storeLocation).where(eq(storeLocation.storeLocationId, fx.locB));
      expect(loc.live).toBe(true);
    });

    it("an opening count the old auto-advance left in review can still be finished by a manager", async () => {
      await db.update(storeLocation).set({ inventoryActive: false }).where(eq(storeLocation.storeLocationId, other.locA));
      const stuck = (await openOpeningCount(other.locA, other.orgId, other.boss)).sessionId;
      // What the old auto-advance did after the first category was submitted.
      await db.update(stockTakeCategory).set({ categoryStatus: "SUBMITTED" }).where(eq(stockTakeCategory.sessionId, stuck));
      await db.update(stockTakeSession).set({ sessionStatus: "PENDING_REVIEW" }).where(eq(stockTakeSession.sessionId, stuck));

      const out = await callHandler(handleSubmitForReview, asUser(other.chef, ["inventory:count", "inventory:manage"]), { params: { id: stuck } });
      expect(out.body.sessionStatus).toBe("APPROVED");
    });
  });
});

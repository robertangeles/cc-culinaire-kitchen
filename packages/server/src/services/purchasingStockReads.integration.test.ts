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
  fifoBatch, locationIngredient, menuItem, menuItemIngredient, orderGuide, orderGuideItem, purchaseOrder, purchaseOrderLine,
  receivingLine, receivingSession, stockLevel, supplier,
} from "../db/schema.js";
import { createGuide, setGuideItems, getGuideItems } from "./orderGuideService.js";
import * as receivingService from "./receivingService.js";
import { clonePO, receiveLine } from "./purchaseOrderService.js";
import { handleGetPODetail, handleListPOs } from "../controllers/purchaseOrderController.js";
import { handleCreateSession, handleGenerateFromSelections, handleSaveSelections } from "../controllers/prepController.js";
import { asUser, callHandler, createLineLoopFx, removeLineLoopFx, type LineLoopFx } from "./lineLoopFixture.js";

/**
 * Purchasing, receiving and prep read the store room, not the bar shelf: an item with a back-of-house and a
 * front-of-house stock row is listed once, with the store-room quantity. And a purchase order shows its prices
 * only to someone who buys, receives or holds `inventory:cost`.
 * Flour here: 10 kg in the store room, 3 kg on the shelf, par 12.
 * Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

let fx: LineLoopFx;
let supplierId = "";
let guideId = "";

const zoneQty = async (zone: "BOH" | "FOH") => {
  const [row] = await db
    .select({ q: stockLevel.currentQty })
    .from(stockLevel)
    .where(and(eq(stockLevel.storeLocationId, fx.locA), eq(stockLevel.ingredientId, fx.ingId), eq(stockLevel.zone, zone)));
  return Number(row.q);
};

/** A purchase order for 5 kg of flour at $2, total $10. */
async function flourPO(status: string) {
  const [po] = await db
    .insert(purchaseOrder)
    .values({
      organisationId: fx.orgId, storeLocationId: fx.locA, supplierId, poNumber: `${fx.tag}-${status}-${Date.now().toString(36)}`.slice(0, 50),
      status, totalValue: "10", createdByUserId: fx.chef,
    })
    .returning({ id: purchaseOrder.poId });
  const [line] = await db
    .insert(purchaseOrderLine)
    .values({ poId: po.id, ingredientId: fx.ingId, orderedQty: "5", orderedUnit: "kg", unitCost: "2" })
    .returning({ id: purchaseOrderLine.lineId });
  return { poId: po.id, lineId: line.id };
}

describe.skipIf(!RUN)("purchasing, receiving and prep stock reads (real DB)", () => {
  beforeAll(async () => {
    fx = await createLineLoopFx(`psr_${Date.now().toString(36)}`);
    await db.insert(stockLevel).values({ storeLocationId: fx.locA, ingredientId: fx.ingId, zone: "FOH", currentQty: "3" });
    await db.update(locationIngredient).set({ parLevel: "12" }).where(and(eq(locationIngredient.ingredientId, fx.ingId), eq(locationIngredient.storeLocationId, fx.locA)));
    [{ id: supplierId }] = await db.insert(supplier).values({ organisationId: fx.orgId, supplierName: `${fx.tag}-mill` }).returning({ id: supplier.supplierId });
  });
  afterAll(async () => {
    if (guideId) {
      await db.delete(orderGuideItem).where(eq(orderGuideItem.orderGuideId, guideId));
      await db.delete(orderGuide).where(eq(orderGuide.orderGuideId, guideId));
    }
    const poIds = (await db.select({ id: purchaseOrder.poId }).from(purchaseOrder).where(eq(purchaseOrder.organisationId, fx.orgId))).map((r) => r.id);
    if (poIds.length) {
      const sessions = (await db.select({ id: receivingSession.sessionId }).from(receivingSession).where(inArray(receivingSession.poId, poIds))).map((r) => r.id);
      if (sessions.length) {
        await db.delete(receivingLine).where(inArray(receivingLine.sessionId, sessions));
        await db.delete(receivingSession).where(inArray(receivingSession.sessionId, sessions));
      }
      await db.delete(fifoBatch).where(eq(fifoBatch.ingredientId, fx.ingId));
      await db.delete(purchaseOrderLine).where(inArray(purchaseOrderLine.poId, poIds));
      await db.delete(purchaseOrder).where(inArray(purchaseOrder.poId, poIds));
    }
    if (supplierId) await db.delete(supplier).where(eq(supplier.supplierId, supplierId));
    await removeLineLoopFx(fx);
  });

  // ─── Zone: back-of-house rows only ───────────────────────────

  it("an order guide lists the item once, with the store-room quantity on hand", async () => {
    const guide = await createGuide(fx.orgId, fx.chef, { supplierId, storeLocationId: fx.locA, name: "Weekly dry goods" });
    guideId = guide.orderGuideId;
    await setGuideItems(guideId, fx.orgId, [{ ingredientId: fx.ingId, sortOrder: 0 }]);

    const items = await getGuideItems(guideId, fx.orgId, fx.locA);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ ingredientId: fx.ingId, onHand: 10, suggestedOrderQty: 2 });
  });

  it("a receiving session lists the line once, with the store-room quantity on hand", async () => {
    const { poId } = await flourPO("SENT");

    const started = await receivingService.startSession(poId, fx.locA, fx.chef, fx.orgId);

    expect(started.lines).toHaveLength(1);
    expect(Number(started.lines[0].stockOnHand)).toBe(10);
    const again = await receivingService.getSession(started.session.sessionId, fx.orgId);
    expect(again!.lines).toHaveLength(1);
  });

  it("a cloned purchase order tops up to par from the store-room quantity", async () => {
    const { poId } = await flourPO("SENT");

    const clone = await clonePO(poId, fx.orgId, fx.locA, fx.chef);

    // Par 12 less 10 in the store room; the 3 on the shelf would give 9.
    expect(clone.lines).toHaveLength(1);
    expect(Number(clone.lines[0].orderedQty)).toBe(2);
  });

  it("a prep list takes on-hand from the store room", async () => {
    const chef = asUser(fx.chef, ["prep:manage", "prep:read"]);
    const [dish] = await db
      .insert(menuItem)
      .values({ userId: fx.chef, name: `${fx.tag}-dish`, category: "mains", sellingPrice: "10", servings: 1 })
      .returning({ id: menuItem.menuItemId });
    await db.insert(menuItemIngredient).values({ menuItemId: dish.id, ingredientId: fx.ingId, ingredientName: "Flour", quantity: "1", unit: "kg", unitCost: "2", yieldPct: "100" });
    const created = await callHandler(handleCreateSession, chef, { body: { prepDate: "2026-04-10", storeLocationId: fx.locA } });
    const id = created.body.session.prepSessionId;
    await callHandler(handleSaveSelections, chef, { params: { id }, body: { selections: [{ menuItemId: dish.id, dishName: `${fx.tag}-dish`, expectedPortions: 4 }] } });

    const out = await callHandler(handleGenerateFromSelections, chef, { params: { id }, body: {} });

    expect(out.status).toBe(201);
    expect(out.body).toHaveLength(1);
    expect(Number(out.body[0].onHandQty)).toBe(10);
  });

  it("receiving a purchase order line adds to the store room and leaves the shelf alone", async () => {
    const { poId, lineId } = await flourPO("SUBMITTED");
    const before = await zoneQty("BOH");

    await receiveLine(poId, lineId, "4", "kg", null, fx.chef, fx.orgId);

    expect(await zoneQty("BOH")).toBe(before + 4);
    expect(await zoneQty("FOH")).toBe(3);
  });

  // ─── Prices on a purchase order ──────────────────────────────

  it.each([
    ["inventory:cost", ["inventory:count", "inventory:cost"]],
    ["a purchasing key", ["inventory:count", "purchasing:draft"]],
    ["only purchasing:receive", ["purchasing:receive"]],
  ])("a purchase order carries its prices for a holder of %s", async (_name, permissions) => {
    const { poId } = await flourPO("SENT");

    const detail = await callHandler(handleGetPODetail, asUser(fx.chef, permissions), { params: { id: poId } });
    const list = await callHandler(handleListPOs, asUser(fx.chef, permissions), { query: { storeLocationId: fx.locA } });

    expect(Number(detail.body.totalValue)).toBe(10);
    expect(Number(detail.body.lines[0].unitCost)).toBe(2);
    expect(Number((list.body as unknown as Array<{ poId: string; totalValue: string }>).find((p) => p.poId === poId)!.totalValue)).toBe(10);
  });

  it("a purchase order carries no prices for a counter without inventory:cost or a purchasing key", async () => {
    const { poId } = await flourPO("SENT");
    const counter = asUser(fx.chef, ["inventory:count"]);

    const detail = await callHandler(handleGetPODetail, counter, { params: { id: poId } });
    const list = await callHandler(handleListPOs, counter, { query: { storeLocationId: fx.locA } });

    expect(detail.status).toBe(200);
    expect(detail.body.lines).toMatchObject([{ ingredientId: fx.ingId, orderedUnit: "kg" }]);
    expect(Number(detail.body.lines[0].orderedQty)).toBe(5);
    expect(detail.body).not.toHaveProperty("totalValue");
    for (const k of ["unitCost", "actualUnitCost"]) expect(detail.body.lines[0]).not.toHaveProperty(k);
    const listed = (list.body as unknown as Array<Record<string, unknown>>).find((p) => p.poId === poId)!;
    expect(listed).toBeTruthy();
    expect(listed).not.toHaveProperty("totalValue");
  });
});

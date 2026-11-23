import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import {
  ingredient, locationIngredient, stockLevel, inventoryTransfer, inventoryTransferLine, fifoBatch, fohSale, fohRestock,
  consumptionLog, pendingCatalogRequest,
} from "../db/schema.js";
import * as transferController from "../controllers/transferController.js";
import { handleRecordSales, handleRestockFoh, handleLogFohWaste, handleCountFoh } from "../controllers/fohController.js";
import { handleRequestNewItem } from "../controllers/catalogRequestController.js";
import { asUser, callHandler, createLineLoopFx, removeLineLoopFx, type LineLoopFx } from "./lineLoopFixture.js";

/**
 * Wave 3 store room and bar writes, made safe for a phone that queues offline and retries: transfers,
 * front-of-house sales, restock, waste and count, and catalogue requests. A client-made id means a repeat is
 * not a second effect; refusals carry a code; another organisation can neither read nor write.
 * Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

let fx: LineLoopFx;
let other: LineLoopFx;
let colaId = "";

const MANAGE = ["inventory:count", "inventory:manage"];
const SALES = ["sales:record"];
const zoneQty = async (locId: string, ingredientId: string, zone: "BOH" | "FOH") => {
  const [row] = await db
    .select({ q: stockLevel.currentQty })
    .from(stockLevel)
    .where(and(eq(stockLevel.storeLocationId, locId), eq(stockLevel.ingredientId, ingredientId), eq(stockLevel.zone, zone)));
  return row ? Number(row.q) : 0;
};

async function removeExtras(f: LineLoopFx, extraIngredients: string[]) {
  const transfers = (await db.select({ id: inventoryTransfer.transferId }).from(inventoryTransfer).where(eq(inventoryTransfer.organisationId, f.orgId))).map((r) => r.id);
  if (transfers.length) {
    await db.delete(inventoryTransferLine).where(inArray(inventoryTransferLine.transferId, transfers));
    await db.delete(fifoBatch).where(inArray(fifoBatch.sourceTransferId, transfers));
    await db.delete(inventoryTransfer).where(inArray(inventoryTransfer.transferId, transfers));
  }
  await db.delete(fohSale).where(eq(fohSale.organisationId, f.orgId));
  await db.delete(fohRestock).where(eq(fohRestock.organisationId, f.orgId));
  await db.delete(consumptionLog).where(eq(consumptionLog.organisationId, f.orgId));
  await db.delete(pendingCatalogRequest).where(eq(pendingCatalogRequest.organisationId, f.orgId));
  for (const id of extraIngredients) {
    await db.delete(stockLevel).where(eq(stockLevel.ingredientId, id));
    await db.delete(locationIngredient).where(eq(locationIngredient.ingredientId, id));
    await db.delete(ingredient).where(eq(ingredient.ingredientId, id));
  }
  await db.delete(stockLevel).where(inArray(stockLevel.storeLocationId, [f.locA, f.locB]));
}

describe.skipIf(!RUN)("store room and bar retries (real DB)", () => {
  beforeAll(async () => {
    const tag = `w3_${Date.now().toString(36)}`;
    fx = await createLineLoopFx(tag);
    other = await createLineLoopFx(`${tag}x`);
    [{ id: colaId }] = await db
      .insert(ingredient)
      .values({ organisationId: fx.orgId, ingredientName: `${tag}-cola`, ingredientCategory: "beverages", itemType: "FOH_CONSUMABLE", baseUnit: "each" })
      .returning({ id: ingredient.ingredientId });
    await db.insert(locationIngredient).values({ ingredientId: colaId, storeLocationId: fx.locA, activeInd: true, fohParLevel: "12" });
    await db.insert(stockLevel).values({ storeLocationId: fx.locA, ingredientId: colaId, zone: "BOH", currentQty: "100" });
  });
  afterAll(async () => {
    await removeExtras(fx, [colaId]);
    await removeExtras(other, []);
    await removeLineLoopFx(fx);
    await removeLineLoopFx(other);
  });

  // ─── Transfers ────────────────────────────────────────────────

  const createBody = (extra: object = {}) => ({
    fromLocationId: fx.locA,
    toLocationId: fx.locB,
    lines: [{ ingredientId: fx.ingId, sentQty: 2, sentUnit: "kg" }],
    ...extra,
  });

  it("transfer create: a repeat of the same transferId makes one transfer with one set of lines", async () => {
    const transferId = randomUUID();
    const first = await callHandler(transferController.handleInitiateTransfer, asUser(fx.chef, MANAGE), { body: createBody({ transferId }) });
    const again = await callHandler(transferController.handleInitiateTransfer, asUser(fx.chef, MANAGE), { body: createBody({ transferId }) });

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.transferId).toBe(transferId);
    expect(again.body.lines).toHaveLength(1);
    expect(await db.select().from(inventoryTransferLine).where(eq(inventoryTransferLine.transferId, transferId))).toHaveLength(1);
  });

  it("transfer create: an id another user's transfer holds is 409 CONFLICT", async () => {
    const transferId = randomUUID();
    await callHandler(transferController.handleInitiateTransfer, asUser(fx.chef, MANAGE), { body: createBody({ transferId }) });
    const out = await callHandler(transferController.handleInitiateTransfer, asUser(fx.roamer, MANAGE), { body: createBody({ transferId }) });
    expect(out).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
  });

  it("transfer create: a transferId that is not a UUID is 400 VALIDATION", async () => {
    const out = await callHandler(transferController.handleInitiateTransfer, asUser(fx.chef, MANAGE), { body: createBody({ transferId: "abc" }) });
    expect(out).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
  });

  it("transfer create: a destination in another organisation is refused with a code and writes nothing", async () => {
    const transferId = randomUUID();
    const out = await callHandler(transferController.handleInitiateTransfer, asUser(fx.chef, MANAGE), { body: createBody({ transferId, toLocationId: other.locA }) });
    expect(out).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
    expect(await db.select().from(inventoryTransfer).where(eq(inventoryTransfer.transferId, transferId))).toHaveLength(0);
  });

  it("transfer create: every refusal carries a code (missing lines, same location, bad quantity)", async () => {
    const who = asUser(fx.roamer, MANAGE);
    expect(await callHandler(transferController.handleInitiateTransfer, who, { body: createBody({ lines: [] }) })).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
    expect(await callHandler(transferController.handleInitiateTransfer, who, { body: createBody({ toLocationId: fx.locA }) })).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
    expect(
      await callHandler(transferController.handleInitiateTransfer, who, { body: createBody({ lines: [{ ingredientId: fx.ingId, sentQty: -1, sentUnit: "kg" }] }) }),
    ).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
  });

  it("transfer: another organisation cannot read, send or receive it (404 NOT_FOUND)", async () => {
    const t = await callHandler(transferController.handleInitiateTransfer, asUser(fx.chef, MANAGE), { body: createBody() });
    const outsider = asUser(other.boss, [...MANAGE, "inventory:hq"]);
    const params = { id: t.body.transferId };
    expect(await callHandler(transferController.handleGetTransferDetail, outsider, { params })).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
    expect(await callHandler(transferController.handleConfirmSent, outsider, { params })).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
    expect(await callHandler(transferController.handleConfirmReceived, outsider, { params, body: { receivedLines: [] } })).toMatchObject({
      status: 404,
      body: { code: "NOT_FOUND" },
    });
  });

  async function sentTransfer() {
    const t = await callHandler(transferController.handleInitiateTransfer, asUser(fx.chef, MANAGE), { body: createBody() });
    await callHandler(transferController.handleConfirmSent, asUser(fx.chef, MANAGE), { params: { id: t.body.transferId } });
    return t.body as { transferId: string; lines: Array<{ lineId: string }> };
  }

  it("transfer receive: two receives at once add the stock once; the loser answers 409 ALREADY_CONFIRMED", async () => {
    const t = await sentTransfer();
    const before = await zoneQty(fx.locB, fx.ingId, "BOH");
    const receive = () =>
      callHandler(transferController.handleConfirmReceived, asUser(fx.roamer, ["inventory:count"]), {
        params: { id: t.transferId },
        body: { receivedLines: [{ lineId: t.lines[0].lineId, receivedQty: 2 }] },
      });
    const outs = await Promise.all([receive(), receive()]);

    expect(outs.map((o) => o.status).sort()).toEqual([200, 409]);
    expect(outs.find((o) => o.status === 409)!.body.code).toBe("ALREADY_CONFIRMED");
    expect(await zoneQty(fx.locB, fx.ingId, "BOH")).toBe(before + 2);
  });

  it("transfer receive: a line from another transfer, or a bad quantity, is 400 VALIDATION and receives nothing", async () => {
    const t = await sentTransfer();
    const elsewhere = await sentTransfer();
    const before = await zoneQty(fx.locB, fx.ingId, "BOH");
    const receive = (receivedLines: object[]) =>
      callHandler(transferController.handleConfirmReceived, asUser(fx.roamer, ["inventory:count"]), { params: { id: t.transferId }, body: { receivedLines } });

    expect(await receive([{ lineId: elsewhere.lines[0].lineId, receivedQty: 2 }])).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
    expect(await receive([{ lineId: t.lines[0].lineId, receivedQty: -3 }])).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
    expect(await receive([{ lineId: t.lines[0].lineId, receivedQty: "lots" }])).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
    expect(await zoneQty(fx.locB, fx.ingId, "BOH")).toBe(before);
    const [row] = await db.select({ s: inventoryTransfer.status }).from(inventoryTransfer).where(eq(inventoryTransfer.transferId, t.transferId));
    expect(row.s).toBe("SENT");
  });

  it("transfer add-lines: an item already on the transfer is 409 CONFLICT, not a 500", async () => {
    const t = await callHandler(transferController.handleInitiateTransfer, asUser(fx.chef, MANAGE), { body: createBody() });
    const out = await callHandler(transferController.handleAddLines, asUser(fx.chef, MANAGE), {
      params: { id: t.body.transferId },
      body: { lines: [{ ingredientId: fx.ingId, sentQty: 1, sentUnit: "kg" }] },
    });
    expect(out).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
  });

  // ─── Front of house ──────────────────────────────────────────

  it("FOH restock: a repeat of the same fohRestockId moves the stock once", async () => {
    const fohRestockId = randomUUID();
    const bohBefore = await zoneQty(fx.locA, colaId, "BOH");
    const fohBefore = await zoneQty(fx.locA, colaId, "FOH");
    const send = () =>
      callHandler(handleRestockFoh, asUser(fx.chef, SALES), { params: { locId: fx.locA }, body: { fohRestockId, ingredientId: colaId, quantity: 6 } });
    const first = await send();
    const again = await send();

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ fohRestockId, moved: 6 });
    expect(await zoneQty(fx.locA, colaId, "BOH")).toBe(bohBefore - 6);
    expect(await zoneQty(fx.locA, colaId, "FOH")).toBe(fohBefore + 6);
  });

  it("FOH restock: an id another user's restock holds is 409 CONFLICT; refusals carry codes", async () => {
    const fohRestockId = randomUUID();
    await callHandler(handleRestockFoh, asUser(fx.chef, SALES), { params: { locId: fx.locA }, body: { fohRestockId, ingredientId: colaId, quantity: 1 } });
    const send = (who: number, body: object) => callHandler(handleRestockFoh, asUser(who, SALES), { params: { locId: fx.locA }, body });

    expect(await send(fx.cook, { fohRestockId, ingredientId: colaId, quantity: 1 })).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
    expect(await send(fx.cook, { ingredientId: colaId, quantity: 0 })).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
    expect(await send(fx.cook, { ingredientId: colaId, quantity: 100000 })).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
    expect(await send(fx.cook, { ingredientId: fx.ingId, quantity: 1 })).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
    expect(await send(fx.cook, { ingredientId: randomUUID(), quantity: 1 })).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
  });

  it("FOH sales: a repeat of the same fohSaleIds records each sale once and deducts once", async () => {
    const fohBefore = await zoneQty(fx.locA, colaId, "FOH");
    const lines = [
      { fohSaleId: randomUUID(), ingredientId: colaId, quantity: 2, unitPrice: 3 },
      { fohSaleId: randomUUID(), ingredientId: colaId, quantity: 1 },
    ];
    const send = () => callHandler(handleRecordSales, asUser(fx.chef, SALES), { params: { locId: fx.locA }, body: { lines } });
    const first = await send();
    const again = await send();

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.recorded.map((r: { fohSaleId: string }) => r.fohSaleId)).toEqual(lines.map((l) => l.fohSaleId));
    expect(await db.select().from(fohSale).where(inArray(fohSale.fohSaleId, lines.map((l) => l.fohSaleId)))).toHaveLength(2);
    expect(await zoneQty(fx.locA, colaId, "FOH")).toBe(fohBefore - 3);
  });

  it("FOH sales: a line whose id another user's sale holds is rejected with CONFLICT; a bad line carries a code", async () => {
    const fohSaleId = randomUUID();
    await callHandler(handleRecordSales, asUser(fx.chef, SALES), { params: { locId: fx.locA }, body: { lines: [{ fohSaleId, ingredientId: colaId, quantity: 1 }] } });
    const out = await callHandler(handleRecordSales, asUser(fx.cook, SALES), {
      params: { locId: fx.locA },
      body: { lines: [{ fohSaleId, ingredientId: colaId, quantity: 1 }, { ingredientId: fx.ingId, quantity: 1 }] },
    });
    expect(out.body.rejected.map((r: { code: string }) => r.code)).toEqual(["CONFLICT", "VALIDATION"]);
    expect(await db.select().from(fohSale).where(eq(fohSale.fohSaleId, fohSaleId))).toHaveLength(1);
  });

  it("FOH sales: a fohSaleId that is not a UUID is 400 VALIDATION", async () => {
    const send = (lines: object[]) => callHandler(handleRecordSales, asUser(fx.chef, SALES), { params: { locId: fx.locA }, body: { lines } });
    expect(await send([{ fohSaleId: "x", ingredientId: colaId, quantity: 1 }])).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
  });

  it("FOH sales: a long import (the web's CSV) is taken whole", async () => {
    const out = await callHandler(handleRecordSales, asUser(fx.chef, SALES), {
      params: { locId: fx.locA },
      body: { lines: Array.from({ length: 501 }, () => ({ ingredientId: colaId, quantity: 1 })) },
    });
    expect(out.status).toBe(201);
    expect(out.body.recorded).toHaveLength(501);
  });

  it("FOH waste: a repeat of the same consumptionLogId logs once and deducts the shelf once", async () => {
    const consumptionLogId = randomUUID();
    const fohBefore = await zoneQty(fx.locA, colaId, "FOH");
    const send = () =>
      callHandler(handleLogFohWaste, asUser(fx.chef, SALES), { params: { locId: fx.locA }, body: { consumptionLogId, ingredientId: colaId, quantity: 1, unit: "each" } });
    const first = await send();
    const again = await send();

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.consumptionLogId).toBe(consumptionLogId);
    expect(await zoneQty(fx.locA, colaId, "FOH")).toBe(fohBefore - 1);
  });

  it("FOH count: a count made before a later sale is 409 FOH_COUNT_STALE and does not overwrite it", async () => {
    const countedAt = new Date(Date.now() - 60_000).toISOString();
    await callHandler(handleRecordSales, asUser(fx.chef, SALES), { params: { locId: fx.locA }, body: { lines: [{ ingredientId: colaId, quantity: 1 }] } });
    const fohAfterSale = await zoneQty(fx.locA, colaId, "FOH");
    const out = await callHandler(handleCountFoh, asUser(fx.chef, SALES), { params: { locId: fx.locA }, body: { ingredientId: colaId, countedQty: 40, countedAt } });

    expect(out).toMatchObject({ status: 409, body: { code: "FOH_COUNT_STALE" } });
    expect(await zoneQty(fx.locA, colaId, "FOH")).toBe(fohAfterSale);
  });

  it("FOH count: a repeat of an applied count after a later sale changes nothing and answers success", async () => {
    const countedAt = new Date().toISOString();
    const count = () => callHandler(handleCountFoh, asUser(fx.chef, SALES), { params: { locId: fx.locA }, body: { ingredientId: colaId, countedQty: 9, countedAt } });
    expect((await count()).status).toBe(200);
    await callHandler(handleRecordSales, asUser(fx.chef, SALES), { params: { locId: fx.locA }, body: { lines: [{ ingredientId: colaId, quantity: 2 }] } });
    const again = await count();

    expect(again.status).toBe(200);
    expect(again.body.replay).toBe(true);
    expect(await zoneQty(fx.locA, colaId, "FOH")).toBe(7);
  });

  it("FOH count: a repeat from a phone whose clock runs ahead, after a later sale, changes nothing and answers success", async () => {
    const countedAt = new Date(Date.now() + 120_000).toISOString();
    const count = () => callHandler(handleCountFoh, asUser(fx.chef, SALES), { params: { locId: fx.locA }, body: { ingredientId: colaId, countedQty: 12, countedAt } });
    expect((await count()).body.replay).toBe(false);
    await callHandler(handleRecordSales, asUser(fx.chef, SALES), { params: { locId: fx.locA }, body: { lines: [{ ingredientId: colaId, quantity: 3 }] } });
    const again = await count();

    expect(again.status).toBe(200);
    expect(again.body.replay).toBe(true);
    expect(await zoneQty(fx.locA, colaId, "FOH")).toBe(9);
  });

  it("FOH count with countedAt null sets the shelf like one without it", async () => {
    const out = await callHandler(handleCountFoh, asUser(fx.chef, SALES), { params: { locId: fx.locA }, body: { ingredientId: colaId, countedQty: 13, countedAt: null } });
    expect(out.status).toBe(200);
    expect(await zoneQty(fx.locA, colaId, "FOH")).toBe(13);
  });

  it("FOH count without countedAt sets the shelf as before (the web)", async () => {
    const out = await callHandler(handleCountFoh, asUser(fx.chef, SALES), { params: { locId: fx.locA }, body: { ingredientId: colaId, countedQty: 11 } });
    expect(out.status).toBe(200);
    expect(await zoneQty(fx.locA, colaId, "FOH")).toBe(11);
  });

  it("FOH: another organisation's location is 404 NOT_FOUND on every write", async () => {
    const outsider = asUser(other.boss, SALES);
    const params = { locId: fx.locA };
    for (const [handler, body] of [
      [handleRestockFoh, { ingredientId: colaId, quantity: 1 }],
      [handleRecordSales, { lines: [{ ingredientId: colaId, quantity: 1 }] }],
      [handleLogFohWaste, { ingredientId: colaId, quantity: 1, unit: "each" }],
      [handleCountFoh, { ingredientId: colaId, countedQty: 1 }],
    ] as const) {
      expect(await callHandler(handler, outsider, { params, body })).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
    }
  });

  // ─── Catalogue requests ──────────────────────────────────────

  it("catalogue request: a repeat of the same requestId stores one request", async () => {
    const requestId = randomUUID();
    const body = { requestId, itemName: "Yuzu kosho", storeLocationId: fx.locA };
    const first = await callHandler(handleRequestNewItem, asUser(fx.chef, ["inventory:count"]), { body });
    const again = await callHandler(handleRequestNewItem, asUser(fx.chef, ["inventory:count"]), { body });

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.requestId).toBe(requestId);
    expect(await db.select().from(pendingCatalogRequest).where(eq(pendingCatalogRequest.requestId, requestId))).toHaveLength(1);
  });

  it("catalogue request: refusals carry codes (no location, another org's location, someone else's id, long name)", async () => {
    const requestId = randomUUID();
    await callHandler(handleRequestNewItem, asUser(fx.chef, ["inventory:count"]), { body: { requestId, itemName: "Sumac", storeLocationId: fx.locA } });
    const send = (who: number, body: object) => callHandler(handleRequestNewItem, asUser(who, ["inventory:count"]), { body });

    expect(await send(fx.cook, { itemName: "Sumac" })).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
    expect(await send(fx.cook, { itemName: "Sumac", storeLocationId: other.locA })).toMatchObject({ status: 403, body: { code: "LOCATION_NOT_ALLOWED" } });
    expect(await send(fx.cook, { requestId, itemName: "Sumac", storeLocationId: fx.locA })).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
    expect(await send(fx.cook, { itemName: "x".repeat(201), storeLocationId: fx.locA })).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { consumptionLog, stockLevel, stockMovement } from "../db/schema.js";
import { handleDeleteLog, handleLogConsumption } from "../controllers/consumptionLogController.js";
import { handleCreateMovement } from "../controllers/storageAreaController.js";
import { asUser, callHandler, createLineLoopFx, removeLineLoopFx, type LineLoopFx } from "./lineLoopFixture.js";

/**
 * Consumption log and stock movements, made safe for a phone that queues offline and retries (Wave 2):
 * a client-made id so a repeat is not a second entry (nor a second deduction), refusals that carry a code.
 * Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

let fx: LineLoopFx;
const stockOf = async () => Number((await db.select().from(stockLevel).where(eq(stockLevel.ingredientId, fx.ingId)))[0].currentQty);
const entry = (extra: object = {}) => ({ ingredientId: fx.ingId, quantity: 1, unit: "kg", reason: "spoilage", storeLocationId: fx.locA, ...extra });
const logs = (id: string) => db.select().from(consumptionLog).where(eq(consumptionLog.consumptionLogId, id));

describe.skipIf(!RUN)("consumption log retries (real DB)", () => {
  beforeAll(async () => {
    fx = await createLineLoopFx(`cm_${Date.now().toString(36)}`);
  });
  afterAll(async () => {
    await removeLineLoopFx(fx);
  });

  it("a repeat of the same consumptionLogId stores one entry and deducts the stock once", async () => {
    const before = await stockOf();
    const consumptionLogId = randomUUID();
    const first = await callHandler(handleLogConsumption, asUser(fx.chef, ["inventory:count"]), { body: entry({ consumptionLogId }) });
    const again = await callHandler(handleLogConsumption, asUser(fx.chef, ["inventory:count"]), { body: entry({ consumptionLogId }) });

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.consumptionLogId).toBe(consumptionLogId);
    expect(await logs(consumptionLogId)).toHaveLength(1);
    expect(await stockOf()).toBe(before - 1);
  });

  it("an id another user's entry holds is 409 CONFLICT, and takes nothing from the stock", async () => {
    const consumptionLogId = randomUUID();
    await callHandler(handleLogConsumption, asUser(fx.chef, ["inventory:count"]), { body: entry({ consumptionLogId }) });
    const before = await stockOf();
    const out = await callHandler(handleLogConsumption, asUser(fx.cook, ["inventory:count"]), { body: entry({ consumptionLogId }) });

    expect(out).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
    expect(await stockOf()).toBe(before);
  });

  it("a location the caller is not assigned to is 403 LOCATION_NOT_ALLOWED (already so; this keeps it so)", async () => {
    const out = await callHandler(handleLogConsumption, asUser(fx.stranger, ["inventory:count"]), { body: entry() });
    expect(out).toMatchObject({ status: 403, body: { code: "LOCATION_NOT_ALLOWED" } });
  });

  it("an ingredient of another organisation is 404 NOT_FOUND, not an unmapped 500", async () => {
    const out = await callHandler(handleLogConsumption, asUser(fx.chef, ["inventory:count"]), { body: entry({ ingredientId: randomUUID() }) });
    expect(out).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
  });

  it("an entry and its stock effect commit together: stock always equals the start minus the entries that exist", async () => {
    const before = await stockOf();
    const ids = Array.from({ length: 8 }, () => randomUUID());
    await Promise.all(ids.map((consumptionLogId) => callHandler(handleLogConsumption, asUser(fx.chef, ["inventory:count"]), { body: entry({ consumptionLogId }) })));

    let stored = 0;
    for (const id of ids) stored += (await logs(id)).length;
    expect(await stockOf()).toBe(before - stored);
  });

  it("a repeat of a delete answers success; the stock comes back once", async () => {
    const made = await callHandler(handleLogConsumption, asUser(fx.chef, ["inventory:count"]), { body: entry({ quantity: 2 }) });
    const afterLog = await stockOf();
    const id = made.body.consumptionLogId;
    const first = await callHandler(handleDeleteLog, asUser(fx.chef, ["inventory:count"]), { params: { id } });
    const again = await callHandler(handleDeleteLog, asUser(fx.chef, ["inventory:count"]), { params: { id } });

    expect(first).toMatchObject({ status: 200, body: { success: true } });
    expect(again).toMatchObject({ status: 200, body: { success: true } });
    expect(await stockOf()).toBe(afterLog + 2);
  });
});

describe.skipIf(!RUN)("stock movement retries (real DB)", () => {
  const move = (extra: object = {}) => ({ ingredientId: "", fromStorageAreaId: "", toStorageAreaId: "", quantity: 1, unit: "kg", ...extra });
  const send = (who: number, extra: object = {}) =>
    callHandler(handleCreateMovement, asUser(who, ["inventory:count"]), {
      params: { locId: fx.locA },
      body: move({ ingredientId: fx.ingId, fromStorageAreaId: fx.areaA1, toStorageAreaId: fx.areaA2, ...extra }),
    });

  beforeAll(async () => {
    fx = await createLineLoopFx(`mv_${Date.now().toString(36)}`);
  });
  afterAll(async () => {
    await removeLineLoopFx(fx);
  });

  it("a repeat of the same stockMovementId stores one movement and answers both sends with it", async () => {
    const stockMovementId = randomUUID();
    const first = await send(fx.chef, { stockMovementId });
    const again = await send(fx.chef, { stockMovementId });

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.stockMovementId).toBe(stockMovementId);
    expect(await db.select().from(stockMovement).where(eq(stockMovement.stockMovementId, stockMovementId))).toHaveLength(1);
  });

  it("an id another user's movement holds is 409 CONFLICT", async () => {
    const stockMovementId = randomUUID();
    await send(fx.chef, { stockMovementId });
    expect(await send(fx.cook, { stockMovementId })).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
  });

  it("refusals carry a code: same area 400 VALIDATION, unknown area 404 NOT_FOUND, a unit the item cannot use 400 INCOMPATIBLE_UNITS", async () => {
    expect(await send(fx.chef, { toStorageAreaId: fx.areaA1 })).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
    expect(await send(fx.chef, { toStorageAreaId: randomUUID() })).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
    expect(await send(fx.chef, { unit: "L" })).toMatchObject({ status: 400, body: { code: "INCOMPATIBLE_UNITS" } });
  });
});

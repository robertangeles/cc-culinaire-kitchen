import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

// Same .env bootstrap as the other real-DB suites (see stockTakeVariance.integration.test.ts).
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { eq, and, inArray } from "drizzle-orm";
import type { Request, Response } from "express";
import { db } from "../db/index.js";
import {
  organisation,
  user,
  userOrganisation,
  storeLocation,
  supplier,
  ingredient,
  locationIngredient,
  stockLevel,
  stockTakeSession,
  stockTakeCategory,
  stockTakeLine,
  purchaseOrder,
  purchaseOrderLine,
  receivingSession,
  receivingLine,
  receivingDiscrepancy,
  fifoBatch,
  stockMovement,
  auditLog,
} from "../db/schema.js";
import { openSession, claimCategory, saveLineItem, submitCategory, getSessionDetail } from "./stockTakeService.js";
import { handleSaveLineItem } from "../controllers/stockTakeController.js";
import { handleConfirmReceipt } from "../controllers/receivingController.js";
import * as receivingService from "./receivingService.js";

/**
 * Mobile release 1, PR 1 (E5): the three replay cases the design doc named as untested
 * (premise 2). The phone queues counts offline and replays them later, so each of these
 * is a path a chef's queued item can take:
 *
 *   1. a stale queued count arriving after a newer one            -> arrival order wins, one row
 *   2. a count replayed into an already-submitted category         -> rejected (400), nothing written
 *   3. a retried receiving confirm on a COMPLETED session          -> 400, stock not doubled,
 *                                                                     session reads COMPLETED
 *
 * Gated on TENANT_IT=1 (the repo's real-DB gate). Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

const fx = {
  tag: `mrp_${Date.now().toString(36)}`,
  userId: 0,
  orgId: 0,
  locId: "",
  supplierId: "",
  ingId: "",
  sessionId: "",
  categoryId: "",
  poId: "",
  receivingSessionId: "",
};

/** Minimal Express req/res: the controllers only read user, params, body and call status/json. */
function call(handler: (req: Request, res: Response, next: (e?: unknown) => void) => Promise<void>, req: object) {
  return new Promise<{ status: number; body: unknown }>((resolveCall, reject) => {
    let status = 200;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(body: unknown) {
        resolveCall({ status, body });
        return this;
      },
    } as unknown as Response;
    handler({ user: { sub: fx.userId }, ...req } as unknown as Request, res, (e) => reject(e)).catch(reject);
  });
}

async function lineCount() {
  const rows = await db
    .select({ id: stockTakeLine.lineId })
    .from(stockTakeLine)
    .where(and(eq(stockTakeLine.categoryId, fx.categoryId), eq(stockTakeLine.ingredientId, fx.ingId)));
  return rows.length;
}

async function currentQty() {
  const [row] = await db
    .select({ qty: stockLevel.currentQty })
    .from(stockLevel)
    .where(and(eq(stockLevel.storeLocationId, fx.locId), eq(stockLevel.ingredientId, fx.ingId)));
  return row ? Number(row.qty) : 0;
}

describe.skipIf(!RUN)("mobile replay cases (real DB)", () => {
  beforeAll(async () => {
    [{ userId: fx.userId }] = await db
      .insert(user)
      .values({ userName: "MRP IT", userEmail: `${fx.tag}@it.test` })
      .returning({ userId: user.userId });

    [{ id: fx.orgId }] = await db
      .insert(organisation)
      .values({ organisationName: `${fx.tag}-org`, joinKey: `${fx.tag}-k`.slice(0, 25), createdBy: fx.userId })
      .returning({ id: organisation.organisationId });

    // Org admin: getUserLocationContext then returns every org location, which is all the
    // controllers need (they resolve the org from it).
    await db.insert(userOrganisation).values({ userId: fx.userId, organisationId: fx.orgId, role: "admin" });

    [{ id: fx.locId }] = await db
      .insert(storeLocation)
      .values({
        organisationId: fx.orgId,
        locationName: `${fx.tag}-loc`,
        classification: "branch",
        storeKey: `${fx.tag}-s`.slice(0, 25),
        createdBy: fx.userId,
        inventoryActive: true,
      })
      .returning({ id: storeLocation.storeLocationId });

    [{ id: fx.ingId }] = await db
      .insert(ingredient)
      .values({
        organisationId: fx.orgId,
        ingredientName: `${fx.tag}-flour`,
        ingredientCategory: "dry_goods",
        itemType: "KITCHEN_INGREDIENT",
        baseUnit: "kg",
      })
      .returning({ id: ingredient.ingredientId });

    await db.insert(locationIngredient).values({
      ingredientId: fx.ingId,
      storeLocationId: fx.locId,
      activeInd: true,
      weightedAverageCost: "2",
    });
    await db.insert(stockLevel).values({ storeLocationId: fx.locId, ingredientId: fx.ingId, currentQty: "10" });

    [{ id: fx.supplierId }] = await db
      .insert(supplier)
      .values({ organisationId: fx.orgId, supplierName: `${fx.tag}-supplier` })
      .returning({ id: supplier.supplierId });

    const session = await openSession(fx.locId, fx.orgId, fx.userId, ["dry_goods"]);
    fx.sessionId = session.sessionId;
    const detail = await getSessionDetail(fx.sessionId, fx.orgId);
    fx.categoryId = detail!.categories.find((c) => c.categoryName === "dry_goods")!.categoryId;
    await claimCategory(fx.sessionId, "dry_goods", fx.userId);

    // A SENT purchase order for 5 kg of the ingredient, ready to receive.
    [{ id: fx.poId }] = await db
      .insert(purchaseOrder)
      .values({
        organisationId: fx.orgId,
        storeLocationId: fx.locId,
        supplierId: fx.supplierId,
        poNumber: `${fx.tag}-po`.slice(0, 50),
        status: "SENT",
        createdByUserId: fx.userId,
      })
      .returning({ id: purchaseOrder.poId });
    await db.insert(purchaseOrderLine).values({
      poId: fx.poId,
      ingredientId: fx.ingId,
      orderedQty: "5",
      orderedUnit: "kg",
      unitCost: "2",
    });
  });

  afterAll(async () => {
    if (fx.receivingSessionId) {
      await db.delete(receivingDiscrepancy).where(eq(receivingDiscrepancy.sessionId, fx.receivingSessionId));
      await db.delete(receivingLine).where(eq(receivingLine.sessionId, fx.receivingSessionId));
      await db.delete(receivingSession).where(eq(receivingSession.sessionId, fx.receivingSessionId));
    }
    // fifo_batch references the PO line, so it goes first.
    if (fx.ingId) {
      await db.delete(fifoBatch).where(eq(fifoBatch.ingredientId, fx.ingId));
      await db.delete(stockMovement).where(eq(stockMovement.ingredientId, fx.ingId));
    }
    if (fx.poId) {
      await db.delete(purchaseOrderLine).where(eq(purchaseOrderLine.poId, fx.poId));
      await db.delete(purchaseOrder).where(eq(purchaseOrder.poId, fx.poId));
    }
    if (fx.categoryId) await db.delete(stockTakeLine).where(eq(stockTakeLine.categoryId, fx.categoryId));
    if (fx.sessionId) {
      await db.delete(stockTakeCategory).where(eq(stockTakeCategory.sessionId, fx.sessionId));
      await db.delete(stockTakeSession).where(eq(stockTakeSession.sessionId, fx.sessionId));
    }
    if (fx.locId) {
      await db.delete(stockLevel).where(inArray(stockLevel.storeLocationId, [fx.locId]));
      await db.delete(locationIngredient).where(inArray(locationIngredient.storeLocationId, [fx.locId]));
    }
    if (fx.supplierId) await db.delete(supplier).where(eq(supplier.supplierId, fx.supplierId));
    if (fx.ingId) await db.delete(ingredient).where(eq(ingredient.ingredientId, fx.ingId));
    if (fx.locId) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, fx.locId));
    if (fx.orgId) {
      await db.delete(auditLog).where(eq(auditLog.organisationId, fx.orgId));
      await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, fx.orgId));
      await db.delete(organisation).where(eq(organisation.organisationId, fx.orgId));
    }
    if (fx.userId) await db.delete(user).where(eq(user.userId, fx.userId));
  });

  it("1. a stale queued count arriving after a newer one wins by arrival order, as one row", async () => {
    await saveLineItem(fx.categoryId, fx.ingId, 12, "kg", fx.userId); // the newer count, already on the server
    await saveLineItem(fx.categoryId, fx.ingId, 4, "kg", fx.userId); // the older offline count, replayed late
    await saveLineItem(fx.categoryId, fx.ingId, 4, "kg", fx.userId); // the same replay sent twice (retry)

    expect(await lineCount()).toBe(1);
    const [line] = await db
      .select({ countedQty: stockTakeLine.countedQty })
      .from(stockTakeLine)
      .where(and(eq(stockTakeLine.categoryId, fx.categoryId), eq(stockTakeLine.ingredientId, fx.ingId)));
    expect(Number(line.countedQty)).toBe(4);
  });

  it("2. a count replayed into an already-submitted category is rejected with 400 and writes nothing", async () => {
    await submitCategory(fx.sessionId, "dry_goods", fx.userId);
    const before = await db
      .select({ countedQty: stockTakeLine.countedQty })
      .from(stockTakeLine)
      .where(eq(stockTakeLine.categoryId, fx.categoryId));

    const out = await call(handleSaveLineItem, {
      params: { id: fx.sessionId, cat: "dry_goods" },
      body: { ingredientId: fx.ingId, rawQty: 99, countedUnit: "kg" },
    });

    expect(out.status).toBe(400);
    expect((out.body as { error: string }).error).toMatch(/SUBMITTED/);
    const after = await db
      .select({ countedQty: stockTakeLine.countedQty })
      .from(stockTakeLine)
      .where(eq(stockTakeLine.categoryId, fx.categoryId));
    expect(after.map((r) => Number(r.countedQty))).toEqual(before.map((r) => Number(r.countedQty)));
  });

  it("3. a retried receiving confirm returns 400, does not double the stock, and the session reads COMPLETED", async () => {
    const { session } = await receivingService.startSession(fx.poId, fx.locId, fx.userId, fx.orgId);
    fx.receivingSessionId = session.sessionId;
    const startQty = await currentQty();

    await receivingService.confirmReceipt(fx.receivingSessionId, fx.orgId);
    const afterFirst = await currentQty();
    expect(afterFirst).toBe(startQty + 5);

    const retry = await call(handleConfirmReceipt, { params: { sessionId: fx.receivingSessionId } });
    expect(retry.status).toBe(400);
    expect(await currentQty()).toBe(afterFirst);

    // The client's recovery step: fetch the session and treat COMPLETED as done.
    const fetched = await receivingService.getSession(fx.receivingSessionId, fx.orgId);
    expect(fetched?.session.status).toBe("COMPLETED");
  });
});

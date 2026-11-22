import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

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
  purchaseOrder,
  purchaseOrderLine,
  receivingSession,
  receivingLine,
  receivingDiscrepancy,
  fifoBatch,
  stockMovement,
  auditLog,
} from "../db/schema.js";
import { handleConfirmReceipt } from "../controllers/receivingController.js";
import { errorHandler } from "../middleware/errorHandler.js";
import * as receivingService from "./receivingService.js";

/**
 * Receiving money path, real DB: the confirm that adds stock must run exactly once
 * (two phones, a retried request), "All good" must undo a Short, and a substituted
 * item must land as stock of the item that actually arrived.
 *
 * Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

const fx = {
  tag: `rmp_${Date.now().toString(36)}`,
  userId: 0,
  orgId: 0,
  locId: "",
  supplierId: "",
  ingId: "",
  otherIngId: "",
  foreignOrgId: 0,
  foreignIngId: "",
  poIds: [] as string[],
  sessionIds: [] as string[],
};

/** Runs a handler like Express would: a thrown/next(err) error goes through the real errorHandler. */
function call(handler: (req: Request, res: Response, next: (e?: unknown) => void) => Promise<void>, req: object) {
  return new Promise<{ status: number; body: unknown }>((resolveCall, reject) => {
    let status = 200;
    const res = {
      headersSent: false,
      status(code: number) {
        status = code;
        return this;
      },
      json(body: unknown) {
        resolveCall({ status, body });
        return this;
      },
    } as unknown as Response;
    const next = (e?: unknown) => errorHandler(e as Error, {} as Request, res, () => {});
    handler({ user: { sub: fx.userId }, ...req } as unknown as Request, res, next).catch(reject);
  });
}

async function qty(ingredientId: string) {
  const [row] = await db
    .select({ qty: stockLevel.currentQty })
    .from(stockLevel)
    .where(and(eq(stockLevel.storeLocationId, fx.locId), eq(stockLevel.ingredientId, ingredientId)));
  return row ? Number(row.qty) : 0;
}

/** A SENT purchase order for 5 kg of the main ingredient, with a receiving session already started. */
async function startedSession(n: number) {
  const [{ id: poId }] = await db
    .insert(purchaseOrder)
    .values({
      organisationId: fx.orgId,
      storeLocationId: fx.locId,
      supplierId: fx.supplierId,
      poNumber: `${fx.tag}-po${n}`.slice(0, 50),
      status: "SENT",
      createdByUserId: fx.userId,
    })
    .returning({ id: purchaseOrder.poId });
  fx.poIds.push(poId);
  await db.insert(purchaseOrderLine).values({
    poId,
    ingredientId: fx.ingId,
    orderedQty: "5",
    orderedUnit: "kg",
    unitCost: "2",
  });
  const { session, lines } = await receivingService.startSession(poId, fx.locId, fx.userId, fx.orgId);
  fx.sessionIds.push(session.sessionId);
  return { sessionId: session.sessionId, lineId: lines[0].receivingLineId };
}

describe.skipIf(!RUN)("receiving money path (real DB)", () => {
  beforeAll(async () => {
    [{ userId: fx.userId }] = await db
      .insert(user)
      .values({ userName: "RMP IT", userEmail: `${fx.tag}@it.test` })
      .returning({ userId: user.userId });
    [{ id: fx.orgId }] = await db
      .insert(organisation)
      .values({ organisationName: `${fx.tag}-org`, joinKey: `${fx.tag}-k`.slice(0, 25), createdBy: fx.userId })
      .returning({ id: organisation.organisationId });
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
    for (const [key, name] of [["ingId", "flour"], ["otherIngId", "rye"]] as const) {
      [{ id: fx[key] }] = await db
        .insert(ingredient)
        .values({
          organisationId: fx.orgId,
          ingredientName: `${fx.tag}-${name}`,
          ingredientCategory: "dry_goods",
          itemType: "KITCHEN_INGREDIENT",
          baseUnit: "kg",
        })
        .returning({ id: ingredient.ingredientId });
      await db.insert(locationIngredient).values({
        ingredientId: fx[key],
        storeLocationId: fx.locId,
        activeInd: true,
        weightedAverageCost: "2",
      });
      await db.insert(stockLevel).values({ storeLocationId: fx.locId, ingredientId: fx[key], currentQty: "10" });
    }
    // An ingredient that belongs to a different organisation.
    [{ id: fx.foreignOrgId }] = await db
      .insert(organisation)
      .values({ organisationName: `${fx.tag}-foreign`, joinKey: `${fx.tag}-f`.slice(0, 25), createdBy: fx.userId })
      .returning({ id: organisation.organisationId });
    [{ id: fx.foreignIngId }] = await db
      .insert(ingredient)
      .values({
        organisationId: fx.foreignOrgId,
        ingredientName: `${fx.tag}-foreign-oats`,
        ingredientCategory: "dry_goods",
        itemType: "KITCHEN_INGREDIENT",
        baseUnit: "kg",
      })
      .returning({ id: ingredient.ingredientId });
    [{ id: fx.supplierId }] = await db
      .insert(supplier)
      .values({ organisationId: fx.orgId, supplierName: `${fx.tag}-supplier` })
      .returning({ id: supplier.supplierId });
  });

  afterAll(async () => {
    if (fx.sessionIds.length) {
      await db.delete(receivingDiscrepancy).where(inArray(receivingDiscrepancy.sessionId, fx.sessionIds));
      await db.delete(receivingLine).where(inArray(receivingLine.sessionId, fx.sessionIds));
      await db.delete(receivingSession).where(inArray(receivingSession.sessionId, fx.sessionIds));
    }
    const ingIds = [fx.ingId, fx.otherIngId, fx.foreignIngId].filter(Boolean);
    if (ingIds.length) {
      await db.delete(fifoBatch).where(inArray(fifoBatch.ingredientId, ingIds));
      await db.delete(stockMovement).where(inArray(stockMovement.ingredientId, ingIds));
    }
    if (fx.poIds.length) {
      await db.delete(purchaseOrderLine).where(inArray(purchaseOrderLine.poId, fx.poIds));
      await db.delete(purchaseOrder).where(inArray(purchaseOrder.poId, fx.poIds));
    }
    if (fx.locId) {
      await db.delete(stockLevel).where(eq(stockLevel.storeLocationId, fx.locId));
      await db.delete(locationIngredient).where(eq(locationIngredient.storeLocationId, fx.locId));
    }
    if (fx.supplierId) await db.delete(supplier).where(eq(supplier.supplierId, fx.supplierId));
    if (ingIds.length) await db.delete(ingredient).where(inArray(ingredient.ingredientId, ingIds));
    if (fx.locId) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, fx.locId));
    if (fx.orgId) {
      await db.delete(auditLog).where(eq(auditLog.organisationId, fx.orgId));
      await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, fx.orgId));
      await db.delete(organisation).where(eq(organisation.organisationId, fx.orgId));
    }
    if (fx.foreignOrgId) await db.delete(organisation).where(eq(organisation.organisationId, fx.foreignOrgId));
    if (fx.userId) await db.delete(user).where(eq(user.userId, fx.userId));
  });

  it("two confirms at once add the stock once; the loser gets 409 ALREADY_CONFIRMED", async () => {
    const { sessionId } = await startedSession(1);
    const before = await qty(fx.ingId);

    const results = await Promise.all([
      call(handleConfirmReceipt, { params: { sessionId } }),
      call(handleConfirmReceipt, { params: { sessionId } }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body).toMatchObject({ code: "ALREADY_CONFIRMED" });
    expect(await qty(fx.ingId)).toBe(before + 5);
  });

  it("a confirm retried after success is 409 ALREADY_CONFIRMED and changes nothing", async () => {
    const { sessionId } = await startedSession(2);
    await receivingService.confirmReceipt(sessionId, fx.orgId);
    const after = await qty(fx.ingId);

    const retry = await call(handleConfirmReceipt, { params: { sessionId } });

    expect(retry.status).toBe(409);
    expect(retry.body).toMatchObject({ code: "ALREADY_CONFIRMED" });
    expect(await qty(fx.ingId)).toBe(after);
  });

  it("a confirm and a cancel at once: one wins, and a completed session is never overwritten by the cancel", async () => {
    const { sessionId } = await startedSession(20);
    const before = await qty(fx.ingId);

    const [confirm, cancel] = await Promise.allSettled([
      receivingService.confirmReceipt(sessionId, fx.orgId),
      receivingService.cancelSession(sessionId, fx.orgId),
    ]);

    const [row] = await db.select({ s: receivingSession.status }).from(receivingSession).where(eq(receivingSession.sessionId, sessionId));
    if (confirm.status === "fulfilled") {
      expect(cancel.status).toBe("rejected");
      expect(row.s).toBe("COMPLETED");
      expect(await qty(fx.ingId)).toBe(before + 5);
    } else {
      expect(cancel.status).toBe("fulfilled");
      expect(row.s).toBe("CANCELLED");
      expect(await qty(fx.ingId)).toBe(before);
    }
  });

  it("a line action racing a confirm either lands before the confirm books the stock or is refused", async () => {
    const { sessionId, lineId } = await startedSession(21);
    const before = await qty(fx.ingId);

    const [action, confirm] = await Promise.allSettled([
      receivingService.actionLine(lineId, sessionId, { status: "REJECTED", rejectionReason: "damaged" }, fx.orgId),
      receivingService.confirmReceipt(sessionId, fx.orgId),
    ]);

    expect(confirm.status).toBe("fulfilled");
    const [line] = await db.select({ s: receivingLine.status }).from(receivingLine).where(eq(receivingLine.receivingLineId, lineId));
    expect(line.s).toBe(action.status === "fulfilled" ? "REJECTED" : "RECEIVED");
    expect(await qty(fx.ingId)).toBe(line.s === "REJECTED" ? before : before + 5);
  });

  it("'All good' after Short puts the ordered quantity back and drops the discrepancy", async () => {
    const { sessionId, lineId } = await startedSession(3);
    await receivingService.actionLine(lineId, sessionId, { status: "SHORT", receivedQty: "2" }, fx.orgId);

    await receivingService.actionLine(lineId, sessionId, { status: "RECEIVED" }, fx.orgId);

    const [line] = await db.select().from(receivingLine).where(eq(receivingLine.receivingLineId, lineId));
    expect(Number(line.receivedQty)).toBe(5);
    const discrepancies = await db.select().from(receivingDiscrepancy).where(eq(receivingDiscrepancy.receivingLineId, lineId));
    expect(discrepancies).toEqual([]);
  });

  it("'All good' after Reject puts the ordered quantity back, so confirm adds the stock", async () => {
    const { sessionId, lineId } = await startedSession(4);
    await receivingService.actionLine(lineId, sessionId, { status: "REJECTED", rejectionReason: "damaged" }, fx.orgId);
    await receivingService.actionLine(lineId, sessionId, { status: "RECEIVED" }, fx.orgId);
    const before = await qty(fx.ingId);

    await receivingService.confirmReceipt(sessionId, fx.orgId);

    expect(await qty(fx.ingId)).toBe(before + 5);
  });

  it("a substituted item is stocked as the item that arrived, not the one ordered", async () => {
    const { sessionId, lineId } = await startedSession(5);
    await receivingService.actionLine(
      lineId,
      sessionId,
      { status: "SUBSTITUTED", receivedQty: "5", substitutedIngredientId: fx.otherIngId },
      fx.orgId,
    );
    const [discrepancy] = await db.select().from(receivingDiscrepancy).where(eq(receivingDiscrepancy.receivingLineId, lineId));
    expect(discrepancy.type).toBe("SUBSTITUTION");
    const orderedBefore = await qty(fx.ingId);
    const arrivedBefore = await qty(fx.otherIngId);

    await receivingService.confirmReceipt(sessionId, fx.orgId);

    expect(await qty(fx.otherIngId)).toBe(arrivedBefore + 5);
    expect(await qty(fx.ingId)).toBe(orderedBefore);
  });

  it("refuses a substitute ingredient from another organisation", async () => {
    const { sessionId, lineId } = await startedSession(6);

    await expect(
      receivingService.actionLine(
        lineId,
        sessionId,
        { status: "SUBSTITUTED", receivedQty: "5", substitutedIngredientId: fx.foreignIngId },
        fx.orgId,
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("confirm will not stock another organisation's ingredient from an already-stored substitution", async () => {
    // A row written before the check existed.
    const { sessionId, lineId } = await startedSession(7);
    await db.update(receivingLine).set({ status: "SUBSTITUTED" }).where(eq(receivingLine.receivingLineId, lineId));
    await db.insert(receivingDiscrepancy).values({
      receivingLineId: lineId,
      sessionId,
      supplierId: fx.supplierId,
      type: "SUBSTITUTED",
      substitutedIngredientId: fx.foreignIngId,
    });

    await expect(receivingService.confirmReceipt(sessionId, fx.orgId)).rejects.toThrow(/not found/i);

    expect(await qty(fx.foreignIngId)).toBe(0);
  });
});

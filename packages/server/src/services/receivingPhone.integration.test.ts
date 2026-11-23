import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { applyEnvPrefix } from "../utils/envShim.js";

// Same .env bootstrap as the other real-DB suites (see mobileReplay.integration.test.ts).
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
import { handleActionLine, handleConfirmReceipt } from "../controllers/receivingController.js";
import * as receivingService from "./receivingService.js";
import { errorHandler } from "../middleware/errorHandler.js";

/**
 * Wave 1 (receiving on the phone): the receiving rules the phone relies on.
 *
 *   - SHORT needs a quantity, and it must be less than ordered
 *   - a price change needs the new price (a missing one recorded -100%)
 *   - a PO line whose unit has no path to the base unit answers 400 with the line named, writes nothing,
 *     and does not trap the session: rejecting that line lets the rest of the delivery be confirmed
 *   - two phones on one session: the second start says so, and the audit trail names whoever acted
 *
 * Gated on TENANT_IT=1 (the repo's real-DB gate). Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

const fx = {
  tag: `rcp_${Date.now().toString(36)}`,
  userA: 0,
  userB: 0,
  orgId: 0,
  locId: "",
  supplierId: "",
  flourId: "", // kg, no conversions
  tinId: "", // kg, ordered in "case" with no case->kg conversion
  poIds: [] as string[],
};

/** Minimal Express req/res: the controllers only read user, params, body and call status/json. */
function call(
  handler: (req: Request, res: Response, next: (e?: unknown) => void) => Promise<void>,
  req: object,
) {
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolveCall, reject) => {
    let status = 200;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(body: Record<string, unknown>) {
        resolveCall({ status, body });
        return this;
      },
      headersSent: false,
    } as unknown as Response;
    // Errors the controller passes on reach the real error handler, as in the app (that is where a 400 with a code comes from).
    handler({ user: { sub: fx.userA }, ...req } as unknown as Request, res, (e) => errorHandler(e as Error, {} as Request, res, () => {})).catch(reject);
  });
}

/** A SENT PO with the given lines, started by userA. Returns the session and its lines by ingredient. */
async function sentPO(lines: Array<{ ingredientId: string; qty: string; unit: string; cost?: string }>) {
  const [po] = await db
    .insert(purchaseOrder)
    .values({
      organisationId: fx.orgId,
      storeLocationId: fx.locId,
      supplierId: fx.supplierId,
      poNumber: `${fx.tag}-${fx.poIds.length}`.slice(0, 50),
      status: "SENT",
      createdByUserId: fx.userA,
    })
    .returning({ id: purchaseOrder.poId });
  fx.poIds.push(po.id);
  await db.insert(purchaseOrderLine).values(
    lines.map((l) => ({ poId: po.id, ingredientId: l.ingredientId, orderedQty: l.qty, orderedUnit: l.unit, unitCost: l.cost ?? "2" })),
  );
  const started = await receivingService.startSession(po.id, fx.locId, fx.userA, fx.orgId);
  const byIngredient = (id: string) => started.lines.find((l) => l.ingredientId === id)!;
  return { poId: po.id, sessionId: started.session.sessionId, line: byIngredient, started };
}

async function stock(ingredientId: string) {
  const [row] = await db
    .select({ qty: stockLevel.currentQty })
    .from(stockLevel)
    .where(and(eq(stockLevel.storeLocationId, fx.locId), eq(stockLevel.ingredientId, ingredientId)));
  return row ? Number(row.qty) : 0;
}

describe.skipIf(!RUN)("receiving rules for the phone (real DB)", () => {
  beforeAll(async () => {
    [{ userId: fx.userA }] = await db
      .insert(user)
      .values({ userName: "RCP Alice", userEmail: `${fx.tag}-a@it.test` })
      .returning({ userId: user.userId });
    [{ userId: fx.userB }] = await db
      .insert(user)
      .values({ userName: "RCP Bob", userEmail: `${fx.tag}-b@it.test` })
      .returning({ userId: user.userId });

    [{ id: fx.orgId }] = await db
      .insert(organisation)
      .values({ organisationName: `${fx.tag}-org`, joinKey: `${fx.tag}-k`.slice(0, 25), createdBy: fx.userA })
      .returning({ id: organisation.organisationId });
    await db.insert(userOrganisation).values({ userId: fx.userA, organisationId: fx.orgId, role: "admin" });

    [{ id: fx.locId }] = await db
      .insert(storeLocation)
      .values({
        organisationId: fx.orgId,
        locationName: `${fx.tag}-loc`,
        classification: "branch",
        storeKey: `${fx.tag}-s`.slice(0, 25),
        createdBy: fx.userA,
        inventoryActive: true,
      })
      .returning({ id: storeLocation.storeLocationId });

    for (const [key, name] of [["flourId", "flour"], ["tinId", "tomatoes"]] as const) {
      const [row] = await db
        .insert(ingredient)
        .values({
          organisationId: fx.orgId,
          ingredientName: `${fx.tag}-${name}`,
          ingredientCategory: "dry_goods",
          itemType: "KITCHEN_INGREDIENT",
          baseUnit: "kg",
        })
        .returning({ id: ingredient.ingredientId });
      fx[key] = row.id;
      await db.insert(locationIngredient).values({
        ingredientId: row.id,
        storeLocationId: fx.locId,
        activeInd: true,
        weightedAverageCost: "2",
      });
      await db.insert(stockLevel).values({ storeLocationId: fx.locId, ingredientId: row.id, currentQty: "10" });
    }

    [{ id: fx.supplierId }] = await db
      .insert(supplier)
      .values({ organisationId: fx.orgId, supplierName: `${fx.tag}-supplier` })
      .returning({ id: supplier.supplierId });
  });

  afterAll(async () => {
    const sessions = fx.poIds.length
      ? await db.select({ id: receivingSession.sessionId }).from(receivingSession).where(inArray(receivingSession.poId, fx.poIds))
      : [];
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length) {
      await db.delete(receivingDiscrepancy).where(inArray(receivingDiscrepancy.sessionId, sessionIds));
      await db.delete(receivingLine).where(inArray(receivingLine.sessionId, sessionIds));
      await db.delete(receivingSession).where(inArray(receivingSession.sessionId, sessionIds));
    }
    const ings = [fx.flourId, fx.tinId].filter(Boolean);
    if (ings.length) {
      await db.delete(fifoBatch).where(inArray(fifoBatch.ingredientId, ings));
      await db.delete(stockMovement).where(inArray(stockMovement.ingredientId, ings));
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
    if (ings.length) await db.delete(ingredient).where(inArray(ingredient.ingredientId, ings));
    if (fx.locId) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, fx.locId));
    if (fx.orgId) {
      await db.delete(auditLog).where(eq(auditLog.organisationId, fx.orgId));
      await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, fx.orgId));
      await db.delete(organisation).where(eq(organisation.organisationId, fx.orgId));
    }
    for (const id of [fx.userA, fx.userB]) if (id) await db.delete(user).where(eq(user.userId, id));
  });

  describe("SHORT", () => {
    it("is refused with 400 when no quantity is given", async () => {
      const s = await sentPO([{ ingredientId: fx.flourId, qty: "5", unit: "kg" }]);
      const out = await call(handleActionLine, {
        params: { sessionId: s.sessionId, lineId: s.line(fx.flourId).receivingLineId },
        body: { status: "SHORT" },
      });
      expect(out.status).toBe(400);
      expect(out.body.code).toBe("SHORT_QTY_REQUIRED");
    });

    it.each([
      { status: "SHORT", receivedQty: "" },
      { status: "SHORT", receivedQty: " " },
      { status: "PRICE_VARIANCE", actualUnitCost: "" },
    ])("is refused with 400 when the number is blank: %o", async (body) => {
      const s = await sentPO([{ ingredientId: fx.flourId, qty: "5", unit: "kg" }]);
      const lineId = s.line(fx.flourId).receivingLineId;
      const out = await call(handleActionLine, { params: { sessionId: s.sessionId, lineId }, body });
      expect(out.status).toBe(400);
    });

    it.each(["5", "7"])("is refused with 400 when the quantity (%s) is not less than ordered (5)", async (qty) => {
      const s = await sentPO([{ ingredientId: fx.flourId, qty: "5", unit: "kg" }]);
      const out = await call(handleActionLine, {
        params: { sessionId: s.sessionId, lineId: s.line(fx.flourId).receivingLineId },
        body: { status: "SHORT", receivedQty: qty },
      });
      expect(out.status).toBe(400);
      expect(out.body.code).toBe("SHORT_QTY_NOT_LESS");
    });

    it("accepts a quantity below ordered, including zero, and records the shortage", async () => {
      const s = await sentPO([{ ingredientId: fx.flourId, qty: "5", unit: "kg" }]);
      const out = await call(handleActionLine, {
        params: { sessionId: s.sessionId, lineId: s.line(fx.flourId).receivingLineId },
        body: { status: "SHORT", receivedQty: "0" },
      });
      expect(out.status).toBe(200);
      expect(Number((out.body.discrepancy as { shortageQty: string }).shortageQty)).toBe(5);
    });
  });

  describe("a price change", () => {
    it("is refused with 400 when the new price is missing, instead of recording -100%", async () => {
      const s = await sentPO([{ ingredientId: fx.flourId, qty: "5", unit: "kg" }]);
      const out = await call(handleActionLine, {
        params: { sessionId: s.sessionId, lineId: s.line(fx.flourId).receivingLineId },
        body: { status: "PRICE_VARIANCE" },
      });
      expect(out.status).toBe(400);
      expect(out.body.code).toBe("PRICE_REQUIRED");
    });

    it("records the variance against the PO price when the new price is given", async () => {
      const s = await sentPO([{ ingredientId: fx.flourId, qty: "5", unit: "kg", cost: "2" }]);
      const out = await call(handleActionLine, {
        params: { sessionId: s.sessionId, lineId: s.line(fx.flourId).receivingLineId },
        body: { status: "PRICE_VARIANCE", actualUnitCost: "3" },
      });
      expect(out.status).toBe(200);
      expect(Number((out.body.discrepancy as { variancePct: string }).variancePct)).toBeCloseTo(50);
    });
  });

  describe("a PO line whose unit has no path to the base unit", () => {
    it("answers 400 naming the item, writes nothing, and leaves the session ACTIVE", async () => {
      const s = await sentPO([
        { ingredientId: fx.flourId, qty: "5", unit: "kg" },
        { ingredientId: fx.tinId, qty: "2", unit: "case" },
      ]);
      const flourBefore = await stock(fx.flourId);

      const out = await call(handleConfirmReceipt, { params: { sessionId: s.sessionId } });
      expect(out.status).toBe(400);
      expect(out.body.code).toBe("UNIT_NOT_CONVERTIBLE");
      expect(String(out.body.error)).toContain("tomatoes");
      expect(await stock(fx.flourId)).toBe(flourBefore);

      const after = await receivingService.getSession(s.sessionId, fx.orgId);
      expect(after!.session.status).toBe("ACTIVE");
    });

    it("is not a trap: rejecting that line lets the rest of the delivery be confirmed", async () => {
      const s = await sentPO([
        { ingredientId: fx.flourId, qty: "5", unit: "kg" },
        { ingredientId: fx.tinId, qty: "2", unit: "case" },
      ]);
      const flourBefore = await stock(fx.flourId);

      await receivingService.actionLine(
        s.line(fx.tinId).receivingLineId,
        s.sessionId,
        { status: "REJECTED", rejectionReason: "other" },
        fx.orgId,
        fx.userA,
      );
      const done = await receivingService.confirmReceipt(s.sessionId, fx.orgId, fx.userA);
      expect(done.poStatus).toBe("PARTIAL_RECEIVED");
      expect(await stock(fx.flourId)).toBe(flourBefore + 5);
    });
  });

  describe("a delivery belongs to the order's own location", () => {
    it("refuses to start it at another location, and leaves the order waiting", async () => {
      const [po] = await db
        .insert(purchaseOrder)
        .values({
          organisationId: fx.orgId,
          storeLocationId: fx.locId,
          supplierId: fx.supplierId,
          poNumber: `${fx.tag}-${fx.poIds.length}`.slice(0, 50),
          status: "SENT",
          createdByUserId: fx.userA,
        })
        .returning({ id: purchaseOrder.poId });
      fx.poIds.push(po.id);

      await expect(receivingService.startSession(po.id, randomUUID(), fx.userA, fx.orgId)).rejects.toMatchObject({
        statusCode: 403,
        code: "LOCATION_NOT_ALLOWED",
      });
      const [after] = await db.select({ status: purchaseOrder.status }).from(purchaseOrder).where(eq(purchaseOrder.poId, po.id));
      expect(after.status).toBe("SENT");
      expect(await db.select().from(receivingSession).where(eq(receivingSession.poId, po.id))).toHaveLength(0);
    });
  });

  describe("two phones on one session", () => {
    it("tells a phone that cancels a delivery another phone confirmed that it is already confirmed", async () => {
      const s = await sentPO([{ ingredientId: fx.flourId, qty: "5", unit: "kg" }]);
      await receivingService.confirmReceipt(s.sessionId, fx.orgId, fx.userA);
      await expect(receivingService.cancelSession(s.sessionId, fx.orgId, fx.userB)).rejects.toMatchObject({
        statusCode: 409,
        code: "ALREADY_CONFIRMED",
      });
    });

    it("tells a phone that confirms a delivery another phone cancelled that it is not active, never that it is confirmed", async () => {
      const s = await sentPO([{ ingredientId: fx.flourId, qty: "5", unit: "kg" }]);
      await receivingService.cancelSession(s.sessionId, fx.orgId, fx.userA);
      await expect(receivingService.confirmReceipt(s.sessionId, fx.orgId, fx.userB)).rejects.toMatchObject({
        statusCode: 409,
        code: "INVALID_STATE",
      });
    });

    it("tells the second phone the session was started by someone else", async () => {
      const s = await sentPO([{ ingredientId: fx.flourId, qty: "5", unit: "kg" }]);
      const again = await receivingService.startSession(s.poId, fx.locId, fx.userB, fx.orgId);
      expect(again.session.sessionId).toBe(s.sessionId);
      expect(again.resumed).toBe(true);
      expect(again.startedBy).toEqual({ userId: fx.userA, userName: "RCP Alice" });

      const mine = await receivingService.startSession(s.poId, fx.locId, fx.userA, fx.orgId);
      expect(mine.startedBy).toEqual({ userId: fx.userA, userName: "RCP Alice" });
    });

    it("a fresh start is not marked resumed", async () => {
      const s = await sentPO([{ ingredientId: fx.flourId, qty: "5", unit: "kg" }]);
      expect(s.started.resumed).toBe(false);
      expect(s.started.startedBy).toEqual({ userId: fx.userA, userName: "RCP Alice" });
    });

    it("the audit rows name whoever acted, not whoever started the session", async () => {
      const s = await sentPO([{ ingredientId: fx.flourId, qty: "5", unit: "kg" }]);
      await receivingService.actionLine(
        s.line(fx.flourId).receivingLineId,
        s.sessionId,
        { status: "SHORT", receivedQty: "3" },
        fx.orgId,
        fx.userB,
      );
      await receivingService.confirmReceipt(s.sessionId, fx.orgId, fx.userB);

      const rows = await db
        .select({ entityType: auditLog.entityType, action: auditLog.action, actor: auditLog.actorUserId })
        .from(auditLog)
        .where(inArray(auditLog.entityId, [s.line(fx.flourId).receivingLineId, s.sessionId]));
      const actors = Object.fromEntries(rows.map((r) => [`${r.entityType}/${r.action}`, r.actor]));
      expect(actors["receiving_line/update"]).toBe(fx.userB);
      expect(actors["receiving_session/complete"]).toBe(fx.userB);
    });

    it("a cancel by the second phone is recorded against it", async () => {
      const s = await sentPO([{ ingredientId: fx.flourId, qty: "5", unit: "kg" }]);
      await receivingService.cancelSession(s.sessionId, fx.orgId, fx.userB);
      const [row] = await db
        .select({ actor: auditLog.actorUserId })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, s.sessionId), eq(auditLog.action, "cancel")));
      expect(row.actor).toBe(fx.userB);
    });
  });
});

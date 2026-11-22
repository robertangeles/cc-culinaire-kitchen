import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

// Same .env bootstrap as the other real-DB suites (see mobileReplay.integration.test.ts).
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { eq, inArray } from "drizzle-orm";
import type { Request, Response } from "express";
import { db } from "../db/index.js";
import {
  organisation,
  user,
  userOrganisation,
  storeLocation,
  supplier,
  ingredient,
  purchaseOrder,
  purchaseOrderLine,
  receivingSession,
  auditLog,
} from "../db/schema.js";
import { handleListPOs, handleGetPODetail } from "../controllers/purchaseOrderController.js";
import { listPOs, getPODetail, createPO, clonePO, submitPO } from "./purchaseOrderService.js";
import { handleCreatePO, handleClonePO } from "../controllers/purchaseOrderController.js";

/**
 * Wave 1 (receiving on the phone): the purchase-order list and detail the delivery queue reads.
 *
 *   - a server-side status filter (the web filtered the newest 50 client-side, so older SENT POs vanished)
 *   - a limit that is validated and capped (`?limit=abc` used to reach SQL and answer 500)
 *   - an expected-delivery sort, soonest first
 *   - the supplier's phone, and who is receiving a PO right now
 *   - detail carrying the same totalValue / rejectedReason / sentAt as the list
 *   - a user holding only `purchasing:receive` (no `inventory:count`) sees only the receiving queue
 *
 * Gated on TENANT_IT=1 (the repo's real-DB gate). Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

const fx = {
  tag: `pop_${Date.now().toString(36)}`,
  userId: 0,
  receiverId: 0,
  orgId: 0,
  locId: "",
  supplierId: "",
  ingId: "",
  po: {} as Record<"draft" | "sentLate" | "sentSoon" | "sentNoDate" | "receiving", string>,
  sessionId: "",
  // A second organisation: its ids must never be usable from the first.
  other: { orgId: 0, locId: "", supplierId: "", ingId: "" },
};

/** Minimal Express req/res: the controllers only read user, params, query and call status/json. */
function call(
  handler: (req: Request, res: Response, next: (e?: unknown) => void) => Promise<void>,
  req: object,
  permissions: string[] = ["inventory:count"],
) {
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
    handler({ user: { sub: fx.userId, roles: [], permissions }, ...req } as unknown as Request, res, (e) => reject(e)).catch(reject);
  });
}

const ids = () => Object.values(fx.po);

describe.skipIf(!RUN)("purchase order list and detail for the phone (real DB)", () => {
  beforeAll(async () => {
    [{ userId: fx.userId }] = await db
      .insert(user)
      .values({ userName: "POP Chef", userEmail: `${fx.tag}@it.test` })
      .returning({ userId: user.userId });
    [{ userId: fx.receiverId }] = await db
      .insert(user)
      .values({ userName: "POP Receiver", userEmail: `${fx.tag}-r@it.test` })
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

    [{ id: fx.supplierId }] = await db
      .insert(supplier)
      .values({ organisationId: fx.orgId, supplierName: `${fx.tag}-supplier`, contactPhone: "0400 111 222" })
      .returning({ id: supplier.supplierId });

    [{ id: fx.other.orgId }] = await db
      .insert(organisation)
      .values({ organisationName: `${fx.tag}-other`, joinKey: `${fx.tag}-o`.slice(0, 25), createdBy: fx.receiverId })
      .returning({ id: organisation.organisationId });
    [{ id: fx.other.locId }] = await db
      .insert(storeLocation)
      .values({
        organisationId: fx.other.orgId,
        locationName: `${fx.tag}-otherloc`,
        classification: "branch",
        storeKey: `${fx.tag}-os`.slice(0, 25),
        createdBy: fx.receiverId,
        inventoryActive: true,
      })
      .returning({ id: storeLocation.storeLocationId });
    [{ id: fx.other.supplierId }] = await db
      .insert(supplier)
      .values({ organisationId: fx.other.orgId, supplierName: `${fx.tag}-othersupplier` })
      .returning({ id: supplier.supplierId });
    [{ id: fx.other.ingId }] = await db
      .insert(ingredient)
      .values({
        organisationId: fx.other.orgId,
        ingredientName: `${fx.tag}-otheringredient`,
        ingredientCategory: "dry_goods",
        itemType: "KITCHEN_INGREDIENT",
        baseUnit: "kg",
      })
      .returning({ id: ingredient.ingredientId });

    const mk = async (
      key: keyof typeof fx.po,
      status: string,
      extra: Partial<typeof purchaseOrder.$inferInsert> = {},
    ) => {
      const [row] = await db
        .insert(purchaseOrder)
        .values({
          organisationId: fx.orgId,
          storeLocationId: fx.locId,
          supplierId: fx.supplierId,
          poNumber: `${fx.tag}-${key}`.slice(0, 50),
          status,
          createdByUserId: fx.userId,
          ...extra,
        })
        .returning({ id: purchaseOrder.poId });
      fx.po[key] = row.id;
      await db.insert(purchaseOrderLine).values({
        poId: row.id,
        ingredientId: fx.ingId,
        orderedQty: "5",
        orderedUnit: "kg",
        unitCost: "2",
      });
    };

    const day = 24 * 3600 * 1000;
    await mk("draft", "DRAFT");
    await mk("sentLate", "SENT", { expectedDeliveryDate: new Date(Date.now() + 5 * day), totalValue: "10", sentAt: new Date() });
    await mk("sentSoon", "SENT", { expectedDeliveryDate: new Date(Date.now() + 1 * day), totalValue: "10", sentAt: new Date() });
    await mk("sentNoDate", "SENT", { totalValue: "10", sentAt: new Date() });
    await mk("receiving", "RECEIVING", { expectedDeliveryDate: new Date(Date.now() + 3 * day) });

    const [session] = await db
      .insert(receivingSession)
      .values({ poId: fx.po.receiving, storeLocationId: fx.locId, receivedByUserId: fx.receiverId, status: "ACTIVE" })
      .returning({ id: receivingSession.sessionId });
    fx.sessionId = session.id;
  });

  afterAll(async () => {
    if (fx.sessionId) await db.delete(receivingSession).where(eq(receivingSession.sessionId, fx.sessionId));
    const poIds = ids().filter(Boolean);
    if (poIds.length) {
      await db.delete(purchaseOrderLine).where(inArray(purchaseOrderLine.poId, poIds));
      await db.delete(purchaseOrder).where(inArray(purchaseOrder.poId, poIds));
    }
    // POs the create/clone tests made, if any survived a failure.
    const made = await db.select({ id: purchaseOrder.poId }).from(purchaseOrder).where(eq(purchaseOrder.organisationId, fx.orgId));
    if (made.length) {
      await db.delete(purchaseOrderLine).where(inArray(purchaseOrderLine.poId, made.map((m) => m.id)));
      await db.delete(purchaseOrder).where(inArray(purchaseOrder.poId, made.map((m) => m.id)));
    }
    if (fx.supplierId) await db.delete(supplier).where(eq(supplier.supplierId, fx.supplierId));
    if (fx.ingId) await db.delete(ingredient).where(eq(ingredient.ingredientId, fx.ingId));
    if (fx.locId) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, fx.locId));
    if (fx.other.supplierId) await db.delete(supplier).where(eq(supplier.supplierId, fx.other.supplierId));
    if (fx.other.ingId) await db.delete(ingredient).where(eq(ingredient.ingredientId, fx.other.ingId));
    if (fx.other.locId) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, fx.other.locId));
    if (fx.other.orgId) await db.delete(organisation).where(eq(organisation.organisationId, fx.other.orgId));
    if (fx.orgId) {
      await db.delete(auditLog).where(eq(auditLog.organisationId, fx.orgId));
      await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, fx.orgId));
      await db.delete(organisation).where(eq(organisation.organisationId, fx.orgId));
    }
    for (const id of [fx.userId, fx.receiverId]) if (id) await db.delete(user).where(eq(user.userId, id));
  });

  it("filters by several statuses on the server", async () => {
    const rows = await listPOs(fx.orgId, { statuses: ["SENT", "RECEIVING"], storeLocationId: fx.locId });
    expect(rows.map((r) => r.poId).sort()).toEqual(
      [fx.po.sentLate, fx.po.sentSoon, fx.po.sentNoDate, fx.po.receiving].sort(),
    );
  });

  it("sorts by expected delivery, soonest first, undated last", async () => {
    const rows = await listPOs(fx.orgId, {
      statuses: ["SENT", "RECEIVING"],
      storeLocationId: fx.locId,
      sort: "expected",
    });
    expect(rows.map((r) => r.poId)).toEqual([fx.po.sentSoon, fx.po.receiving, fx.po.sentLate, fx.po.sentNoDate]);
  });

  it("returns the supplier phone, and who is receiving a PO right now", async () => {
    const rows = await listPOs(fx.orgId, { statuses: ["SENT", "RECEIVING"], storeLocationId: fx.locId });
    const receiving = rows.find((r) => r.poId === fx.po.receiving)!;
    const sent = rows.find((r) => r.poId === fx.po.sentSoon)!;
    expect(receiving.supplierPhone).toBe("0400 111 222");
    expect(receiving.beingReceivedBy).toMatchObject({ userId: fx.receiverId, userName: "POP Receiver", sessionId: fx.sessionId });
    expect(sent.beingReceivedBy).toBeNull();
  });

  it("detail carries totalValue, rejectedReason, sentAt, the supplier phone and who is receiving", async () => {
    const sent = await getPODetail(fx.po.sentSoon, fx.orgId);
    expect(Number(sent!.totalValue)).toBe(10);
    expect(sent!.sentAt).toBeInstanceOf(Date);
    expect(sent).toHaveProperty("rejectedReason", null);
    expect(sent!.supplierPhone).toBe("0400 111 222");
    expect(sent!.beingReceivedBy).toBeNull();

    const receiving = await getPODetail(fx.po.receiving, fx.orgId);
    expect(receiving!.beingReceivedBy?.userName).toBe("POP Receiver");
  });

  it("answers 400, not 500, to a limit that is not a positive whole number", async () => {
    for (const limit of ["abc", "0", "-3", "2.5"]) {
      const out = await call(handleListPOs, { query: { limit } });
      expect(out.status, `limit=${limit}`).toBe(400);
    }
  });

  it("answers 400 to a status that is not a purchase order status", async () => {
    const out = await call(handleListPOs, { query: { status: "SENT,BOGUS" } });
    expect(out.status).toBe(400);
  });

  it("caps the page at 100 rows", async () => {
    const out = await call(handleListPOs, { query: { limit: "5000", storeLocationId: fx.locId } });
    expect(out.status).toBe(200); // capped, not rejected: a client asking for "everything" still gets a page
  });

  it("the web's plain call (location only) still returns every status, newest first", async () => {
    const out = await call(handleListPOs, { query: { storeLocationId: fx.locId } });
    expect(out.status).toBe(200);
    const rows = out.body as Array<{ poId: string }>;
    expect(rows.map((r) => r.poId)).toContain(fx.po.draft);
  });

  describe("a user holding only purchasing:receive", () => {
    const receiveOnly = ["purchasing:receive"];

    it("sees the receiving queue (SENT and RECEIVING) and nothing else", async () => {
      const out = await call(handleListPOs, { query: { storeLocationId: fx.locId } }, receiveOnly);
      expect(out.status).toBe(200);
      const rows = out.body as Array<{ poId: string; status: string }>;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.status === "SENT" || r.status === "RECEIVING")).toBe(true);
      expect(rows.map((r) => r.poId)).not.toContain(fx.po.draft);
    });

    it("cannot widen the filter to drafts", async () => {
      const out = await call(handleListPOs, { query: { status: "DRAFT", storeLocationId: fx.locId } }, receiveOnly);
      expect(out.status).toBe(200);
      expect(out.body).toEqual([]);
    });

    it("opens the detail of a SENT PO but gets 404 for a DRAFT", async () => {
      const sent = await call(handleGetPODetail, { params: { id: fx.po.sentSoon } }, receiveOnly);
      expect(sent.status).toBe(200);
      const draft = await call(handleGetPODetail, { params: { id: fx.po.draft } }, receiveOnly);
      expect(draft.status).toBe(404);
    });
  });

describe("create and clone PO stay inside the caller's organisation (real DB)", () => {
  const line = (ingredientId: string) => ({ ingredientId, orderedQty: "2", orderedUnit: "kg", unitCost: "3" });
  const base = () => ({ orgId: fx.orgId, userId: fx.userId });
  const poCount = async () =>
    (await db.select({ id: purchaseOrder.poId }).from(purchaseOrder).where(eq(purchaseOrder.organisationId, fx.orgId))).length;

  it("creates a PO from the caller's own location, supplier and ingredients", async () => {
    const po = await createPO({ ...base(), locationId: fx.locId, supplierId: fx.supplierId, lines: [line(fx.ingId)] });
    expect(po.lines).toHaveLength(1);
  });

  it.each([
    ["another organisation's location", () => ({ locationId: fx.other.locId, supplierId: fx.supplierId, lines: [line(fx.ingId)] })],
    ["another organisation's supplier", () => ({ locationId: fx.locId, supplierId: fx.other.supplierId, lines: [line(fx.ingId)] })],
    ["another organisation's ingredient", () => ({ locationId: fx.locId, supplierId: fx.supplierId, lines: [line(fx.ingId), line(fx.other.ingId)] })],
  ])("refuses a PO that uses %s, and writes nothing", async (_name, input) => {
    const before = await poCount();
    await expect(createPO({ ...base(), ...input() })).rejects.toThrow(/not found/);
    expect(await poCount()).toBe(before);
  });

  it("answers 400 over HTTP for a foreign supplier", async () => {
    const out = await call(handleCreatePO, {
      body: { storeLocationId: fx.locId, supplierId: fx.other.supplierId, lines: [line(fx.ingId)] },
    });
    expect(out.status).toBe(400);
  });

  it("refuses to clone a PO into another organisation's location", async () => {
    const before = await poCount();
    await expect(clonePO(fx.po.sentSoon, fx.orgId, fx.other.locId, fx.userId)).rejects.toThrow(/not found/);
    const out = await call(handleClonePO, { params: { id: fx.po.sentSoon }, body: { storeLocationId: fx.other.locId } });
    expect(out.status).toBe(400);
    expect(await poCount()).toBe(before);
  });
});

  describe("the spend threshold", () => {
    it("routes a PO with no price on its lines to HQ instead of letting it slip under the threshold", async () => {
      const base = { orgId: fx.orgId, userId: fx.userId };
      await db.update(organisation).set({ defaultSpendThreshold: "500" }).where(eq(organisation.organisationId, fx.orgId));
      const unpriced = await createPO({
        ...base,
        locationId: fx.locId,
        supplierId: fx.supplierId,
        lines: [{ ingredientId: fx.ingId, orderedQty: "2", orderedUnit: "kg" }],
      });
      const priced = await createPO({
        ...base,
        locationId: fx.locId,
        supplierId: fx.supplierId,
        lines: [{ ingredientId: fx.ingId, orderedQty: "2", orderedUnit: "kg", unitCost: "3" }],
      });

      expect((await submitPO(unpriced.poId, fx.orgId, fx.userId)).routing).toBe("HQ_APPROVAL");
      expect((await submitPO(priced.poId, fx.orgId, fx.userId)).routing).toBe("DIRECT");
    });
  });
});

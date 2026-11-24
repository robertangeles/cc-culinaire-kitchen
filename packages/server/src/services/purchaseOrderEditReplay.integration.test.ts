import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { applyEnvPrefix } from "../utils/envShim.js";

// Same .env bootstrap as the other real-DB suites (see mobileReplay.integration.test.ts).
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLog, notification, organisation, purchaseOrder, purchaseOrderLine, supplier } from "../db/schema.js";
import { handleCreatePO, handleUpdatePO } from "../controllers/purchaseOrderController.js";
import { submitPO } from "./purchaseOrderService.js";
import { asUser, callHandler, createLineLoopFx, removeLineLoopFx, type LineLoopFx } from "./lineLoopFixture.js";

/**
 * Wave 5 (orders on the phone), the two server additions the order form needs:
 *
 *   - POST /purchase-orders takes a client-made `poId`: the same body again answers the first order (200), another
 *     body, another user's or another organisation's order under that id is 409 CONFLICT
 *   - PUT /purchase-orders/:id replaces a DRAFT's header and lines; any other status is 409 INVALID_STATE
 *
 * Gated on TENANT_IT=1 (the repo's real-DB gate). Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";
const MANAGE = ["inventory:count", "inventory:manage"];

let fx: LineLoopFx;
let other: LineLoopFx;
let sup = "";
let sup2 = "";
let otherSup = "";

const mkSupplier = async (orgId: number, name: string) =>
  (await db.insert(supplier).values({ organisationId: orgId, supplierName: name }).returning({ id: supplier.supplierId }))[0].id;

const body = (over: object = {}) => ({
  storeLocationId: fx.locA,
  supplierId: sup,
  lines: [
    { ingredientId: fx.ingId, orderedQty: "2", orderedUnit: "kg", unitCost: "3.50" },
    { ingredientId: fx.ingNoStockId, orderedQty: "1", orderedUnit: "each" },
  ],
  notes: "Back door",
  expectedDeliveryDate: "2026-12-01",
  ...over,
});
const create = (b: object, sub = fx.chef) => callHandler(handleCreatePO, asUser(sub, MANAGE), { body: b });
const edit = (id: string, b: object, sub = fx.chef) => callHandler(handleUpdatePO, asUser(sub, MANAGE), { params: { id }, body: b });
const row = async (poId: string) => (await db.select().from(purchaseOrder).where(eq(purchaseOrder.poId, poId)))[0];
const linesOf = (poId: string) => db.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.poId, poId));
const auditOf = (poId: string, action: string) =>
  db.select().from(auditLog).where(and(eq(auditLog.entityId, poId), eq(auditLog.action, action)));
const setStatus = (poId: string, status: string) => db.update(purchaseOrder).set({ status }).where(eq(purchaseOrder.poId, poId));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!RUN)("purchase order edit and idempotent create (real DB)", () => {
  beforeAll(async () => {
    const tag = `poe_${Date.now().toString(36)}`;
    fx = await createLineLoopFx(tag);
    other = await createLineLoopFx(`${tag}o`);
    sup = await mkSupplier(fx.orgId, `${tag}-sup`);
    sup2 = await mkSupplier(fx.orgId, `${tag}-sup2`);
    otherSup = await mkSupplier(other.orgId, `${tag}-othersup`);
  });

  afterAll(async () => {
    const orgs = [fx.orgId, other.orgId];
    const ids = (await db.select({ id: purchaseOrder.poId }).from(purchaseOrder).where(inArray(purchaseOrder.organisationId, orgs))).map((r) => r.id);
    if (ids.length) {
      await db.delete(purchaseOrderLine).where(inArray(purchaseOrderLine.poId, ids));
      await db.delete(purchaseOrder).where(inArray(purchaseOrder.poId, ids));
    }
    await db.delete(notification).where(inArray(notification.organisationId, orgs));
    await db.delete(supplier).where(inArray(supplier.organisationId, orgs));
    await removeLineLoopFx(fx);
    await removeLineLoopFx(other);
  });

  describe("POST /purchase-orders with a client-made poId", () => {
    it("answers the first order to the same body sent again, and makes nothing", async () => {
      const poId = randomUUID();
      const first = await create(body({ poId }));
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ poId, status: "DRAFT", createdByUserId: fx.chef });
      expect(first.body.lines).toHaveLength(2);

      const again = await create(body({ poId }));
      expect(again.status).toBe(200);
      const sorted = (o: typeof first) => ({ ...o.body, lines: [...o.body.lines].sort((a, b) => a.lineId.localeCompare(b.lineId)) });
      expect(sorted(again)).toEqual(sorted(first));
      expect(again.body).not.toHaveProperty("replay");
      expect(await linesOf(poId)).toHaveLength(2);
    });

    it("accepts the id in capitals as the same id", async () => {
      const poId = randomUUID();
      await create(body({ poId }));
      expect(await create(body({ poId: poId.toUpperCase() }))).toMatchObject({ status: 200, body: { poId } });
    });

    it.each([
      ["another quantity", () => ({ lines: [{ ...body().lines[0], orderedQty: "3" }, body().lines[1]] })],
      ["a line less", () => ({ lines: [body().lines[0]] })],
      ["another supplier", () => ({ supplierId: sup2 })],
      ["another note", () => ({ notes: "Front door" })],
      ["no delivery date", () => ({ expectedDeliveryDate: undefined })],
    ])("answers 409 CONFLICT to the same id with %s, and changes nothing", async (_name, over) => {
      const poId = randomUUID();
      await create(body({ poId }));
      const before = { po: await row(poId), lines: await linesOf(poId) };
      const out = await create(body({ poId, ...over() }));
      expect(out).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
      expect(out.body).not.toHaveProperty("lines");
      expect({ po: await row(poId), lines: await linesOf(poId) }).toEqual(before);
    });

    it("still answers the order, as it is now, after it was edited and submitted", async () => {
      const poId = randomUUID();
      await create(body({ poId }));
      await edit(poId, body({ notes: "Edited", lines: [body().lines[0]] }));
      await setStatus(poId, "SENT");
      const out = await create(body({ poId }));
      expect(out).toMatchObject({ status: 200, body: { poId, status: "SENT", notes: "Edited" } });
      expect(out.body.lines).toHaveLength(1);
      // The edited body is not what made the order.
      expect(await create(body({ poId, notes: "Edited", lines: [body().lines[0]] }))).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
    });

    it("still answers the order when its supplier has since left the organisation", async () => {
      const gone = await mkSupplier(fx.orgId, "gone");
      const poId = randomUUID();
      await create(body({ poId, supplierId: gone }));
      await db.update(supplier).set({ organisationId: other.orgId }).where(eq(supplier.supplierId, gone));
      expect((await create(body({ poId, supplierId: gone }))).status).toBe(200);
    });

    it("never answers another user's or another organisation's order", async () => {
      const poId = randomUUID();
      await create(body({ poId }));
      expect(await create(body({ poId }), fx.cook)).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
      const foreign = await create(
        { storeLocationId: other.locA, supplierId: otherSup, lines: [{ ingredientId: other.ingId, orderedQty: "1", orderedUnit: "kg" }], poId },
        other.chef,
      );
      expect(foreign).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
      expect(foreign.body).not.toHaveProperty("poNumber");
    });

    it("answers 409 CONFLICT to the id of an order made without one", async () => {
      const { body: made } = await create(body());
      expect(await create(body({ poId: made.poId }))).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
    });

    it("makes one order when the same create arrives twice at once", async () => {
      const poId = randomUUID();
      const out = await Promise.all([1, 2, 3].map(() => create(body({ poId }))));
      expect(out.map((o) => o.status).sort()).toEqual([200, 200, 201]);
      expect(await linesOf(poId)).toHaveLength(2);
    });

    it("leaves no order behind when a line is refused, so the corrected body can use the id", async () => {
      const poId = randomUUID();
      const bad = await create(body({ poId, lines: [{ ...body().lines[0], ingredientId: other.ingId }] }));
      expect(bad).toMatchObject({ status: 400, body: { error: "Ingredient not found", code: "VALIDATION" } });
      expect((await create(body({ poId }))).status).toBe(201);
    });

    it("without poId works as before: every send is a new order", async () => {
      const a = await create(body());
      const b = await create(body());
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.poId).not.toBe(b.body.poId);
    });

    it.each([
      ["a poId that is not a UUID", () => ({ poId: "po-1" })],
      ["a date that is not one", () => ({ expectedDeliveryDate: "soon" })],
      ["a blank price", () => ({ lines: [{ ...body().lines[0], unitCost: "" }] })],
      ["an endless quantity", () => ({ lines: [{ ...body().lines[0], orderedQty: "Infinity" }] })],
      ["no lines", () => ({ lines: [] })],
    ])("answers 400 VALIDATION to %s", async (_name, over) => {
      expect(await create(body(over()))).toMatchObject({ status: 400, body: { error: "Validation failed", code: "VALIDATION" } });
    });
  });

  describe("PUT /purchase-orders/:id", () => {
    const mk = async (over: object = {}) => (await create(body(over))).body.poId as string;

    it("replaces the header and the lines of a draft, keeping its number, creator and status", async () => {
      const poId = await mk();
      const before = await row(poId);
      const out = await edit(poId, {
        storeLocationId: fx.locA,
        supplierId: sup2,
        lines: [{ ingredientId: fx.ingNoStockId, orderedQty: "7.5", orderedUnit: "kg" }],
      });
      expect(out.status).toBe(200);
      expect(out.body).toMatchObject({ poId, poNumber: before.poNumber, status: "DRAFT", supplierId: sup2, notes: null, expectedDeliveryDate: null, createdByUserId: fx.chef });
      expect(out.body.lines).toHaveLength(1);
      expect(out.body.lines[0]).toMatchObject({ ingredientId: fx.ingNoStockId, orderedQty: "7.5", unitCost: null, lineStatus: "PENDING" });
      expect(await linesOf(poId)).toHaveLength(1);
      expect((await row(poId)).updatedDttm.getTime()).toBeGreaterThanOrEqual(before.updatedDttm.getTime());
    });

    it("answers the same order to the same edit sent again", async () => {
      const poId = await mk();
      const again = body({ notes: "Twice" });
      expect((await edit(poId, again)).status).toBe(200);
      expect(await edit(poId, again)).toMatchObject({ status: 200, body: { notes: "Twice" } });
      expect(await linesOf(poId)).toHaveLength(2);
    });

    it("leaves an audit row with the order before and after", async () => {
      const poId = await mk();
      await edit(poId, body({ notes: "Edited", lines: [body().lines[0]] }), fx.cook);
      const [audit] = await auditOf(poId, "update");
      expect(audit).toMatchObject({ actorUserId: fx.cook, organisationId: fx.orgId, beforeValue: { notes: "Back door" }, afterValue: { notes: "Edited" } });
      expect((audit.beforeValue as { lines: unknown[] }).lines).toHaveLength(2);
      expect((audit.afterValue as { lines: unknown[] }).lines).toHaveLength(1);
    });

    it("drops the total of an earlier submission from a rejected draft, and keeps the reason it was rejected", async () => {
      const poId = await mk();
      await db.update(purchaseOrder).set({ totalValue: "900", rejectedReason: "Too much" }).where(eq(purchaseOrder.poId, poId));
      expect((await edit(poId, body())).body).toMatchObject({ totalValue: null, rejectedReason: "Too much" });
    });

    it.each(["PENDING_APPROVAL", "SENT", "RECEIVING", "RECEIVED", "PARTIAL_RECEIVED", "CANCELLED"])("refuses a %s order with 409 INVALID_STATE, and changes nothing", async (status) => {
      const poId = await mk();
      await setStatus(poId, status);
      const before = { po: await row(poId), lines: await linesOf(poId) };
      expect(await edit(poId, body({ notes: "Late" }))).toMatchObject({ status: 409, body: { code: "INVALID_STATE" } });
      expect({ po: await row(poId), lines: await linesOf(poId) }).toEqual(before);
    });

    it("answers 404 to an unknown order and to another organisation's", async () => {
      expect(await edit(randomUUID(), body())).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
      const poId = await mk();
      const foreign = await edit(
        poId,
        { storeLocationId: other.locA, supplierId: otherSup, lines: [{ ingredientId: other.ingId, orderedQty: "1", orderedUnit: "kg" }] },
        other.chef,
      );
      expect(foreign).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
    });

    it("needs access to the order's location and to the one it moves to", async () => {
      const poId = await mk();
      // chef works at A only, stranger at B only, roamer at both.
      expect(await edit(poId, body({ storeLocationId: fx.locB }))).toMatchObject({ status: 403, body: { code: "LOCATION_NOT_ALLOWED" } });
      expect(await edit(poId, body({ storeLocationId: fx.locB }), fx.stranger)).toMatchObject({ status: 403, body: { code: "LOCATION_NOT_ALLOWED" } });
      expect(await edit(poId, body({ storeLocationId: fx.locB }), fx.roamer)).toMatchObject({ status: 200, body: { storeLocationId: fx.locB } });
    });

    it.each([
      ["another organisation's supplier", () => ({ supplierId: otherSup }), "Supplier not found"],
      ["another organisation's ingredient", () => ({ lines: [{ ...body().lines[0], ingredientId: other.ingId }] }), "Ingredient not found"],
    ])("refuses %s with 400 VALIDATION, and keeps the old lines", async (_name, over, error) => {
      const poId = await mk();
      const before = await linesOf(poId);
      expect(await edit(poId, body(over()))).toMatchObject({ status: 400, body: { error, code: "VALIDATION" } });
      expect(await linesOf(poId)).toEqual(before);
    });

    it.each([
      ["no lines", () => ({ lines: [] })],
      ["a quantity of zero", () => ({ lines: [{ ...body().lines[0], orderedQty: "0" }] })],
      ["a date that is not one", () => ({ expectedDeliveryDate: "soon" })],
      ["a supplier that is not a UUID", () => ({ supplierId: "acme" })],
    ])("answers 400 VALIDATION to %s", async (_name, over) => {
      expect(await edit(await mk(), body(over()))).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
    });

    it("answers 400 VALIDATION to an id that is not a UUID", async () => {
      expect(await edit("po-1", body())).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
    });
  });

  describe("an edit and a submit at the same moment", () => {
    it("an edit that waited for a submit finds the order sent, and is refused", async () => {
      const poId = (await create(body())).body.poId;
      let editing!: ReturnType<typeof edit>;
      await db.transaction(async (tx) => {
        await tx.select().from(purchaseOrder).where(eq(purchaseOrder.poId, poId)).for("update");
        editing = edit(poId, body({ notes: "Late" }));
        await wait(200);
        await tx.update(purchaseOrder).set({ status: "SENT" }).where(eq(purchaseOrder.poId, poId));
      });
      expect(await editing).toMatchObject({ status: 409, body: { code: "INVALID_STATE" } });
    });

    it("a submit that waited for an edit is routed on the new lines, so an edit cannot slip an order under the threshold", async () => {
      await db.update(organisation).set({ defaultSpendThreshold: "500" }).where(eq(organisation.organisationId, fx.orgId));
      const poId = (await create(body({ lines: [body().lines[0]] }))).body.poId;
      let submitting!: ReturnType<typeof submitPO>;
      await db.transaction(async (tx) => {
        await tx.select().from(purchaseOrder).where(eq(purchaseOrder.poId, poId)).for("update");
        submitting = submitPO(poId, fx.orgId, fx.chef);
        await wait(200);
        await tx.update(purchaseOrderLine).set({ orderedQty: "1000" }).where(eq(purchaseOrderLine.poId, poId));
      });
      expect((await submitting).routing).toBe("HQ_APPROVAL");
      expect(await row(poId)).toMatchObject({ status: "PENDING_APPROVAL", totalValue: "3500" });
    });
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

// Same .env bootstrap as the other real-DB suites (see mobileReplay.integration.test.ts).
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

// The supplier email and its PDF are the only things faked: the claim on the order is real.
vi.mock("./emailService.js", async (orig) => ({ ...(await orig<object>()), sendPurchaseOrderEmail: vi.fn() }));
vi.mock("./pdfService.js", async (orig) => ({
  ...(await orig<object>()),
  generatePOPdf: vi.fn(async () => ({ buffer: Buffer.from("pdf"), poNumber: "PO" })),
}));

import { and, eq, inArray } from "drizzle-orm";
import type { Request, Response } from "express";
import { db } from "../db/index.js";
import {
  organisation,
  user,
  userOrganisation,
  userStoreLocation,
  userRole,
  role,
  storeLocation,
  supplier,
  ingredient,
  purchaseOrder,
  purchaseOrderLine,
  receivingSession,
  receivingLine,
  receivingDiscrepancy,
  creditNote,
  spendThreshold,
  notification,
  auditLog,
} from "../db/schema.js";
import {
  handleApprovePO,
  handleRejectPO,
  handleListPOs,
  handleGetPODetail,
  handleEmailPOToSupplier,
  handleSetOrgThreshold,
  handleSetLocationThreshold,
  handleRemoveLocationThreshold,
} from "../controllers/purchaseOrderController.js";
import {
  handleCreateCreditNote,
  handleGetCreditNotes,
  handleGetUnresolvedDiscrepancies,
} from "../controllers/receivingController.js";
import { errorHandler } from "../middleware/errorHandler.js";
import * as emailService from "./emailService.js";

/**
 * Wave 5 (orders, approvals and credit notes), the server side the phone will call:
 *
 *   - an approver cannot approve their own purchase order unless nobody else in the organisation can approve;
 *     approve and reject are atomic and leave an audit row naming who and when
 *   - spend thresholds: organisation admins only, an upper bound, the location must be the organisation's own, audited
 *   - send-email does not email the supplier twice within a few minutes
 *   - credit notes: one per discrepancy, capped at what the discrepancy is worth, safe to repeat with a client-made id,
 *     and a paged list of what is still open, for `purchasing:credit` holders across their organisation
 *
 * Gated on TENANT_IT=1 (the repo's real-DB gate). Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

const APPROVER = ["inventory:count", "purchasing:approve", "purchasing:submit"];
const CREDIT = ["purchasing:credit"];

const fx = {
  tag: `w5_${Date.now().toString(36)}`,
  // Organisation 1: two approvers (A is the org admin, B is not), a credit clerk at location A only, a suspended approver.
  orgId: 0,
  adminA: 0,
  approverB: 0,
  clerk: 0,
  locA: "",
  locB: "",
  supplierId: "",
  ingId: "",
  // Organisation 2: one approver only.
  solo: { orgId: 0, userId: 0, locId: "", supplierId: "", ingId: "" },
  users: [] as number[],
  orgs: [] as number[],
  locs: [] as string[],
};

/** Minimal Express req/res: the controllers read user, params, query and body, and call status/json. */
function call(
  handler: (req: Request, res: Response, next: (e?: unknown) => void) => Promise<void>,
  sub: number,
  permissions: string[],
  req: object = {},
) {
  return new Promise<{ status: number; body: any }>((resolveCall, reject) => {
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
      headersSent: false,
    } as unknown as Response;
    handler(
      { user: { sub, roles: [], permissions }, params: {}, query: {}, body: {}, ...req } as unknown as Request,
      res,
      (e) => errorHandler(e as Error, {} as Request, res, () => {}),
    ).catch(reject);
  });
}

async function mkUser(name: string, status = "active"): Promise<number> {
  const [{ userId }] = await db
    .insert(user)
    .values({ userName: name, userEmail: `${fx.tag}-${name}@it.test`, userStatus: status })
    .returning({ userId: user.userId });
  fx.users.push(userId);
  return userId;
}

async function grantOpsAdmin(userId: number) {
  const [ops] = await db.select({ roleId: role.roleId }).from(role).where(eq(role.roleName, "Operations Admin"));
  await db.insert(userRole).values({ userId, roleId: ops.roleId });
}

async function mkLocation(orgId: number, key: string, createdBy: number): Promise<string> {
  const [{ id }] = await db
    .insert(storeLocation)
    .values({
      organisationId: orgId,
      locationName: `${fx.tag}-${key}`,
      classification: "branch",
      storeKey: `${fx.tag}-${key}`.slice(0, 25),
      createdBy,
      inventoryActive: true,
    })
    .returning({ id: storeLocation.storeLocationId });
  fx.locs.push(id);
  return id;
}

async function mkPO(
  opts: { orgId: number; locId: string; supplierId: string; ingId: string; createdBy: number; status: string },
  line: { orderedQty?: string; unitCost?: string | null } = {},
) {
  const [po] = await db
    .insert(purchaseOrder)
    .values({
      organisationId: opts.orgId,
      storeLocationId: opts.locId,
      supplierId: opts.supplierId,
      poNumber: `${fx.tag}-${Math.random().toString(36).slice(2, 8)}`,
      status: opts.status,
      createdByUserId: opts.createdBy,
      totalValue: "100",
      submittedAt: new Date(),
    })
    .returning();
  const [poLine] = await db
    .insert(purchaseOrderLine)
    .values({
      poId: po.poId,
      ingredientId: opts.ingId,
      orderedQty: line.orderedQty ?? "10",
      orderedUnit: "kg",
      unitCost: line.unitCost === undefined ? "4" : line.unitCost,
    })
    .returning();
  return { poId: po.poId, poLineId: poLine.lineId };
}

const org1 = (createdBy: number, status: string) => ({
  orgId: fx.orgId,
  locId: fx.locA,
  supplierId: fx.supplierId,
  ingId: fx.ingId,
  createdBy,
  status,
});

/** A confirmed (or still open) delivery with one flagged line. */
async function mkDiscrepancy(opts: {
  type: "SHORT" | "REJECTED" | "PRICE_VARIANCE" | "SUBSTITUTION";
  locId?: string;
  sessionStatus?: string;
  receivedQty?: string;
  unitCost?: string | null;
  extra?: Partial<typeof receivingDiscrepancy.$inferInsert>;
}) {
  const locId = opts.locId ?? fx.locA;
  const { poId, poLineId } = await mkPO({ ...org1(fx.adminA, "RECEIVED"), locId }, { unitCost: opts.unitCost });
  const [session] = await db
    .insert(receivingSession)
    .values({ poId, storeLocationId: locId, receivedByUserId: fx.adminA, status: opts.sessionStatus ?? "COMPLETED" })
    .returning();
  const [rl] = await db
    .insert(receivingLine)
    .values({
      sessionId: session.sessionId,
      poLineId,
      ingredientId: fx.ingId,
      orderedQty: "10",
      orderedUnit: "kg",
      receivedQty: opts.receivedQty ?? "10",
      status: opts.type === "SUBSTITUTION" ? "SUBSTITUTED" : opts.type,
    })
    .returning();
  const [d] = await db
    .insert(receivingDiscrepancy)
    .values({
      receivingLineId: rl.receivingLineId,
      sessionId: session.sessionId,
      supplierId: fx.supplierId,
      type: opts.type,
      ...opts.extra,
    })
    .returning();
  return d.discrepancyId;
}

const statusOf = async (poId: string) =>
  (await db.select({ s: purchaseOrder.status }).from(purchaseOrder).where(eq(purchaseOrder.poId, poId)))[0].s;

const auditFor = (entityId: string) =>
  db.select().from(auditLog).where(eq(auditLog.entityId, entityId));

describe.skipIf(!RUN)("Wave 5: orders, approvals and credit notes (real DB)", () => {
  beforeAll(async () => {
    fx.adminA = await mkUser("adminA");
    fx.approverB = await mkUser("approverB");
    fx.clerk = await mkUser("clerk");
    const suspended = await mkUser("suspended", "suspended");
    fx.solo.userId = await mkUser("solo");

    [{ id: fx.orgId }] = await db
      .insert(organisation)
      .values({ organisationName: `${fx.tag}-org`, joinKey: `${fx.tag}-k`.slice(0, 25), createdBy: fx.adminA })
      .returning({ id: organisation.organisationId });
    fx.orgs.push(fx.orgId);
    await db.insert(userOrganisation).values([
      { userId: fx.adminA, organisationId: fx.orgId, role: "admin" },
      { userId: fx.approverB, organisationId: fx.orgId, role: "member" },
      { userId: fx.clerk, organisationId: fx.orgId, role: "member" },
      { userId: suspended, organisationId: fx.orgId, role: "member" },
    ]);
    for (const id of [fx.adminA, fx.approverB, suspended, fx.solo.userId]) await grantOpsAdmin(id);

    fx.locA = await mkLocation(fx.orgId, "a", fx.adminA);
    fx.locB = await mkLocation(fx.orgId, "b", fx.adminA);
    await db.insert(userStoreLocation).values([
      { userId: fx.approverB, storeLocationId: fx.locA },
      { userId: fx.clerk, storeLocationId: fx.locA },
    ]);
    [{ id: fx.supplierId }] = await db
      .insert(supplier)
      .values({ organisationId: fx.orgId, supplierName: `${fx.tag}-sup`, contactEmail: "orders@supplier.test", orderingMethod: "email" })
      .returning({ id: supplier.supplierId });
    [{ id: fx.ingId }] = await db
      .insert(ingredient)
      .values({ organisationId: fx.orgId, ingredientName: `${fx.tag}-flour`, ingredientCategory: "dry_goods", itemType: "KITCHEN_INGREDIENT", baseUnit: "kg" })
      .returning({ id: ingredient.ingredientId });

    [{ id: fx.solo.orgId }] = await db
      .insert(organisation)
      .values({ organisationName: `${fx.tag}-solo`, joinKey: `${fx.tag}-s`.slice(0, 25), createdBy: fx.solo.userId })
      .returning({ id: organisation.organisationId });
    fx.orgs.push(fx.solo.orgId);
    await db.insert(userOrganisation).values({ userId: fx.solo.userId, organisationId: fx.solo.orgId, role: "admin" });
    fx.solo.locId = await mkLocation(fx.solo.orgId, "solo", fx.solo.userId);
    [{ id: fx.solo.supplierId }] = await db
      .insert(supplier)
      .values({ organisationId: fx.solo.orgId, supplierName: `${fx.tag}-solosup` })
      .returning({ id: supplier.supplierId });
    [{ id: fx.solo.ingId }] = await db
      .insert(ingredient)
      .values({ organisationId: fx.solo.orgId, ingredientName: `${fx.tag}-salt`, ingredientCategory: "dry_goods", itemType: "KITCHEN_INGREDIENT", baseUnit: "kg" })
      .returning({ id: ingredient.ingredientId });
  });

  afterAll(async () => {
    const pos = await db.select({ id: purchaseOrder.poId }).from(purchaseOrder).where(inArray(purchaseOrder.organisationId, fx.orgs));
    const poIds = pos.map((p) => p.id);
    if (poIds.length) {
      const sessions = await db.select({ id: receivingSession.sessionId }).from(receivingSession).where(inArray(receivingSession.poId, poIds));
      const sessionIds = sessions.map((s) => s.id);
      if (sessionIds.length) {
        const discs = await db.select({ id: receivingDiscrepancy.discrepancyId }).from(receivingDiscrepancy).where(inArray(receivingDiscrepancy.sessionId, sessionIds));
        if (discs.length) await db.delete(creditNote).where(inArray(creditNote.discrepancyId, discs.map((d) => d.id)));
        await db.delete(receivingDiscrepancy).where(inArray(receivingDiscrepancy.sessionId, sessionIds));
        await db.delete(receivingLine).where(inArray(receivingLine.sessionId, sessionIds));
        await db.delete(receivingSession).where(inArray(receivingSession.sessionId, sessionIds));
      }
      await db.delete(purchaseOrderLine).where(inArray(purchaseOrderLine.poId, poIds));
      await db.delete(purchaseOrder).where(inArray(purchaseOrder.poId, poIds));
    }
    await db.delete(notification).where(inArray(notification.organisationId, fx.orgs));
    await db.delete(spendThreshold).where(inArray(spendThreshold.organisationId, fx.orgs));
    await db.delete(supplier).where(inArray(supplier.organisationId, fx.orgs));
    await db.delete(ingredient).where(inArray(ingredient.organisationId, fx.orgs));
    await db.delete(userStoreLocation).where(inArray(userStoreLocation.userId, fx.users));
    if (fx.locs.length) await db.delete(storeLocation).where(inArray(storeLocation.storeLocationId, fx.locs));
    await db.delete(auditLog).where(inArray(auditLog.organisationId, fx.orgs));
    await db.delete(userOrganisation).where(inArray(userOrganisation.organisationId, fx.orgs));
    await db.delete(organisation).where(inArray(organisation.organisationId, fx.orgs));
    await db.delete(userRole).where(inArray(userRole.userId, fx.users));
    await db.delete(user).where(inArray(user.userId, fx.users));
  });

  describe("approving a purchase order", () => {
    it("refuses the creator when another approver exists, and changes nothing", async () => {
      const { poId } = await mkPO(org1(fx.approverB, "PENDING_APPROVAL"));
      const out = await call(handleApprovePO, fx.approverB, APPROVER, { params: { id: poId } });
      expect(out.status).toBe(403);
      expect(out.body.code).toBe("SELF_APPROVAL_NOT_ALLOWED");
      expect(await statusOf(poId)).toBe("PENDING_APPROVAL");
    });

    it("lets another approver approve, and records who and when", async () => {
      const { poId } = await mkPO(org1(fx.approverB, "PENDING_APPROVAL"));
      const out = await call(handleApprovePO, fx.adminA, APPROVER, { params: { id: poId } });
      expect(out.status).toBe(200);
      expect(out.body.status).toBe("SENT");
      expect(out.body.approvedByUserId).toBe(fx.adminA);
      const [row] = await auditFor(poId);
      expect(row).toMatchObject({ action: "approve", actorUserId: fx.adminA, organisationId: fx.orgId });
      expect(row.metadata).toMatchObject({ selfApproval: false });
      expect(row.createdDttm).toBeInstanceOf(Date);
    });

    it("allows the only approver of an organisation to approve their own order, recorded as a self-approval", async () => {
      const { poId } = await mkPO({ ...org1(fx.solo.userId, "PENDING_APPROVAL"), orgId: fx.solo.orgId, locId: fx.solo.locId, supplierId: fx.solo.supplierId, ingId: fx.solo.ingId });
      const out = await call(handleApprovePO, fx.solo.userId, APPROVER, { params: { id: poId } });
      expect(out.status).toBe(200);
      expect(out.body.selfApproval).toBe(true);
      const [row] = await auditFor(poId);
      expect(row).toMatchObject({ action: "approve", actorUserId: fx.solo.userId });
      expect(row.metadata).toMatchObject({ selfApproval: true });
    });

    it("lets two racing approvals succeed only once", async () => {
      const { poId } = await mkPO(org1(fx.clerk, "PENDING_APPROVAL"));
      const outs = await Promise.all([
        call(handleApprovePO, fx.adminA, APPROVER, { params: { id: poId } }),
        call(handleApprovePO, fx.approverB, APPROVER, { params: { id: poId } }),
      ]);
      expect(outs.map((o) => o.status).sort()).toEqual([200, 409]);
      expect(outs.find((o) => o.status === 409)!.body.code).toBe("INVALID_STATE");
      expect((await auditFor(poId)).filter((r) => r.action === "approve")).toHaveLength(1);
    });

    it("answers INVALID_STATE for an order that is not waiting for approval", async () => {
      const { poId } = await mkPO(org1(fx.clerk, "DRAFT"));
      const out = await call(handleApprovePO, fx.adminA, APPROVER, { params: { id: poId } });
      expect(out.status).toBe(409);
      expect(out.body.code).toBe("INVALID_STATE");
    });

    it("cannot approve or reject another organisation's order", async () => {
      const { poId } = await mkPO({ ...org1(fx.solo.userId, "PENDING_APPROVAL"), orgId: fx.solo.orgId, locId: fx.solo.locId, supplierId: fx.solo.supplierId, ingId: fx.solo.ingId });
      const approve = await call(handleApprovePO, fx.adminA, APPROVER, { params: { id: poId } });
      const reject = await call(handleRejectPO, fx.adminA, APPROVER, { params: { id: poId }, body: { reason: "no" } });
      expect([approve.status, reject.status]).toEqual([404, 404]);
      expect([approve.body.code, reject.body.code]).toEqual(["NOT_FOUND", "NOT_FOUND"]);
      expect(await statusOf(poId)).toBe("PENDING_APPROVAL");
    });

    it("does not count a suspended approver as someone else who could approve", async () => {
      // Organisation 1 has A, B and a suspended approver. Take B's approver role away for this case only.
      const [ops] = await db.select({ roleId: role.roleId }).from(role).where(eq(role.roleName, "Operations Admin"));
      await db.delete(userRole).where(and(eq(userRole.userId, fx.approverB), eq(userRole.roleId, ops.roleId)));
      try {
        const { poId } = await mkPO(org1(fx.adminA, "PENDING_APPROVAL"));
        const out = await call(handleApprovePO, fx.adminA, APPROVER, { params: { id: poId } });
        expect(out.status).toBe(200);
        expect(out.body.selfApproval).toBe(true);
      } finally {
        await grantOpsAdmin(fx.approverB);
      }
    });

    it("tells the list and detail whether the caller may approve each waiting order", async () => {
      const own = await mkPO(org1(fx.approverB, "PENDING_APPROVAL"));
      const other = await mkPO(org1(fx.clerk, "PENDING_APPROVAL"));
      const list = await call(handleListPOs, fx.approverB, APPROVER, { query: { status: "PENDING_APPROVAL" } });
      const byId = new Map((list.body as Array<{ poId: string; canApprove?: boolean }>).map((p) => [p.poId, p]));
      expect(byId.get(own.poId)!.canApprove).toBe(false);
      expect(byId.get(other.poId)!.canApprove).toBe(true);
      const detail = await call(handleGetPODetail, fx.approverB, APPROVER, { params: { id: own.poId } });
      expect(detail.body.canApprove).toBe(false);
      // Someone who cannot approve at all is not told anything about approving.
      const staff = await call(handleGetPODetail, fx.clerk, ["inventory:count"], { params: { id: own.poId } });
      expect(staff.body.canApprove).toBeUndefined();
    });
  });

  describe("rejecting a purchase order", () => {
    it("returns it to draft and records who, when and why", async () => {
      const { poId } = await mkPO(org1(fx.approverB, "PENDING_APPROVAL"));
      const out = await call(handleRejectPO, fx.adminA, APPROVER, { params: { id: poId }, body: { reason: "Too much flour" } });
      expect(out.status).toBe(200);
      expect(out.body.status).toBe("DRAFT");
      const [row] = await auditFor(poId);
      expect(row).toMatchObject({ action: "reject", actorUserId: fx.adminA, organisationId: fx.orgId });
      expect(row.metadata).toMatchObject({ reason: "Too much flour" });
    });

    it("answers VALIDATION without a reason", async () => {
      const { poId } = await mkPO(org1(fx.approverB, "PENDING_APPROVAL"));
      const out = await call(handleRejectPO, fx.adminA, APPROVER, { params: { id: poId }, body: {} });
      expect(out.status).toBe(400);
      expect(out.body.code).toBe("VALIDATION");
    });
  });

  describe("spend thresholds", () => {
    it("refuses an approver who is not an organisation admin", async () => {
      const outs = [
        await call(handleSetOrgThreshold, fx.approverB, APPROVER, { body: { amount: 500 } }),
        await call(handleSetLocationThreshold, fx.approverB, APPROVER, { body: { storeLocationId: fx.locA, amount: 500 } }),
        await call(handleRemoveLocationThreshold, fx.approverB, APPROVER, { params: { locationId: fx.locA } }),
      ];
      expect(outs.map((o) => [o.status, o.body.code])).toEqual([
        [403, "FORBIDDEN"],
        [403, "FORBIDDEN"],
        [403, "FORBIDDEN"],
      ]);
    });

    it("refuses an amount above the upper bound", async () => {
      const out = await call(handleSetOrgThreshold, fx.adminA, APPROVER, { body: { amount: 1_000_001 } });
      expect(out.status).toBe(400);
      expect(out.body.code).toBe("VALIDATION");
      expect(out.body.error).toMatch(/1,000,000/);
    });

    it("refuses another organisation's location and writes nothing", async () => {
      const out = await call(handleSetLocationThreshold, fx.adminA, APPROVER, { body: { storeLocationId: fx.solo.locId, amount: 500 } });
      expect(out.status).toBe(404);
      expect(out.body.code).toBe("NOT_FOUND");
      expect(await db.select().from(spendThreshold).where(eq(spendThreshold.storeLocationId, fx.solo.locId))).toHaveLength(0);
    });

    it("records each change with who, the old and the new amount", async () => {
      expect((await call(handleSetOrgThreshold, fx.adminA, APPROVER, { body: { amount: 400 } })).status).toBe(200);
      expect((await call(handleSetOrgThreshold, fx.adminA, APPROVER, { body: { amount: 600 } })).status).toBe(200);
      expect((await call(handleSetLocationThreshold, fx.adminA, APPROVER, { body: { storeLocationId: fx.locA, amount: 300 } })).status).toBe(200);
      expect((await call(handleRemoveLocationThreshold, fx.adminA, APPROVER, { params: { locationId: fx.locA } })).status).toBe(200);

      const org = await auditFor(String(fx.orgId));
      const orgChanges = org.filter((r) => r.entityType === "spend_threshold");
      expect(orgChanges.map((r) => [r.beforeValue, r.afterValue])).toEqual(
        expect.arrayContaining([
          [{ amount: 400 }, { amount: 600 }],
        ]),
      );
      const loc = (await auditFor(fx.locA)).filter((r) => r.entityType === "spend_threshold");
      expect(loc.map((r) => [r.beforeValue, r.afterValue, r.actorUserId])).toEqual(
        expect.arrayContaining([
          [{ amount: null }, { amount: 300 }, fx.adminA],
          [{ amount: 300 }, { amount: null }, fx.adminA],
        ]),
      );
    });
  });

  describe("emailing a purchase order to the supplier", () => {
    const send = vi.mocked(emailService.sendPurchaseOrderEmail);
    beforeEach(() => {
      send.mockReset();
      send.mockResolvedValue({ sent: true } as never);
    });

    it("emails once; a second tap within the window answers ALREADY_EMAILED and sends nothing", async () => {
      const { poId } = await mkPO(org1(fx.adminA, "SENT"));
      const first = await call(handleEmailPOToSupplier, fx.adminA, APPROVER, { params: { id: poId } });
      const second = await call(handleEmailPOToSupplier, fx.adminA, APPROVER, { params: { id: poId } });
      expect(first.body.emailed).toBe(true);
      expect(second.status).toBe(409);
      expect(second.body.code).toBe("ALREADY_EMAILED");
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("sends once when two taps arrive together", async () => {
      const { poId } = await mkPO(org1(fx.adminA, "SENT"));
      const outs = await Promise.all([
        call(handleEmailPOToSupplier, fx.adminA, APPROVER, { params: { id: poId } }),
        call(handleEmailPOToSupplier, fx.adminA, APPROVER, { params: { id: poId } }),
      ]);
      expect(outs.map((o) => o.status).sort()).toEqual([200, 409]);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("lets a failed send be tried again at once, and answers EMAIL_FAILED", async () => {
      const { poId } = await mkPO(org1(fx.adminA, "SENT"));
      send.mockResolvedValueOnce({ sent: false, error: "provider down" } as never);
      const failed = await call(handleEmailPOToSupplier, fx.adminA, APPROVER, { params: { id: poId } });
      expect(failed.status).toBe(502);
      expect(failed.body.code).toBe("EMAIL_FAILED");
      expect(failed.body.error).not.toMatch(/provider down/);
      const retry = await call(handleEmailPOToSupplier, fx.adminA, APPROVER, { params: { id: poId } });
      expect(retry.body.emailed).toBe(true);
    });

    it("sends again once the window has passed", async () => {
      const { poId } = await mkPO(org1(fx.adminA, "SENT"));
      await db.update(purchaseOrder).set({ supplierEmailedAt: new Date(Date.now() - 6 * 60 * 1000) }).where(eq(purchaseOrder.poId, poId));
      const out = await call(handleEmailPOToSupplier, fx.adminA, APPROVER, { params: { id: poId } });
      expect(out.body.emailed).toBe(true);
    });

    it("answers NOT_FOUND for another organisation's order and INVALID_STATE for a draft", async () => {
      const foreign = await mkPO({ ...org1(fx.solo.userId, "SENT"), orgId: fx.solo.orgId, locId: fx.solo.locId, supplierId: fx.solo.supplierId, ingId: fx.solo.ingId });
      const draft = await mkPO(org1(fx.adminA, "DRAFT"));
      const a = await call(handleEmailPOToSupplier, fx.adminA, APPROVER, { params: { id: foreign.poId } });
      const b = await call(handleEmailPOToSupplier, fx.adminA, APPROVER, { params: { id: draft.poId } });
      expect([a.status, a.body.code]).toEqual([404, "NOT_FOUND"]);
      expect([b.status, b.body.code]).toEqual([409, "INVALID_STATE"]);
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe("credit notes", () => {
    const body = (discrepancyId: string, creditAmount: number, extra: object = {}) => ({
      body: { discrepancyId, creditAmount, ...extra },
    });

    it("creates one, resolves the discrepancy, and a repeat with the same id answers the first note", async () => {
      // Short 3 kg at $4 = $12.
      const d = await mkDiscrepancy({ type: "SHORT", receivedQty: "7", extra: { shortageQty: "3" } });
      const creditNoteId = crypto.randomUUID();
      const first = await call(handleCreateCreditNote, fx.adminA, CREDIT, body(d, 12, { creditNoteId }));
      const again = await call(handleCreateCreditNote, fx.adminA, CREDIT, body(d, 12, { creditNoteId }));
      expect(first.status).toBe(201);
      expect(first.body.creditNoteId).toBe(creditNoteId);
      expect(first.body.supplierId).toBe(fx.supplierId);
      expect(again.status).toBe(200);
      expect(again.body.creditNoteId).toBe(creditNoteId);
      expect(await db.select().from(creditNote).where(eq(creditNote.discrepancyId, d))).toHaveLength(1);
      const [disc] = await db.select().from(receivingDiscrepancy).where(eq(receivingDiscrepancy.discrepancyId, d));
      expect(disc.isResolved).toBe(true);
    });

    it("never credits one discrepancy twice, even when two notes arrive together", async () => {
      const d = await mkDiscrepancy({ type: "SHORT", receivedQty: "7", extra: { shortageQty: "3" } });
      const outs = await Promise.all([
        call(handleCreateCreditNote, fx.adminA, CREDIT, body(d, 5)),
        call(handleCreateCreditNote, fx.adminA, CREDIT, body(d, 6)),
      ]);
      expect(outs.map((o) => o.status).sort()).toEqual([201, 409]);
      expect(outs.find((o) => o.status === 409)!.body.code).toBe("ALREADY_CREDITED");
      expect(await db.select().from(creditNote).where(eq(creditNote.discrepancyId, d))).toHaveLength(1);
    });

    it.each([
      ["a short delivery", { type: "SHORT" as const, receivedQty: "7", extra: { shortageQty: "3" } }, 12],
      ["a rejected line", { type: "REJECTED" as const, receivedQty: "0", extra: { rejectionReason: "damaged" } }, 40],
      ["a price rise", { type: "PRICE_VARIANCE" as const, extra: { poUnitCost: "4", actualUnitCost: "5", varianceAmount: "1" } }, 10],
    ])("caps the amount at what %s is worth", async (_name, opts, worth) => {
      const over = await mkDiscrepancy(opts);
      const out = await call(handleCreateCreditNote, fx.adminA, CREDIT, body(over, worth + 0.01));
      expect(out.status).toBe(400);
      expect(out.body.code).toBe("CREDIT_EXCEEDS_DISCREPANCY");
      const exact = await mkDiscrepancy(opts);
      expect((await call(handleCreateCreditNote, fx.adminA, CREDIT, body(exact, worth))).status).toBe(201);
    });

    it("refuses a discrepancy that has no price to cap it", async () => {
      const d = await mkDiscrepancy({ type: "SHORT", receivedQty: "7", unitCost: null, extra: { shortageQty: "3" } });
      const out = await call(handleCreateCreditNote, fx.adminA, CREDIT, body(d, 1));
      expect(out.status).toBe(400);
      expect(out.body.code).toBe("DISCREPANCY_VALUE_UNKNOWN");
    });

    it("refuses a discrepancy whose delivery is still being received", async () => {
      const d = await mkDiscrepancy({ type: "SHORT", sessionStatus: "ACTIVE", receivedQty: "7", extra: { shortageQty: "3" } });
      const out = await call(handleCreateCreditNote, fx.adminA, CREDIT, body(d, 5));
      expect(out.status).toBe(409);
      expect(out.body.code).toBe("INVALID_STATE");
    });

    it("answers CONFLICT when the id is someone else's note", async () => {
      const d1 = await mkDiscrepancy({ type: "SHORT", receivedQty: "7", extra: { shortageQty: "3" } });
      const d2 = await mkDiscrepancy({ type: "SHORT", receivedQty: "7", extra: { shortageQty: "3" } });
      const creditNoteId = crypto.randomUUID();
      expect((await call(handleCreateCreditNote, fx.adminA, CREDIT, body(d1, 5, { creditNoteId }))).status).toBe(201);
      const out = await call(handleCreateCreditNote, fx.clerk, CREDIT, body(d2, 5, { creditNoteId }));
      expect(out.status).toBe(409);
      expect(out.body.code).toBe("CONFLICT");
    });

    it("keeps another organisation out, and lets staff credit at any location of their own organisation", async () => {
      const atB = await mkDiscrepancy({ type: "SHORT", locId: fx.locB, receivedQty: "7", extra: { shortageQty: "3" } });
      const foreign = await call(handleCreateCreditNote, fx.solo.userId, CREDIT, body(atB, 5));
      expect([foreign.status, foreign.body.code]).toEqual([404, "NOT_FOUND"]);
      const [untouched] = await db.select().from(receivingDiscrepancy).where(eq(receivingDiscrepancy.discrepancyId, atB));
      expect(untouched.isResolved).toBe(false);
      // The clerk works at location A only; credit notes reach the whole organisation.
      const staff = await call(handleCreateCreditNote, fx.clerk, CREDIT, body(atB, 5));
      expect(staff.status).toBe(201);
      const [disc] = await db.select().from(receivingDiscrepancy).where(eq(receivingDiscrepancy.discrepancyId, atB));
      expect(disc.isResolved).toBe(true);
    });

    it("stores the amount rounded to cents, and refuses one that rounds to nothing", async () => {
      const d = await mkDiscrepancy({ type: "SHORT", receivedQty: "7", extra: { shortageQty: "3" } });
      const nothing = await call(handleCreateCreditNote, fx.adminA, CREDIT, body(d, 0.004));
      expect([nothing.status, nothing.body.code]).toEqual([400, "VALIDATION"]);
      // Worth 12.00: 12.004 is 12.00 to the cent, so it passes the cap and 12 is what is kept.
      const out = await call(handleCreateCreditNote, fx.adminA, CREDIT, body(d, 12.004));
      expect(out.status).toBe(201);
      expect(Number(out.body.creditAmount)).toBe(12);
    });

    it("lists what is still open across the organisation, with what each is worth", async () => {
      const atA = await mkDiscrepancy({ type: "SHORT", receivedQty: "7", extra: { shortageQty: "3" } });
      const atB = await mkDiscrepancy({ type: "SHORT", locId: fx.locB, receivedQty: "7", extra: { shortageQty: "3" } });
      const stillOpen = await mkDiscrepancy({ type: "SHORT", sessionStatus: "ACTIVE", receivedQty: "7", extra: { shortageQty: "3" } });
      const credited = await mkDiscrepancy({ type: "SHORT", receivedQty: "7", extra: { shortageQty: "3" } });
      await call(handleCreateCreditNote, fx.adminA, CREDIT, body(credited, 1));

      // The clerk works at location A only and still sees location B's.
      const clerk = await call(handleGetUnresolvedDiscrepancies, fx.clerk, CREDIT, { query: { limit: "100" } });
      const clerkIds = (clerk.body as Array<{ discrepancyId: string }>).map((r) => r.discrepancyId);
      expect(clerkIds).toEqual(expect.arrayContaining([atA, atB]));
      expect(clerkIds).not.toContain(stillOpen);
      expect(clerkIds).not.toContain(credited);
      const row = (clerk.body as Array<Record<string, unknown>>).find((r) => r.discrepancyId === atA)!;
      expect(row).toMatchObject({ type: "SHORT", supplierId: fx.supplierId, storeLocationId: fx.locA, maxCreditAmount: 12 });
      expect(row.poNumber).toBeTruthy();
      expect(row.ingredientName).toBe(`${fx.tag}-flour`);

      const foreign = await call(handleGetUnresolvedDiscrepancies, fx.solo.userId, CREDIT, { query: { limit: "100" } });
      const foreignIds = (foreign.body as Array<{ discrepancyId: string }>).map((r) => r.discrepancyId);
      expect(foreignIds).not.toContain(atA);
      expect(foreignIds).not.toContain(atB);
    });

    it("pages the open list newest first, leaves out a price drop and keeps a line with no price", async () => {
      const older = await mkDiscrepancy({ type: "SHORT", receivedQty: "7", extra: { shortageQty: "3" } });
      const priceDrop = await mkDiscrepancy({ type: "PRICE_VARIANCE", extra: { poUnitCost: "4", actualUnitCost: "3", varianceAmount: "-1" } });
      const noPrice = await mkDiscrepancy({ type: "SHORT", receivedQty: "7", unitCost: null, extra: { shortageQty: "3" } });

      const ids = (out: { body: any }) => (out.body as Array<{ discrepancyId: string }>).map((r) => r.discrepancyId);
      const first = await call(handleGetUnresolvedDiscrepancies, fx.adminA, CREDIT, { query: { limit: "2" } });
      expect(first.status).toBe(200);
      expect(ids(first)).toEqual([noPrice, older]);
      expect(first.body[0].maxCreditAmount).toBeNull();
      const second = await call(handleGetUnresolvedDiscrepancies, fx.adminA, CREDIT, { query: { limit: "1", offset: "1" } });
      expect(ids(second)).toEqual([older]);
      const all = await call(handleGetUnresolvedDiscrepancies, fx.adminA, CREDIT, { query: { limit: "100" } });
      expect(ids(all)).not.toContain(priceDrop);
    });

    it.each([{ limit: "0" }, { limit: "101" }, { limit: "abc" }, { limit: "1.5" }, { offset: "-1" }])(
      "refuses the open list page %o",
      async (query) => {
        const out = await call(handleGetUnresolvedDiscrepancies, fx.adminA, CREDIT, { query });
        expect([out.status, out.body.code]).toEqual([400, "VALIDATION"]);
      },
    );

    it("lists credit notes across the organisation, and keeps another organisation out", async () => {
      const atB = await mkDiscrepancy({ type: "SHORT", locId: fx.locB, receivedQty: "7", extra: { shortageQty: "3" } });
      const note = await call(handleCreateCreditNote, fx.adminA, CREDIT, body(atB, 2));
      const clerk = await call(handleGetCreditNotes, fx.clerk, CREDIT);
      expect((clerk.body as Array<{ creditNoteId: string }>).map((n) => n.creditNoteId)).toContain(note.body.creditNoteId);
      const foreign = await call(handleGetCreditNotes, fx.solo.userId, CREDIT);
      expect((foreign.body as Array<{ creditNoteId: string }>).map((n) => n.creditNoteId)).not.toContain(note.body.creditNoteId);
    });
  });
});

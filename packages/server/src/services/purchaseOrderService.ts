/**
 * @module services/purchaseOrderService
 *
 * CRUD and workflow operations for Purchase Orders.
 * Handles PO lifecycle:
 *   DRAFT → PENDING_APPROVAL (above threshold) or SENT (below threshold)
 *   PENDING_APPROVAL → SENT (approved) or DRAFT (rejected)
 *   SENT → RECEIVING → RECEIVED / PARTIAL_RECEIVED
 *
 * Receiving (stock, FIFO batches, WAC) is receivingService's.
 */

import { eq, and, desc, sql, inArray, ne, or, isNull, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  purchaseOrder,
  purchaseOrderLine,
  stockLevel,
  fifoBatch,
  ingredient,
  supplier,
  storeLocation,
  user,
  locationIngredient,
  organisation,
  receivingSession,
  userOrganisation,
  userRole,
  role,
  rolePermission,
  permission,
} from "../db/schema.js";
import { validateTransition, PO_TRANSITIONS } from "../utils/stateTransition.js";
import * as thresholdService from "./thresholdService.js";
import * as notificationService from "./notificationService.js";
import * as pdfService from "./pdfService.js";
import * as emailService from "./emailService.js";
import { resolveToBase } from "./unitConversionService.js";
import * as auditService from "./auditService.js";
import type { DbOrTx } from "./auditService.js";
import { AppError } from "../utils/appError.js";
import { escapeHtml } from "../utils/escapeHtml.js";
import { SUPPLIER_EMAIL_WINDOW_MS } from "@culinaire/shared";
import pino from "pino";

const logger = pino({ name: "purchaseOrderService" });

// ─── Types ────────────────────────────────────────────────────────

export interface CreatePOLineInput {
  ingredientId: string;
  orderedQty: string;
  orderedUnit: string;
  unitCost?: string;
}

export interface CreatePOInput {
  orgId: number;
  locationId: string;
  supplierId: string;
  userId: number;
  lines: CreatePOLineInput[];
  notes?: string;
  expectedDate?: string;
}

export interface ListPOOpts {
  /** Any of these statuses. Omitted = every status (the web's plain call). */
  statuses?: string[];
  storeLocationId?: string;
  /** Only these locations (a receiving-only caller's own). Omitted = every location of the organisation. */
  storeLocationIds?: string[];
  limit?: number;
  offset?: number;
  /** "expected" = soonest expected delivery first, undated last. Default: newest created first. */
  sort?: "created" | "expected";
}

/**
 * Who has an ACTIVE receiving session on this PO right now, or null. A correlated
 * subquery (newest session wins) rather than a join: before the per-PO start lock
 * two ACTIVE sessions could exist for one PO, and a join would duplicate the row.
 */
const beingReceivedBy = sql<{ userId: number; userName: string } | null>`(
  SELECT json_build_object(
    'userId', ${receivingSession.receivedByUserId},
    'userName', u.user_name
  )
  FROM ${receivingSession}
  JOIN "user" u ON u.user_id = ${receivingSession.receivedByUserId}
  WHERE ${receivingSession.poId} = ${purchaseOrder.poId} AND ${receivingSession.status} = 'ACTIVE'
  ORDER BY ${receivingSession.startedAt} DESC
  LIMIT 1
)`;

// ─── createPO ─────────────────────────────────────────────────────

/**
 * The location, supplier and every ingredient must belong to the caller's organisation:
 * a bare foreign key only proves the row exists somewhere, so without this a PO could be
 * written against another tenant's records by UUID. Also guards clonePO, which creates through here.
 */
async function assertOwnedByOrg(input: CreatePOInput) {
  const [loc] = await db
    .select({ id: storeLocation.storeLocationId })
    .from(storeLocation)
    .where(and(eq(storeLocation.storeLocationId, input.locationId), eq(storeLocation.organisationId, input.orgId)));
  if (!loc) throw new Error("Location not found");

  const [sup] = await db
    .select({ id: supplier.supplierId })
    .from(supplier)
    .where(and(eq(supplier.supplierId, input.supplierId), eq(supplier.organisationId, input.orgId)));
  if (!sup) throw new Error("Supplier not found");

  const ingredientIds = [...new Set(input.lines.map((l) => l.ingredientId))];
  const owned = await db
    .select({ id: ingredient.ingredientId })
    .from(ingredient)
    .where(and(inArray(ingredient.ingredientId, ingredientIds), eq(ingredient.organisationId, input.orgId)));
  if (owned.length !== ingredientIds.length) throw new Error("Ingredient not found");
}

export async function createPO(input: CreatePOInput) {
  await assertOwnedByOrg(input);

  const poNumber = `PO-${Date.now().toString(36).toUpperCase()}`;

  const [po] = await db
    .insert(purchaseOrder)
    .values({
      organisationId: input.orgId,
      storeLocationId: input.locationId,
      supplierId: input.supplierId,
      poNumber,
      status: "DRAFT",
      createdByUserId: input.userId,
      notes: input.notes ?? null,
      expectedDeliveryDate: input.expectedDate ? new Date(input.expectedDate) : null,
    })
    .returning();

  const lineRows = input.lines.map((l) => ({
    poId: po.poId,
    ingredientId: l.ingredientId,
    orderedQty: l.orderedQty,
    orderedUnit: l.orderedUnit,
    unitCost: l.unitCost ?? null,
    lineStatus: "PENDING",
  }));

  const insertedLines = await db
    .insert(purchaseOrderLine)
    .values(lineRows)
    .returning();

  return { ...po, lines: insertedLines };
}

// ─── listPOs ──────────────────────────────────────────────────────

export async function listPOs(orgId: number, opts: ListPOOpts = {}) {
  const conditions = [eq(purchaseOrder.organisationId, orgId)];

  if (opts.statuses?.length) {
    conditions.push(inArray(purchaseOrder.status, opts.statuses));
  }
  if (opts.storeLocationId) {
    conditions.push(eq(purchaseOrder.storeLocationId, opts.storeLocationId));
  }
  if (opts.storeLocationIds) {
    conditions.push(inArray(purchaseOrder.storeLocationId, opts.storeLocationIds));
  }

  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const rows = await db
    .select({
      poId: purchaseOrder.poId,
      poNumber: purchaseOrder.poNumber,
      status: purchaseOrder.status,
      notes: purchaseOrder.notes,
      rejectedReason: purchaseOrder.rejectedReason,
      totalValue: purchaseOrder.totalValue,
      expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
      submittedAt: purchaseOrder.submittedAt,
      approvedAt: purchaseOrder.approvedAt,
      sentAt: purchaseOrder.sentAt,
      supplierEmailedAt: purchaseOrder.supplierEmailedAt,
      createdDttm: purchaseOrder.createdDttm,
      updatedDttm: purchaseOrder.updatedDttm,
      storeLocationId: purchaseOrder.storeLocationId,
      supplierId: purchaseOrder.supplierId,
      createdByUserId: purchaseOrder.createdByUserId,
      supplierName: supplier.supplierName,
      locationName: storeLocation.locationName,
      createdByUserName: user.userName,
      supplierOrderingMethod: supplier.orderingMethod,
      supplierPhone: supplier.contactPhone,
      beingReceivedBy,
      lineCount: sql<number>`(SELECT count(*) FROM purchase_order_line pol WHERE pol.po_id = ${purchaseOrder.poId})::int`,
    })
    .from(purchaseOrder)
    .leftJoin(supplier, eq(purchaseOrder.supplierId, supplier.supplierId))
    .leftJoin(storeLocation, eq(purchaseOrder.storeLocationId, storeLocation.storeLocationId))
    .leftJoin(user, eq(purchaseOrder.createdByUserId, user.userId))
    .where(and(...conditions))
    .orderBy(
      ...(opts.sort === "expected"
        ? [sql`${purchaseOrder.expectedDeliveryDate} ASC NULLS LAST`, desc(purchaseOrder.createdDttm)]
        : [desc(purchaseOrder.createdDttm)]),
    )
    .limit(limit)
    .offset(offset);

  return rows;
}

// ─── getPODetail ──────────────────────────────────────────────────

export async function getPODetail(poId: string, orgId: number) {
  const [po] = await db
    .select({
      poId: purchaseOrder.poId,
      poNumber: purchaseOrder.poNumber,
      organisationId: purchaseOrder.organisationId,
      status: purchaseOrder.status,
      notes: purchaseOrder.notes,
      rejectedReason: purchaseOrder.rejectedReason,
      totalValue: purchaseOrder.totalValue,
      expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
      sentAt: purchaseOrder.sentAt,
      supplierEmailedAt: purchaseOrder.supplierEmailedAt,
      createdDttm: purchaseOrder.createdDttm,
      updatedDttm: purchaseOrder.updatedDttm,
      storeLocationId: purchaseOrder.storeLocationId,
      supplierId: purchaseOrder.supplierId,
      createdByUserId: purchaseOrder.createdByUserId,
      supplierName: supplier.supplierName,
      supplierPhone: supplier.contactPhone,
      locationName: storeLocation.locationName,
      createdByUserName: user.userName,
      beingReceivedBy,
    })
    .from(purchaseOrder)
    .leftJoin(supplier, eq(purchaseOrder.supplierId, supplier.supplierId))
    .leftJoin(storeLocation, eq(purchaseOrder.storeLocationId, storeLocation.storeLocationId))
    .leftJoin(user, eq(purchaseOrder.createdByUserId, user.userId))
    .where(and(eq(purchaseOrder.poId, poId), eq(purchaseOrder.organisationId, orgId)));

  if (!po) return null;

  const lines = await db
    .select({
      lineId: purchaseOrderLine.lineId,
      poId: purchaseOrderLine.poId,
      ingredientId: purchaseOrderLine.ingredientId,
      orderedQty: purchaseOrderLine.orderedQty,
      orderedUnit: purchaseOrderLine.orderedUnit,
      receivedQty: purchaseOrderLine.receivedQty,
      receivedUnit: purchaseOrderLine.receivedUnit,
      unitCost: purchaseOrderLine.unitCost,
      // The price actually paid at the door. confirmReceipt has always written
      // this, but it was never selected — so a price change recorded during
      // receiving was invisible in history and the PO still showed the price
      // the kitchen ordered at.
      actualUnitCost: purchaseOrderLine.actualUnitCost,
      lineStatus: purchaseOrderLine.lineStatus,
      receivedByUserId: purchaseOrderLine.receivedByUserId,
      receivedByUserName: user.userName,
      receivedDttm: purchaseOrderLine.receivedDttm,
      createdDttm: purchaseOrderLine.createdDttm,
      ingredientName: ingredient.ingredientName,
      baseUnit: ingredient.baseUnit,
      ingredientCategory: ingredient.ingredientCategory,
    })
    .from(purchaseOrderLine)
    .leftJoin(ingredient, eq(purchaseOrderLine.ingredientId, ingredient.ingredientId))
    .leftJoin(user, eq(purchaseOrderLine.receivedByUserId, user.userId))
    .where(eq(purchaseOrderLine.poId, poId));

  return { ...po, lines };
}

// ─── submitPO (threshold-routed) ─────────────────────────────────

export async function submitPO(poId: string, orgId: number, userId: number) {
  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.poId, poId), eq(purchaseOrder.organisationId, orgId)));

  if (!po) throw new Error("Purchase order not found");
  validateTransition(po.status, "SENT", PO_TRANSITIONS, "purchase order");

  // Calculate total server-side and determine routing
  const { routing, totalValue, thresholdAmount } = await thresholdService.determineRouting(
    poId,
    orgId,
    po.storeLocationId,
  );

  const now = new Date();

  if (routing === "HQ_APPROVAL") {
    // Above threshold → route to HQ
    const [updated] = await db
      .update(purchaseOrder)
      .set({
        status: "PENDING_APPROVAL",
        totalValue: String(totalValue),
        submittedAt: now,
        updatedDttm: now,
      })
      .where(eq(purchaseOrder.poId, poId))
      .returning();

    // Notify HQ admins
    await notificationService.notifyHQAdmins(
      orgId,
      "APPROVAL_REQUIRED",
      {
        poId,
        poNumber: po.poNumber,
        totalValue,
        thresholdAmount,
        locationId: po.storeLocationId,
      },
      "purchase_order",
      poId,
      `PO ${po.poNumber} requires approval ($${totalValue.toFixed(2)})`,
      `
        <h2 style="color: #1a1a1a; margin-bottom: 16px;">Purchase Order Requires Approval</h2>
        <p><strong>PO Number:</strong> ${po.poNumber}</p>
        <p><strong>Total Value:</strong> $${totalValue.toFixed(2)}</p>
        <p><strong>Threshold:</strong> $${thresholdAmount?.toFixed(2)}</p>
        <p style="margin-top: 16px;">
          <a href="${process.env.CLIENT_URL || "https://www.culinaire.kitchen"}/purchasing?tab=orders&po=${poId}"
             style="background: linear-gradient(135deg, #D4A574, #C4956A); color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
            Review &amp; Approve
          </a>
        </p>
      `,
    );

    logger.info({ poId, totalValue, routing }, "PO submitted — pending HQ approval");
    return { ...updated, routing };
  }

  // Below threshold → send directly
  const [updated] = await db
    .update(purchaseOrder)
    .set({
      status: "SENT",
      totalValue: String(totalValue),
      submittedAt: now,
      sentAt: now,
      approvedByUserId: userId,
      updatedDttm: now,
    })
    .where(eq(purchaseOrder.poId, poId))
    .returning();

  logger.info({ poId, totalValue, routing }, "PO submitted — sent directly (below threshold)");
  return { ...updated, routing };
}

// ─── approvePO ───────────────────────────────────────────────────

/**
 * Whether anyone in the organisation besides `userId` can approve purchase orders: an active member who holds
 * `purchasing:approve` through a role, or an Administrator (who bypasses permission checks).
 */
async function hasOtherApprover(orgId: number, userId: number, tx: DbOrTx = db): Promise<boolean> {
  const rows = await tx
    .select({ userId: user.userId })
    .from(user)
    .innerJoin(userOrganisation, eq(userOrganisation.userId, user.userId))
    .innerJoin(userRole, eq(userRole.userId, user.userId))
    .innerJoin(role, eq(role.roleId, userRole.roleId))
    .leftJoin(rolePermission, eq(rolePermission.roleId, role.roleId))
    .leftJoin(permission, eq(permission.permissionId, rolePermission.permissionId))
    .where(
      and(
        eq(userOrganisation.organisationId, orgId),
        ne(user.userId, userId),
        eq(user.userStatus, "active"),
        or(eq(role.roleName, "Administrator"), eq(permission.permissionKey, "purchasing:approve")),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * `canApprove` on every order waiting for approval, for an approver's list or detail: false on their own order
 * while someone else in the organisation can approve it. Other rows are returned unchanged.
 */
export async function withApprovalRights<T extends { status: string; createdByUserId: number }>(
  rows: T[],
  orgId: number,
  userId: number,
): Promise<Array<T & { canApprove?: boolean }>> {
  const ownWaiting = rows.some((r) => r.status === "PENDING_APPROVAL" && r.createdByUserId === userId);
  const soleApprover = ownWaiting ? !(await hasOtherApprover(orgId, userId)) : true;
  return rows.map((r) =>
    r.status === "PENDING_APPROVAL" ? { ...r, canApprove: r.createdByUserId !== userId || soleApprover } : r,
  );
}

/** Lock a waiting order of this organisation for an approver's decision, or refuse. */
async function lockPendingPO(tx: DbOrTx, poId: string, orgId: number, verb: "approve" | "reject") {
  const [po] = await tx
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.poId, poId), eq(purchaseOrder.organisationId, orgId)))
    .for("update");
  if (!po) throw new AppError(404, "NOT_FOUND", "Purchase order not found");
  if (po.status !== "PENDING_APPROVAL") {
    throw new AppError(409, "INVALID_STATE", `Cannot ${verb} PO with status ${po.status}`);
  }
  return po;
}

/**
 * Approve a waiting order. The row is locked, so two approvers racing cannot both approve it. The creator may not
 * approve their own order unless nobody else in the organisation can; that case is allowed and audited as a self-approval.
 */
export async function approvePO(poId: string, orgId: number, userId: number) {
  const { po, updated, selfApproval } = await db.transaction(async (tx) => {
    const po = await lockPendingPO(tx, poId, orgId, "approve");
    const selfApproval = po.createdByUserId === userId;
    if (selfApproval && (await hasOtherApprover(orgId, userId, tx))) {
      throw new AppError(403, "SELF_APPROVAL_NOT_ALLOWED", "You created this purchase order, so another approver must approve it.");
    }

    const now = new Date();
    const [updated] = await tx
      .update(purchaseOrder)
      .set({
        status: "SENT",
        approvedByUserId: userId,
        approvedAt: now,
        sentAt: now,
        updatedDttm: now,
      })
      .where(eq(purchaseOrder.poId, poId))
      .returning();

    await auditService.log(
      {
        entityType: "purchase_order",
        entityId: poId,
        action: "approve",
        actorUserId: userId,
        organisationId: orgId,
        beforeValue: { status: po.status },
        afterValue: { status: updated.status, approvedAt: now.toISOString() },
        metadata: { selfApproval, totalValue: po.totalValue },
      },
      tx,
    );
    return { po, updated, selfApproval };
  });

  // Notify the location that PO was approved
  await notificationService.createInApp({
    organisationId: orgId,
    recipientUserId: po.createdByUserId,
    type: "PO_APPROVED",
    payload: { poId, poNumber: po.poNumber },
    relatedEntityType: "purchase_order",
    relatedEntityId: poId,
  });

  logger.info({ poId, approvedBy: userId, selfApproval }, "PO approved by HQ");
  return { ...updated, selfApproval };
}

// ─── emailPOToSupplier ───────────────────────────────────────────

/**
 * Emails a SENT purchase order to its supplier with the PO PDF attached.
 * Explicit operator action — separate from the internal SENT status flip.
 * Never throws for expected states: a supplier with no email on file, or an
 * unconfigured email transport, is reported back so the UI can flag it.
 *
 * The send is claimed first by stamping `supplier_emailed_at` in one conditional update, so two taps (or a retry
 * after a lost reply) inside {@link SUPPLIER_EMAIL_WINDOW_MS} send one email; the second answers 409 ALREADY_EMAILED.
 * A send that does not happen gives the claim back, so it can be tried again at once.
 */
export async function emailPOToSupplier(poId: string, orgId: number) {
  const [po] = await db
    .select({
      poNumber: purchaseOrder.poNumber,
      status: purchaseOrder.status,
      expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
      supplierEmailedAt: purchaseOrder.supplierEmailedAt,
      supplierName: supplier.supplierName,
      contactEmail: supplier.contactEmail,
      orderingMethod: supplier.orderingMethod,
      locationName: storeLocation.locationName,
      orgName: organisation.organisationName,
    })
    .from(purchaseOrder)
    .leftJoin(supplier, eq(purchaseOrder.supplierId, supplier.supplierId))
    .leftJoin(storeLocation, eq(purchaseOrder.storeLocationId, storeLocation.storeLocationId))
    .leftJoin(organisation, eq(purchaseOrder.organisationId, organisation.organisationId))
    .where(and(eq(purchaseOrder.poId, poId), eq(purchaseOrder.organisationId, orgId)));

  if (!po) throw new AppError(404, "NOT_FOUND", "Purchase order not found");

  // Only a finalised (SENT) PO can be emailed to a supplier.
  if (po.status !== "SENT") {
    throw new AppError(409, "INVALID_STATE", "Only a sent purchase order can be emailed to the supplier");
  }

  // This action is for suppliers ordered via email. Phone/portal suppliers are
  // not emailed — flag it rather than sending an unwanted email.
  if (po.orderingMethod !== "email") {
    return { emailed: false as const, reason: "not_email_supplier" as const };
  }

  // Skip-and-flag: no supplier email on file → do not send, report back.
  if (!po.contactEmail) {
    return { emailed: false as const, reason: "no_supplier_email" as const };
  }

  const now = new Date();
  const [claimed] = await db
    .update(purchaseOrder)
    .set({ supplierEmailedAt: now, updatedDttm: now })
    .where(
      and(
        eq(purchaseOrder.poId, poId),
        or(
          isNull(purchaseOrder.supplierEmailedAt),
          lt(purchaseOrder.supplierEmailedAt, new Date(now.getTime() - SUPPLIER_EMAIL_WINDOW_MS)),
        ),
      ),
    )
    .returning({ poId: purchaseOrder.poId });
  if (!claimed) {
    throw new AppError(409, "ALREADY_EMAILED", "This order was just emailed to the supplier. You can send it again in a few minutes.");
  }
  // Only our own stamp is given back: a later claim by someone else is theirs.
  const release = () =>
    db
      .update(purchaseOrder)
      .set({ supplierEmailedAt: po.supplierEmailedAt })
      .where(and(eq(purchaseOrder.poId, poId), eq(purchaseOrder.supplierEmailedAt, now)));

  let result: Awaited<ReturnType<typeof emailService.sendPurchaseOrderEmail>>;
  try {
    // The full order (line items, totals, notes) lives in the attached PDF; the
    // email body is a brief cover note, so no line-items query is needed here.
    const { buffer: pdfBuffer } = await pdfService.generatePOPdf(poId, orgId);
    result = await emailService.sendPurchaseOrderEmail(
      po.contactEmail,
      {
        poNumber: po.poNumber,
        supplierName: po.supplierName ?? "there",
        orgName: po.orgName ?? "CulinAIre Kitchen",
        locationName: po.locationName ?? "",
        expectedDeliveryDate: po.expectedDeliveryDate
          ? po.expectedDeliveryDate.toISOString().slice(0, 10)
          : null,
      },
      pdfBuffer,
    );
  } catch (err) {
    await release();
    throw err;
  }

  // Transport not set up (e.g. local dev without RESEND_API_KEY) → flag, don't crash.
  if (result.notConfigured) {
    await release();
    return { emailed: false as const, reason: "email_not_configured" as const };
  }
  // Genuine send failure (Resend returned an error) → surface it, without the provider's words.
  if (!result.sent) {
    await release();
    logger.error({ poId, error: result.error }, "Supplier email failed");
    throw new AppError(502, "EMAIL_FAILED", "The email to the supplier could not be sent. Try again, or download the PDF and send it yourself.");
  }

  logger.info({ poId, to: po.contactEmail }, "PO emailed to supplier");
  return { emailed: true as const, emailedAt: now, to: po.contactEmail };
}

// ─── rejectPO ────────────────────────────────────────────────────

export async function rejectPO(
  poId: string,
  orgId: number,
  userId: number,
  reason: string,
) {
  if (!reason || reason.trim().length === 0) {
    throw new AppError(400, "VALIDATION", "Rejection reason is required");
  }

  const { po, updated } = await db.transaction(async (tx) => {
    const po = await lockPendingPO(tx, poId, orgId, "reject");
    const [updated] = await tx
      .update(purchaseOrder)
      .set({
        status: "DRAFT",
        rejectedReason: reason.trim(),
        updatedDttm: new Date(),
      })
      .where(eq(purchaseOrder.poId, poId))
      .returning();

    await auditService.log(
      {
        entityType: "purchase_order",
        entityId: poId,
        action: "reject",
        actorUserId: userId,
        organisationId: orgId,
        beforeValue: { status: po.status },
        afterValue: { status: updated.status },
        metadata: { reason: reason.trim(), totalValue: po.totalValue },
      },
      tx,
    );
    return { po, updated };
  });

  // Notify the location that PO was rejected with reason
  await notificationService.createInApp({
    organisationId: orgId,
    recipientUserId: po.createdByUserId,
    type: "PO_REJECTED",
    payload: { poId, poNumber: po.poNumber, reason: reason.trim() },
    relatedEntityType: "purchase_order",
    relatedEntityId: poId,
  });

  // Also send email so location doesn't miss it
  const [creator] = await db
    .select({ userEmail: user.userEmail, userName: user.userName })
    .from(user)
    .where(eq(user.userId, po.createdByUserId));

  if (creator) {
    await notificationService.sendEmailNotification({
      organisationId: orgId,
      recipientUserId: po.createdByUserId,
      recipientEmail: creator.userEmail,
      type: "PO_REJECTED",
      payload: { poId, poNumber: po.poNumber, reason: reason.trim() },
      relatedEntityType: "purchase_order",
      relatedEntityId: poId,
      subject: `PO ${po.poNumber} was rejected`,
      htmlBody: `
        <h2 style="color: #1a1a1a; margin-bottom: 16px;">Purchase Order Rejected</h2>
        <p><strong>PO Number:</strong> ${po.poNumber}</p>
        <p><strong>Reason:</strong> ${escapeHtml(reason.trim())}</p>
        <p style="margin-top: 16px;">The PO has been returned to Draft status. Please review and resubmit.</p>
        <p style="margin-top: 16px;">
          <a href="${process.env.CLIENT_URL || "https://www.culinaire.kitchen"}/purchasing?tab=orders&po=${poId}"
             style="background: linear-gradient(135deg, #D4A574, #C4956A); color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
            Edit PO
          </a>
        </p>
      `,
    });
  }

  logger.info({ poId, rejectedBy: userId, reason }, "PO rejected by HQ");
  return updated;
}

// ─── clonePO ─────────────────────────────────────────────────────

/**
 * Clone a previous PO as a new draft, adjusting quantities based on
 * current stock vs par level. Skips items where supplier is now inactive.
 */
export async function clonePO(
  sourcePOId: string,
  orgId: number,
  locationId: string,
  userId: number,
) {
  // Fetch source PO and lines
  const source = await getPODetail(sourcePOId, orgId);
  if (!source) throw new Error("Source purchase order not found");

  // Validate supplier is still active
  const [sup] = await db
    .select()
    .from(supplier)
    .where(eq(supplier.supplierId, source.supplierId));

  if (!sup || !sup.activeInd) {
    throw new Error("Supplier is no longer active — cannot clone this PO");
  }

  const skippedItems: string[] = [];
  const adjustedLines: CreatePOLineInput[] = [];

  // Batch-load current stock + par for every source line at this location in two
  // queries, not two per line (P1 T12 — a clone of a 500-line PO was ~1,000 queries).
  const lineIngredientIds = source.lines.map((l) => l.ingredientId);
  const [stockRows, parRows] = lineIngredientIds.length
    ? await Promise.all([
        db
          .select({ ingredientId: stockLevel.ingredientId, currentQty: stockLevel.currentQty })
          .from(stockLevel)
          .where(
            and(
              eq(stockLevel.storeLocationId, locationId),
              inArray(stockLevel.ingredientId, lineIngredientIds),
              eq(stockLevel.zone, "BOH"),
            ),
          ),
        db
          .select({ ingredientId: locationIngredient.ingredientId, parLevel: locationIngredient.parLevel })
          .from(locationIngredient)
          .where(
            and(
              eq(locationIngredient.storeLocationId, locationId),
              inArray(locationIngredient.ingredientId, lineIngredientIds),
              eq(locationIngredient.activeInd, true),
            ),
          ),
      ])
    : [[], []];
  const stockByIngredient = new Map(stockRows.map((r) => [r.ingredientId, r.currentQty]));
  const parByIngredient = new Map(parRows.map((r) => [r.ingredientId, r.parLevel]));

  for (const line of source.lines) {
    const currentQty = Number(stockByIngredient.get(line.ingredientId) ?? 0);
    const parRaw = parByIngredient.get(line.ingredientId);
    const parLevel = parRaw != null ? Number(parRaw) : null;

    // Calculate suggested qty: par level - current stock, or original qty if no par
    let suggestedQty: number;
    if (parLevel && parLevel > currentQty) {
      suggestedQty = parLevel - currentQty;
    } else if (parLevel && parLevel <= currentQty) {
      // Stock is at or above par — skip this item
      skippedItems.push(line.ingredientName ?? line.ingredientId);
      continue;
    } else {
      // No par level — use the original ordered qty
      suggestedQty = Number(line.orderedQty);
    }

    adjustedLines.push({
      ingredientId: line.ingredientId,
      orderedQty: String(Math.ceil(suggestedQty * 100) / 100),
      orderedUnit: line.orderedUnit,
      unitCost: line.unitCost ?? undefined,
    });
  }

  if (adjustedLines.length === 0) {
    throw new Error("No items need reordering — all items are at or above par level");
  }

  // Create the new draft PO
  const newPO = await createPO({
    orgId,
    locationId,
    supplierId: source.supplierId,
    userId,
    lines: adjustedLines,
    notes: `Cloned from ${source.poNumber}`,
  });

  logger.info(
    { sourcePOId, newPOId: newPO.poId, linesCloned: adjustedLines.length, skipped: skippedItems.length },
    "PO cloned",
  );

  return { ...newPO, skippedItems };
}

// ─── receiveLine ──────────────────────────────────────────────────

export async function receiveLine(
  poId: string,
  lineId: string,
  receivedQty: string,
  receivedUnit: string,
  unitCost: string | null,
  userId: number,
  orgId: number,
) {
  // Validate PO status — AND org so a caller cannot receive on another org's PO
  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.poId, poId), eq(purchaseOrder.organisationId, orgId)));

  if (!po) throw new Error("Purchase order not found");
  if (po.status !== "SUBMITTED" && po.status !== "PARTIALLY_RECEIVED") {
    throw new Error(`Cannot receive on PO with status ${po.status}`);
  }

  // Validate line belongs to PO
  const [line] = await db
    .select()
    .from(purchaseOrderLine)
    .where(and(eq(purchaseOrderLine.lineId, lineId), eq(purchaseOrderLine.poId, poId)));

  if (!line) throw new Error("PO line not found");
  if (line.lineStatus === "RECEIVED") throw new Error("Line already received");

  // Update the line
  const [updatedLine] = await db
    .update(purchaseOrderLine)
    .set({
      receivedQty,
      receivedUnit,
      unitCost: unitCost ?? line.unitCost,
      lineStatus: "RECEIVED",
      receivedByUserId: userId,
      receivedDttm: new Date(),
      updatedDttm: new Date(),
    })
    .where(eq(purchaseOrderLine.lineId, lineId))
    .returning();

  // Convert the received qty from its entered/packaging unit to the
  // ingredient's KITCHEN unit at the receiving boundary — packaging (case,
  // bag) must never touch the stock count directly. The unit cost converts
  // with it (per-case → per-kitchen-unit) so FIFO/WAC stay consistent.
  const { baseQty: receivedBaseQty } = await resolveToBase(
    line.ingredientId,
    Number(receivedQty),
    receivedUnit || line.orderedUnit,
  );
  const conversionFactor = receivedBaseQty / Number(receivedQty);
  const enteredCost = unitCost ?? line.unitCost;
  const baseUnitCost = enteredCost != null ? String(Number(enteredCost) / conversionFactor) : enteredCost;

  // Create FIFO batch (kitchen units + per-kitchen-unit cost)
  await db.insert(fifoBatch).values({
    storeLocationId: po.storeLocationId,
    ingredientId: line.ingredientId,
    arrivalDate: new Date(),
    quantityRemaining: String(receivedBaseQty),
    originalQuantity: String(receivedBaseQty),
    unitCost: baseUnitCost,
    sourcePoLineId: lineId,
    isDepleted: false,
  });

  // Upsert stock level — add received qty (kitchen units)
  const existingStock = await db
    .select()
    .from(stockLevel)
    .where(
      and(
        eq(stockLevel.storeLocationId, po.storeLocationId),
        eq(stockLevel.ingredientId, line.ingredientId),
        eq(stockLevel.zone, "BOH"),
      ),
    );

  if (existingStock.length > 0) {
    await db
      .update(stockLevel)
      .set({
        currentQty: sql`${stockLevel.currentQty}::numeric + ${receivedBaseQty}::numeric`,
        updatedDttm: new Date(),
      })
      .where(eq(stockLevel.stockLevelId, existingStock[0].stockLevelId));
  } else {
    await db.insert(stockLevel).values({
      storeLocationId: po.storeLocationId,
      ingredientId: line.ingredientId,
      currentQty: String(receivedBaseQty),
    });
  }

  // Check if all lines are received → update PO status
  const allLines = await db
    .select({ lineStatus: purchaseOrderLine.lineStatus })
    .from(purchaseOrderLine)
    .where(eq(purchaseOrderLine.poId, poId));

  const allReceived = allLines.every((l) => l.lineStatus === "RECEIVED");

  await db
    .update(purchaseOrder)
    .set({
      status: allReceived ? "RECEIVED" : "PARTIALLY_RECEIVED",
      updatedDttm: new Date(),
    })
    .where(eq(purchaseOrder.poId, poId));

  return updatedLine;
}

// ─── cancelPO ─────────────────────────────────────────────────────

export async function cancelPO(poId: string, orgId: number, userId: number) {
  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.poId, poId), eq(purchaseOrder.organisationId, orgId)));

  if (!po) throw new Error("Purchase order not found");
  validateTransition(po.status, "CANCELLED", PO_TRANSITIONS, "purchase order");

  const [updated] = await db
    .update(purchaseOrder)
    .set({ status: "CANCELLED", updatedDttm: new Date() })
    .where(eq(purchaseOrder.poId, poId))
    .returning();

  logger.info({ poId, cancelledBy: userId }, "PO cancelled");
  return updated;
}

// getSuggestions removed (Purchasing P1, T3): superseded by autoPoSuggestService,
// which is the live "items below par" engine the Suggestions tab and order guides
// both use. This older per-location variant was called by no live component.

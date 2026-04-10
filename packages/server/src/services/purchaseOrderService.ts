/**
 * @module services/purchaseOrderService
 *
 * CRUD and workflow operations for Purchase Orders.
 * Handles PO lifecycle:
 *   DRAFT → PENDING_APPROVAL (above threshold) or SENT (below threshold)
 *   PENDING_APPROVAL → SENT (approved) or DRAFT (rejected)
 *   SENT → RECEIVING → RECEIVED / PARTIAL_RECEIVED
 *
 * On receive, creates FIFO batches and updates stock levels.
 */

import { eq, and, desc, sql, count } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  purchaseOrder,
  purchaseOrderLine,
  fifoBatch,
  stockLevel,
  ingredient,
  ingredientSupplier,
  supplier,
  storeLocation,
  user,
  locationIngredient,
} from "../db/schema.js";
import { validateTransition, PO_TRANSITIONS } from "../utils/stateTransition.js";
import * as thresholdService from "./thresholdService.js";
import * as notificationService from "./notificationService.js";
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
  status?: string;
  storeLocationId?: string;
  limit?: number;
  offset?: number;
}

// ─── createPO ─────────────────────────────────────────────────────

export async function createPO(input: CreatePOInput) {
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

  if (opts.status) {
    conditions.push(eq(purchaseOrder.status, opts.status));
  }
  if (opts.storeLocationId) {
    conditions.push(eq(purchaseOrder.storeLocationId, opts.storeLocationId));
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
      createdDttm: purchaseOrder.createdDttm,
      updatedDttm: purchaseOrder.updatedDttm,
      storeLocationId: purchaseOrder.storeLocationId,
      supplierId: purchaseOrder.supplierId,
      createdByUserId: purchaseOrder.createdByUserId,
      supplierName: supplier.supplierName,
      locationName: storeLocation.locationName,
      createdByUserName: user.userName,
      lineCount: sql<number>`(SELECT count(*) FROM purchase_order_line pol WHERE pol.po_id = ${purchaseOrder.poId})::int`,
    })
    .from(purchaseOrder)
    .leftJoin(supplier, eq(purchaseOrder.supplierId, supplier.supplierId))
    .leftJoin(storeLocation, eq(purchaseOrder.storeLocationId, storeLocation.storeLocationId))
    .leftJoin(user, eq(purchaseOrder.createdByUserId, user.userId))
    .where(and(...conditions))
    .orderBy(desc(purchaseOrder.createdDttm))
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
      expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
      createdDttm: purchaseOrder.createdDttm,
      updatedDttm: purchaseOrder.updatedDttm,
      storeLocationId: purchaseOrder.storeLocationId,
      supplierId: purchaseOrder.supplierId,
      createdByUserId: purchaseOrder.createdByUserId,
      supplierName: supplier.supplierName,
      locationName: storeLocation.locationName,
      createdByUserName: user.userName,
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
      lineStatus: purchaseOrderLine.lineStatus,
      receivedByUserId: purchaseOrderLine.receivedByUserId,
      receivedDttm: purchaseOrderLine.receivedDttm,
      createdDttm: purchaseOrderLine.createdDttm,
      ingredientName: ingredient.ingredientName,
      baseUnit: ingredient.baseUnit,
      ingredientCategory: ingredient.ingredientCategory,
    })
    .from(purchaseOrderLine)
    .leftJoin(ingredient, eq(purchaseOrderLine.ingredientId, ingredient.ingredientId))
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
          <a href="${process.env.CLIENT_URL || "https://www.culinaire.kitchen"}/inventory?tab=purchase-orders&po=${poId}"
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

export async function approvePO(poId: string, orgId: number, userId: number) {
  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.poId, poId), eq(purchaseOrder.organisationId, orgId)));

  if (!po) throw new Error("Purchase order not found");
  validateTransition(po.status, "SENT", PO_TRANSITIONS, "purchase order");

  if (po.status !== "PENDING_APPROVAL") {
    throw new Error(`Cannot approve PO with status ${po.status}`);
  }

  const now = new Date();

  const [updated] = await db
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

  // Notify the location that PO was approved
  await notificationService.createInApp({
    organisationId: orgId,
    recipientUserId: po.createdByUserId,
    type: "PO_APPROVED",
    payload: { poId, poNumber: po.poNumber },
    relatedEntityType: "purchase_order",
    relatedEntityId: poId,
  });

  logger.info({ poId, approvedBy: userId }, "PO approved by HQ");
  return updated;
}

// ─── rejectPO ────────────────────────────────────────────────────

export async function rejectPO(
  poId: string,
  orgId: number,
  userId: number,
  reason: string,
) {
  if (!reason || reason.trim().length === 0) {
    throw new Error("Rejection reason is required");
  }

  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.poId, poId), eq(purchaseOrder.organisationId, orgId)));

  if (!po) throw new Error("Purchase order not found");

  if (po.status !== "PENDING_APPROVAL") {
    throw new Error(`Cannot reject PO with status ${po.status}`);
  }

  const [updated] = await db
    .update(purchaseOrder)
    .set({
      status: "DRAFT",
      rejectedReason: reason.trim(),
      updatedDttm: new Date(),
    })
    .where(eq(purchaseOrder.poId, poId))
    .returning();

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
        <p><strong>Reason:</strong> ${reason.trim()}</p>
        <p style="margin-top: 16px;">The PO has been returned to Draft status. Please review and resubmit.</p>
        <p style="margin-top: 16px;">
          <a href="${process.env.CLIENT_URL || "https://www.culinaire.kitchen"}/inventory?tab=purchase-orders&po=${poId}"
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

  for (const line of source.lines) {
    // Get current stock at this location
    const [stock] = await db
      .select({ currentQty: stockLevel.currentQty })
      .from(stockLevel)
      .where(
        and(
          eq(stockLevel.storeLocationId, locationId),
          eq(stockLevel.ingredientId, line.ingredientId),
        ),
      );

    // Get par level for this item at this location
    const [locIng] = await db
      .select({ parLevel: locationIngredient.parLevel })
      .from(locationIngredient)
      .where(
        and(
          eq(locationIngredient.storeLocationId, locationId),
          eq(locationIngredient.ingredientId, line.ingredientId),
          eq(locationIngredient.activeInd, true),
        ),
      );

    const currentQty = stock ? Number(stock.currentQty) : 0;
    const parLevel = locIng?.parLevel ? Number(locIng.parLevel) : null;

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
) {
  // Validate PO status
  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(eq(purchaseOrder.poId, poId));

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

  // Create FIFO batch
  await db.insert(fifoBatch).values({
    storeLocationId: po.storeLocationId,
    ingredientId: line.ingredientId,
    arrivalDate: new Date(),
    quantityRemaining: receivedQty,
    originalQuantity: receivedQty,
    unitCost: unitCost ?? line.unitCost,
    sourcePoLineId: lineId,
    isDepleted: false,
  });

  // Upsert stock level — add received qty
  const existingStock = await db
    .select()
    .from(stockLevel)
    .where(
      and(
        eq(stockLevel.storeLocationId, po.storeLocationId),
        eq(stockLevel.ingredientId, line.ingredientId),
      ),
    );

  if (existingStock.length > 0) {
    await db
      .update(stockLevel)
      .set({
        currentQty: sql`${stockLevel.currentQty}::numeric + ${receivedQty}::numeric`,
        updatedDttm: new Date(),
      })
      .where(eq(stockLevel.stockLevelId, existingStock[0].stockLevelId));
  } else {
    await db.insert(stockLevel).values({
      storeLocationId: po.storeLocationId,
      ingredientId: line.ingredientId,
      currentQty: receivedQty,
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

// ─── getSuggestions ───────────────────────────────────────────────

export async function getSuggestions(locationId: string, orgId: number) {
  // Find items where current stock < par level, grouped by preferred supplier
  const rows = await db
    .select({
      ingredientId: ingredient.ingredientId,
      ingredientName: ingredient.ingredientName,
      ingredientCategory: ingredient.ingredientCategory,
      baseUnit: ingredient.baseUnit,
      parLevel: locationIngredient.parLevel,
      reorderQty: locationIngredient.reorderQty,
      currentQty: stockLevel.currentQty,
      supplierId: supplier.supplierId,
      supplierName: supplier.supplierName,
    })
    .from(locationIngredient)
    .innerJoin(ingredient, eq(locationIngredient.ingredientId, ingredient.ingredientId))
    .leftJoin(
      stockLevel,
      and(
        eq(stockLevel.ingredientId, ingredient.ingredientId),
        eq(stockLevel.storeLocationId, locationId),
      ),
    )
    .leftJoin(supplier, eq(locationIngredient.supplierId, supplier.supplierId))
    .where(
      and(
        eq(locationIngredient.storeLocationId, locationId),
        eq(locationIngredient.activeInd, true),
        sql`COALESCE(${stockLevel.currentQty}::numeric, 0) < COALESCE(${locationIngredient.parLevel}::numeric, 0)`,
        sql`${locationIngredient.parLevel} IS NOT NULL AND ${locationIngredient.parLevel}::numeric > 0`,
      ),
    );

  // Group by supplier
  const grouped: Record<string, {
    supplierId: string | null;
    supplierName: string | null;
    items: typeof rows;
  }> = {};

  for (const row of rows) {
    const key = row.supplierId ?? "unassigned";
    if (!grouped[key]) {
      grouped[key] = {
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        items: [],
      };
    }
    grouped[key].items.push(row);
  }

  return Object.values(grouped);
}

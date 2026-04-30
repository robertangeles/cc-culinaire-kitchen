/**
 * @module services/receivingService
 *
 * Delivery receiving workflow — the most operationally critical service.
 *
 * Flow:
 *   1. startSession(poId) → creates receiving_session + pre-populates lines
 *   2. actionLine(lineId, action) → updates line status + creates discrepancy
 *   3. confirmReceipt(sessionId) → ALL-OR-NOTHING transaction:
 *      - Creates FIFO batches for received/short items
 *      - Updates stock levels
 *      - Logs discrepancies against supplier
 *      - Notifies HQ of significant discrepancies
 *      - Updates PO status to RECEIVED / PARTIAL_RECEIVED
 */

import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  receivingSession,
  receivingLine,
  receivingDiscrepancy,
  discrepancyPhoto,
  purchaseOrder,
  purchaseOrderLine,
  ingredient,
  supplier,
} from "../db/schema.js";
import * as fifoService from "./fifoService.js";
import * as stockService from "./stockService.js";
import * as notificationService from "./notificationService.js";
import * as auditService from "./auditService.js";
import * as wacService from "./wacService.js";
import { validateTransition, RECEIVING_SESSION_TRANSITIONS } from "../utils/stateTransition.js";
import pino from "pino";

const logger = pino({ name: "receivingService" });

// ── Types ────────────────────────────────────────────────────────────

export type LineActionType = "RECEIVED" | "SHORT" | "REJECTED" | "PRICE_VARIANCE" | "SUBSTITUTED";
export type RejectionReason = "quality" | "damaged" | "temperature" | "expired" | "other";

export interface ActionLineInput {
  status: LineActionType;
  receivedQty?: string;
  actualUnitCost?: string;
  rejectionReason?: RejectionReason;
  rejectionNote?: string;
  substitutedIngredientId?: string;
}

// ── startSession ─────────────────────────────────────────────────────

/**
 * Start a receiving session for a PO. Pre-populates all lines
 * with default state = RECEIVED, received_qty = ordered_qty.
 *
 * Enforces: only one ACTIVE session per PO.
 *
 * All writes (session insert, line inserts, PO status update, audit row) commit
 * atomically. Either the session exists fully or not at all.
 */
export async function startSession(
  poId: string,
  locationId: string,
  userId: number,
) {
  return db.transaction(async (tx) => {
    // Validate PO is in SENT status
    const [po] = await tx
      .select()
      .from(purchaseOrder)
      .where(eq(purchaseOrder.poId, poId));

    if (!po) throw new Error("Purchase order not found");
    if (po.status !== "SENT") {
      throw new Error(`Cannot start receiving on PO with status ${po.status}`);
    }

    // Check no active session exists
    const [existing] = await tx
      .select()
      .from(receivingSession)
      .where(
        and(
          eq(receivingSession.poId, poId),
          eq(receivingSession.status, "ACTIVE"),
        ),
      );

    if (existing) {
      throw new Error("A receiving session is already in progress for this PO");
    }

    // Create session
    const [session] = await tx
      .insert(receivingSession)
      .values({
        poId,
        storeLocationId: locationId,
        receivedByUserId: userId,
        status: "ACTIVE",
      })
      .returning();

    // Fetch PO lines and pre-populate receiving lines (default: fully received)
    const poLines = await tx
      .select({
        lineId: purchaseOrderLine.lineId,
        ingredientId: purchaseOrderLine.ingredientId,
        orderedQty: purchaseOrderLine.orderedQty,
        orderedUnit: purchaseOrderLine.orderedUnit,
        unitCost: purchaseOrderLine.unitCost,
      })
      .from(purchaseOrderLine)
      .where(eq(purchaseOrderLine.poId, poId));

    const receivingLines = [];
    for (const pl of poLines) {
      const [rl] = await tx
        .insert(receivingLine)
        .values({
          sessionId: session.sessionId,
          poLineId: pl.lineId,
          ingredientId: pl.ingredientId,
          orderedQty: pl.orderedQty,
          orderedUnit: pl.orderedUnit,
          receivedQty: pl.orderedQty, // default: fully received
          actualUnitCost: pl.unitCost,
          status: "RECEIVED",
        })
        .returning();

      receivingLines.push(rl);
    }

    // Update PO status to RECEIVING
    await tx
      .update(purchaseOrder)
      .set({ status: "RECEIVING", updatedDttm: new Date() })
      .where(eq(purchaseOrder.poId, poId));

    await auditService.log(
      {
        entityType: "receiving_session",
        entityId: session.sessionId,
        action: "create",
        actorUserId: userId,
        organisationId: po.organisationId,
        afterValue: { ...session },
        metadata: { poId, locationId, lineCount: receivingLines.length },
      },
      tx,
    );

    logger.info({ sessionId: session.sessionId, poId, lineCount: receivingLines.length }, "Receiving session started");

    return { session, lines: receivingLines };
  });
}

// ── getSession ───────────────────────────────────────────────────────

/**
 * Get a receiving session with all lines and ingredient details.
 */
export async function getSession(sessionId: string) {
  const [session] = await db
    .select()
    .from(receivingSession)
    .where(eq(receivingSession.sessionId, sessionId));

  if (!session) return null;

  const lines = await db
    .select({
      receivingLineId: receivingLine.receivingLineId,
      sessionId: receivingLine.sessionId,
      poLineId: receivingLine.poLineId,
      ingredientId: receivingLine.ingredientId,
      orderedQty: receivingLine.orderedQty,
      orderedUnit: receivingLine.orderedUnit,
      receivedQty: receivingLine.receivedQty,
      actualUnitCost: receivingLine.actualUnitCost,
      status: receivingLine.status,
      ingredientName: ingredient.ingredientName,
      ingredientCategory: ingredient.ingredientCategory,
      baseUnit: ingredient.baseUnit,
    })
    .from(receivingLine)
    .leftJoin(ingredient, eq(receivingLine.ingredientId, ingredient.ingredientId))
    .where(eq(receivingLine.sessionId, sessionId));

  // Get discrepancies for this session
  const discrepancies = await db
    .select()
    .from(receivingDiscrepancy)
    .where(eq(receivingDiscrepancy.sessionId, sessionId));

  // Get photos for each discrepancy
  const discrepancyIds = discrepancies.map((d) => d.discrepancyId);
  let photos: Array<typeof discrepancyPhoto.$inferSelect> = [];
  if (discrepancyIds.length > 0) {
    photos = await db
      .select()
      .from(discrepancyPhoto)
      .where(sql`${discrepancyPhoto.discrepancyId} = ANY(${discrepancyIds})`);
  }

  return { session, lines, discrepancies, photos };
}

// ── actionLine ───────────────────────────────────────────────────────

/**
 * Update a receiving line with an action (short, reject, price variance, substitution).
 * Creates a discrepancy record for any non-RECEIVED action.
 *
 * Line update + discrepancy delete + discrepancy insert + audit row commit
 * together. Either the chef sees the change or doesn't — never half.
 */
export async function actionLine(
  receivingLineId: string,
  sessionId: string,
  input: ActionLineInput,
) {
  return db.transaction(async (tx) => {
    // Validate session is ACTIVE
    const [session] = await tx
      .select()
      .from(receivingSession)
      .where(eq(receivingSession.sessionId, sessionId));

    if (!session) throw new Error("Receiving session not found");
    if (session.status !== "ACTIVE") {
      throw new Error("Receiving session is no longer active");
    }

    // Fetch the line
    const [line] = await tx
      .select()
      .from(receivingLine)
      .where(
        and(
          eq(receivingLine.receivingLineId, receivingLineId),
          eq(receivingLine.sessionId, sessionId),
        ),
      );

    if (!line) throw new Error("Receiving line not found");

    // Get PO line for cost reference
    const [poLine] = await tx
      .select()
      .from(purchaseOrderLine)
      .where(eq(purchaseOrderLine.lineId, line.poLineId));

    // Get the PO for supplier ID + org scoping on the audit row
    const [po] = await tx
      .select()
      .from(purchaseOrder)
      .where(eq(purchaseOrder.poId, session.poId));

    // Update the line
    const updateData: Record<string, unknown> = {
      status: input.status,
      updatedDttm: new Date(),
    };

    if (input.receivedQty !== undefined) {
      updateData.receivedQty = input.receivedQty;
    }
    if (input.actualUnitCost !== undefined) {
      updateData.actualUnitCost = input.actualUnitCost;
    }

    // For REJECTED, set received qty to 0
    if (input.status === "REJECTED") {
      updateData.receivedQty = "0";
    }

    const [updatedLine] = await tx
      .update(receivingLine)
      .set(updateData)
      .where(eq(receivingLine.receivingLineId, receivingLineId))
      .returning();

    // Create discrepancy record for non-RECEIVED actions
    let discrepancy = null;
    if (input.status !== "RECEIVED") {
      const discrepancyData: Record<string, unknown> = {
        receivingLineId,
        sessionId,
        supplierId: po.supplierId,
        type: input.status === "PRICE_VARIANCE" ? "PRICE_VARIANCE" : input.status,
      };

      if (input.status === "SHORT") {
        const shortageQty = Number(line.orderedQty) - Number(input.receivedQty ?? 0);
        discrepancyData.shortageQty = String(shortageQty);
      }

      if (input.status === "REJECTED") {
        discrepancyData.rejectionReason = input.rejectionReason ?? "other";
        discrepancyData.rejectionNote = input.rejectionNote;
      }

      if (input.status === "PRICE_VARIANCE") {
        const poPrice = Number(poLine?.unitCost ?? 0);
        const actualPrice = Number(input.actualUnitCost ?? 0);
        discrepancyData.poUnitCost = String(poPrice);
        discrepancyData.actualUnitCost = String(actualPrice);
        discrepancyData.varianceAmount = String(actualPrice - poPrice);
        discrepancyData.variancePct = poPrice > 0
          ? String(((actualPrice - poPrice) / poPrice) * 100)
          : "0";
      }

      if (input.status === "SUBSTITUTED") {
        discrepancyData.substitutedIngredientId = input.substitutedIngredientId;
      }

      // Delete any existing discrepancy for this line (in case they changed their mind)
      await tx
        .delete(receivingDiscrepancy)
        .where(eq(receivingDiscrepancy.receivingLineId, receivingLineId));

      const [inserted] = await tx
        .insert(receivingDiscrepancy)
        .values(discrepancyData as typeof receivingDiscrepancy.$inferInsert)
        .returning();

      discrepancy = inserted;
    } else {
      // Reset to RECEIVED — remove any existing discrepancy
      await tx
        .delete(receivingDiscrepancy)
        .where(eq(receivingDiscrepancy.receivingLineId, receivingLineId));
    }

    await auditService.log(
      {
        entityType: "receiving_line",
        entityId: receivingLineId,
        action: "update",
        actorUserId: session.receivedByUserId,
        organisationId: po.organisationId,
        beforeValue: { status: line.status, receivedQty: line.receivedQty, actualUnitCost: line.actualUnitCost },
        afterValue: { status: updatedLine.status, receivedQty: updatedLine.receivedQty, actualUnitCost: updatedLine.actualUnitCost },
        metadata: { sessionId, discrepancyType: input.status !== "RECEIVED" ? input.status : null },
      },
      tx,
    );

    logger.info(
      { receivingLineId, status: input.status, sessionId },
      "Receiving line actioned",
    );

    return { line: updatedLine, discrepancy };
  });
}

// ── confirmReceipt ───────────────────────────────────────────────────

/**
 * Confirm receipt of all items. ALL-OR-NOTHING transaction:
 * - Creates FIFO batches for received/short items
 * - Updates stock levels via optimistic locking
 * - Marks session as COMPLETED
 * - Updates PO status to RECEIVED / PARTIAL_RECEIVED
 * - Writes a `complete` audit row scoped to the session
 *
 * After the transaction commits successfully, notifies HQ of significant
 * discrepancies. Notification failure is logged but does NOT roll back the
 * receipt — a failed email shouldn't undo a successful delivery.
 */
export async function confirmReceipt(sessionId: string) {
  // Wrap all DB writes in a single transaction so rollback is automatic on
  // any error (FIFO batch insert, stock update conflict, PO update, etc.).
  const result = await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(receivingSession)
      .where(eq(receivingSession.sessionId, sessionId));

    if (!session) throw new Error("Receiving session not found");
    validateTransition(session.status, "COMPLETED", RECEIVING_SESSION_TRANSITIONS, "receiving session");

    const lines = await tx
      .select()
      .from(receivingLine)
      .where(eq(receivingLine.sessionId, sessionId));

    const discrepancies = await tx
      .select()
      .from(receivingDiscrepancy)
      .where(eq(receivingDiscrepancy.sessionId, sessionId));

    const [po] = await tx
      .select()
      .from(purchaseOrder)
      .where(eq(purchaseOrder.poId, session.poId));

    if (!po) throw new Error("Purchase order not found");

    const processedLines: string[] = [];
    // Track (location, ingredient) pairs whose WAC needs recomputing once
    // FIFO batches are seated. Use a Map keyed by ingredient_id since the
    // location is constant for the session.
    const wacPairs = new Map<string, { storeLocationId: string; ingredientId: string }>();

    for (const line of lines) {
      const receivedQty = Number(line.receivedQty);

      if (receivedQty > 0 && line.status !== "REJECTED") {
        // Determine which ingredient to create the batch for
        // For substitutions, we'd need the substituted ingredient from the discrepancy
        let batchIngredientId = line.ingredientId;

        if (line.status === "SUBSTITUTED") {
          const subDisc = discrepancies.find(
            (d) => d.receivingLineId === line.receivingLineId && d.type === "SUBSTITUTION",
          );
          if (subDisc?.substitutedIngredientId) {
            batchIngredientId = subDisc.substitutedIngredientId;
          }
        }

        await fifoService.createBatch(
          {
            storeLocationId: session.storeLocationId,
            ingredientId: batchIngredientId,
            quantity: receivedQty,
            unitCost: line.actualUnitCost,
            sourcePoLineId: line.poLineId,
          },
          tx,
        );

        await stockService.addStock(
          session.storeLocationId,
          batchIngredientId,
          receivedQty,
          tx,
        );

        wacPairs.set(batchIngredientId, {
          storeLocationId: session.storeLocationId,
          ingredientId: batchIngredientId,
        });

        processedLines.push(line.receivingLineId);
      }

      // Update the PO line to reflect receiving
      await tx
        .update(purchaseOrderLine)
        .set({
          receivedQty: line.receivedQty,
          lineStatus: line.status === "REJECTED" ? "REJECTED" : (
            Number(line.receivedQty) < Number(line.orderedQty) ? "SHORT" : "RECEIVED"
          ),
          actualUnitCost: line.actualUnitCost,
          receivedByUserId: session.receivedByUserId,
          receivedDttm: new Date(),
          updatedDttm: new Date(),
        })
        .where(eq(purchaseOrderLine.lineId, line.poLineId));
    }

    // Mark session as COMPLETED
    await tx
      .update(receivingSession)
      .set({ status: "COMPLETED", completedAt: new Date(), updatedDttm: new Date() })
      .where(eq(receivingSession.sessionId, sessionId));

    // Update PO status
    const hasDiscrepancies = discrepancies.length > 0;
    const poStatus = hasDiscrepancies ? "PARTIAL_RECEIVED" : "RECEIVED";

    await tx
      .update(purchaseOrder)
      .set({ status: poStatus, updatedDttm: new Date() })
      .where(eq(purchaseOrder.poId, session.poId));

    // Recompute WAC for every (location, ingredient) pair touched by this
    // receipt. Bulk SQL UPDATE inside the same tx with SELECT FOR UPDATE
    // serialises concurrent receivings on overlapping pairs.
    if (wacPairs.size > 0) {
      await wacService.recompute(
        {
          pairs: Array.from(wacPairs.values()),
          actorUserId: session.receivedByUserId,
          organisationId: po.organisationId,
          trigger: "receiving",
          triggerEntityId: sessionId,
        },
        tx,
      );
    }

    await auditService.log(
      {
        entityType: "receiving_session",
        entityId: sessionId,
        action: "complete",
        actorUserId: session.receivedByUserId,
        organisationId: po.organisationId,
        beforeValue: { status: session.status, completedAt: session.completedAt },
        afterValue: { status: "COMPLETED", completedAt: new Date().toISOString() },
        metadata: {
          poId: po.poId,
          poNumber: po.poNumber,
          poStatus,
          linesProcessed: processedLines.length,
          wacPairsRecomputed: wacPairs.size,
          discrepancyCount: discrepancies.length,
        },
      },
      tx,
    );

    logger.info(
      {
        sessionId,
        poId: po.poId,
        linesProcessed: processedLines.length,
        discrepancyCount: discrepancies.length,
        poStatus,
      },
      "Receiving confirmed",
    );

    return {
      sessionId,
      poId: po.poId,
      poNumber: po.poNumber,
      organisationId: po.organisationId,
      poStatus,
      linesProcessed: processedLines.length,
      discrepancies,
      isPerfectDelivery: discrepancies.length === 0,
    };
  });

  // Notification fires AFTER the transaction commits. If it fails, the
  // receipt is still durable; we just log and move on.
  try {
    const significantDiscrepancies = result.discrepancies.filter((d) => {
      if (d.type === "REJECTED") return true;
      if (d.type === "PRICE_VARIANCE" && d.variancePct) {
        return Math.abs(Number(d.variancePct)) > 5;
      }
      return false;
    });

    if (significantDiscrepancies.length > 0) {
      await notificationService.notifyHQAdmins(
        result.organisationId,
        "DISCREPANCY_ALERT",
        {
          poId: result.poId,
          poNumber: result.poNumber,
          sessionId,
          discrepancyCount: result.discrepancies.length,
          rejectionCount: result.discrepancies.filter((d) => d.type === "REJECTED").length,
          types: [...new Set(significantDiscrepancies.map((d) => d.type))],
        },
        "receiving_session",
        sessionId,
        `Delivery discrepancies on PO ${result.poNumber}`,
        `
          <h2 style="color: #1a1a1a; margin-bottom: 16px;">Delivery Discrepancies Detected</h2>
          <p><strong>PO Number:</strong> ${result.poNumber}</p>
          <p><strong>Total Discrepancies:</strong> ${result.discrepancies.length}</p>
          <p><strong>Rejections:</strong> ${result.discrepancies.filter((d) => d.type === "REJECTED").length}</p>
          <p style="margin-top: 16px;">
            <a href="${process.env.CLIENT_URL || "https://www.culinaire.kitchen"}/inventory?tab=purchase-orders&po=${result.poId}"
               style="background: linear-gradient(135deg, #D4A574, #C4956A); color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
              View Details
            </a>
          </p>
        `,
      );
    }
  } catch (notifyError) {
    // Receipt is committed; just log the notification failure for ops.
    logger.error(
      { sessionId, poId: result.poId, error: notifyError },
      "Discrepancy notification failed — receipt is still committed",
    );
  }

  return {
    sessionId,
    poId: result.poId,
    poStatus: result.poStatus,
    linesProcessed: result.linesProcessed,
    discrepancyCount: result.discrepancies.length,
    isPerfectDelivery: result.isPerfectDelivery,
  };
}

// ── cancelSession ────────────────────────────────────────────────────

/**
 * Cancel a receiving session — returns PO to SENT status.
 *
 * Session cancel + PO status reset + audit row commit together. The audit
 * row carries the previous session status so WAC reverse-recompute (when
 * built in Phase 1) can identify cancellations regardless of when they
 * happened.
 */
export async function cancelSession(sessionId: string) {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(receivingSession)
      .where(eq(receivingSession.sessionId, sessionId));

    if (!session) throw new Error("Receiving session not found");
    validateTransition(session.status, "CANCELLED", RECEIVING_SESSION_TRANSITIONS, "receiving session");

    await tx
      .update(receivingSession)
      .set({ status: "CANCELLED", updatedDttm: new Date() })
      .where(eq(receivingSession.sessionId, sessionId));

    // Return PO to SENT
    await tx
      .update(purchaseOrder)
      .set({ status: "SENT", updatedDttm: new Date() })
      .where(eq(purchaseOrder.poId, session.poId));

    // Org-scope the audit row via the PO.
    const [po] = await tx
      .select()
      .from(purchaseOrder)
      .where(eq(purchaseOrder.poId, session.poId));

    await auditService.log(
      {
        entityType: "receiving_session",
        entityId: sessionId,
        action: "cancel",
        actorUserId: session.receivedByUserId,
        organisationId: po?.organisationId ?? null,
        beforeValue: { status: session.status },
        afterValue: { status: "CANCELLED" },
        metadata: { poId: session.poId },
      },
      tx,
    );

    logger.info({ sessionId }, "Receiving session cancelled");
  });
}

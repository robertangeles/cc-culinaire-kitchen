/**
 * @module services/creditNoteService
 *
 * Credit note logging against delivery discrepancies.
 * Closes the loop: discrepancy → credit note → resolved.
 *
 * One credit note per discrepancy (unique index, migration 0008), never more than the discrepancy is worth, and only
 * once the delivery is confirmed: before that, a re-action on the line replaces the discrepancy row.
 */

import { eq, and, desc, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  creditNote,
  receivingDiscrepancy,
  receivingSession,
  receivingLine,
  purchaseOrder,
  purchaseOrderLine,
  supplier,
  storeLocation,
  ingredient,
} from "../db/schema.js";
import { AppError } from "../utils/appError.js";
import pino from "pino";

const logger = pino({ name: "creditNoteService" });

export interface CreateCreditNoteInput {
  /** Client-made id: a repeat with the same id answers the note it made the first time. */
  creditNoteId?: string;
  discrepancyId: string;
  /** Optional: when sent it must be the discrepancy's own supplier. */
  supplierId?: string;
  organisationId: number;
  creditAmount: number;
  creditReference?: string;
  notes?: string;
  userId: number;
}

export interface DiscrepancyValueInput {
  type: string;
  shortageQty: string | null;
  orderedQty: string;
  receivedQty: string;
  /** The ordered price per ordered unit, else the price recorded at the door. */
  unitPrice: string | null;
  varianceAmount: string | null;
}

const toCents = (n: number) => Math.round(n * 100) / 100;

/**
 * What a discrepancy is worth, the most it can be credited: the missing quantity at the order price for a short
 * delivery, the whole line for a rejection or a substitution, and the extra paid per unit times what arrived for a
 * price rise (nothing for a price drop). Null when there is no price to value it by.
 */
export function discrepancyValue(d: DiscrepancyValueInput): number | null {
  if (d.type === "PRICE_VARIANCE") {
    return d.varianceAmount === null ? null : toCents(Math.max(0, Number(d.varianceAmount)) * Number(d.receivedQty));
  }
  if (d.unitPrice === null) return null;
  const qty = d.type === "SHORT" ? Number(d.shortageQty ?? 0) : Number(d.orderedQty);
  return toCents(qty * Number(d.unitPrice));
}

/** The columns a discrepancy is shown and valued by. Joined from its session, order, line and supplier. */
const discrepancyColumns = {
  discrepancyId: receivingDiscrepancy.discrepancyId,
  type: receivingDiscrepancy.type,
  isResolved: receivingDiscrepancy.isResolved,
  sessionId: receivingDiscrepancy.sessionId,
  sessionStatus: receivingSession.status,
  poId: purchaseOrder.poId,
  poNumber: purchaseOrder.poNumber,
  storeLocationId: receivingSession.storeLocationId,
  supplierId: receivingDiscrepancy.supplierId,
  ingredientId: receivingLine.ingredientId,
  orderedQty: receivingLine.orderedQty,
  orderedUnit: receivingLine.orderedUnit,
  receivedQty: receivingLine.receivedQty,
  shortageQty: receivingDiscrepancy.shortageQty,
  poLineUnitCost: purchaseOrderLine.unitCost,
  lineActualUnitCost: receivingLine.actualUnitCost,
  poUnitCost: receivingDiscrepancy.poUnitCost,
  actualUnitCost: receivingDiscrepancy.actualUnitCost,
  varianceAmount: receivingDiscrepancy.varianceAmount,
  rejectionReason: receivingDiscrepancy.rejectionReason,
  rejectionNote: receivingDiscrepancy.rejectionNote,
  createdAt: receivingDiscrepancy.createdAt,
};

type DiscrepancyRow = {
  type: string;
  shortageQty: string | null;
  orderedQty: string;
  receivedQty: string;
  poLineUnitCost: string | null;
  lineActualUnitCost: string | null;
  varianceAmount: string | null;
};

const valueOf = (d: DiscrepancyRow) =>
  discrepancyValue({ ...d, unitPrice: d.poLineUnitCost ?? d.lineActualUnitCost });

/** The location a discrepancy of this organisation was received at, or null if there is no such discrepancy. */
export async function getDiscrepancyLocationId(discrepancyId: string, orgId: number): Promise<string | null> {
  const [row] = await db
    .select({ storeLocationId: receivingSession.storeLocationId })
    .from(receivingDiscrepancy)
    .innerJoin(receivingSession, eq(receivingDiscrepancy.sessionId, receivingSession.sessionId))
    .innerJoin(purchaseOrder, eq(receivingSession.poId, purchaseOrder.poId))
    .where(and(eq(receivingDiscrepancy.discrepancyId, discrepancyId), eq(purchaseOrder.organisationId, orgId)));
  return row?.storeLocationId ?? null;
}

/**
 * Create a credit note against a discrepancy and mark it resolved, in one transaction. The discrepancy row is locked,
 * so two notes for it cannot both be made. `replay: true` means the client-made id had already made this note.
 */
export async function createCreditNote(input: CreateCreditNoteInput) {
  return db.transaction(async (tx) => {
    const [disc] = await tx
      .select(discrepancyColumns)
      .from(receivingDiscrepancy)
      .innerJoin(receivingSession, eq(receivingDiscrepancy.sessionId, receivingSession.sessionId))
      .innerJoin(purchaseOrder, eq(receivingSession.poId, purchaseOrder.poId))
      .innerJoin(receivingLine, eq(receivingDiscrepancy.receivingLineId, receivingLine.receivingLineId))
      .leftJoin(purchaseOrderLine, eq(receivingLine.poLineId, purchaseOrderLine.lineId))
      .where(
        and(
          eq(receivingDiscrepancy.discrepancyId, input.discrepancyId),
          eq(purchaseOrder.organisationId, input.organisationId),
        ),
      )
      .for("update", { of: receivingDiscrepancy });

    if (!disc) throw new AppError(404, "NOT_FOUND", "Discrepancy not found");

    if (input.creditNoteId) {
      const [existing] = await tx
        .select()
        .from(creditNote)
        .where(eq(creditNote.creditNoteId, input.creditNoteId));
      if (existing) {
        if (existing.createdByUserId !== input.userId || existing.discrepancyId !== input.discrepancyId) {
          throw new AppError(409, "CONFLICT", "That id is already used by another credit note");
        }
        return { note: existing, replay: true };
      }
    }

    if (disc.sessionStatus !== "COMPLETED") {
      throw new AppError(409, "INVALID_STATE", "This delivery is still being received. Credit it once it is confirmed.");
    }
    if (disc.isResolved) throw new AppError(409, "ALREADY_CREDITED", "This discrepancy already has a credit note");
    if (input.supplierId && input.supplierId !== disc.supplierId) {
      throw new AppError(400, "VALIDATION", "The supplier is not the one this discrepancy is with");
    }

    const worth = valueOf(disc);
    if (worth === null) {
      throw new AppError(400, "DISCREPANCY_VALUE_UNKNOWN", "This line has no price, so a credit cannot be checked against it");
    }
    if (toCents(input.creditAmount) > worth) {
      throw new AppError(
        400,
        "CREDIT_EXCEEDS_DISCREPANCY",
        `The credit cannot be more than ${worth.toFixed(2)}, what this discrepancy is worth`,
      );
    }

    const [note] = await tx
      .insert(creditNote)
      .values({
        ...(input.creditNoteId ? { creditNoteId: input.creditNoteId } : {}),
        discrepancyId: input.discrepancyId,
        supplierId: disc.supplierId,
        organisationId: input.organisationId,
        creditAmount: String(input.creditAmount),
        creditReference: input.creditReference,
        notes: input.notes,
        createdByUserId: input.userId,
      })
      .returning();

    await tx
      .update(receivingDiscrepancy)
      .set({ isResolved: true, resolvedAt: new Date() })
      .where(eq(receivingDiscrepancy.discrepancyId, input.discrepancyId));

    logger.info(
      { creditNoteId: note.creditNoteId, discrepancyId: input.discrepancyId },
      "Credit note created, discrepancy resolved",
    );
    return { note, replay: false };
  });
}

/**
 * Credit notes of the organisation for discrepancies received at these locations, newest first; optionally one supplier's.
 */
export async function getCreditNotes(organisationId: number, locationIds: string[], supplierId?: string) {
  if (locationIds.length === 0) return [];
  return db
    .select({
      creditNoteId: creditNote.creditNoteId,
      discrepancyId: creditNote.discrepancyId,
      supplierId: creditNote.supplierId,
      organisationId: creditNote.organisationId,
      creditAmount: creditNote.creditAmount,
      creditReference: creditNote.creditReference,
      notes: creditNote.notes,
      createdByUserId: creditNote.createdByUserId,
      createdAt: creditNote.createdAt,
    })
    .from(creditNote)
    .innerJoin(receivingDiscrepancy, eq(creditNote.discrepancyId, receivingDiscrepancy.discrepancyId))
    .innerJoin(receivingSession, eq(receivingDiscrepancy.sessionId, receivingSession.sessionId))
    .where(
      and(
        eq(creditNote.organisationId, organisationId),
        inArray(receivingSession.storeLocationId, locationIds),
        supplierId ? eq(creditNote.supplierId, supplierId) : undefined,
      ),
    )
    .orderBy(desc(creditNote.createdAt));
}

/** The newest this many open discrepancies are listed: more than a kitchen chases at once. */
const UNRESOLVED_LIMIT = 200;

/**
 * Discrepancies of confirmed deliveries at these locations that have no credit note yet, newest first, each with
 * `maxCreditAmount` (what it is worth; null when the line has no price).
 */
export async function listUnresolvedDiscrepancies(
  organisationId: number,
  locationIds: string[],
  supplierId?: string,
) {
  if (locationIds.length === 0) return [];
  const rows = await db
    .select({
      ...discrepancyColumns,
      supplierName: supplier.supplierName,
      locationName: storeLocation.locationName,
      ingredientName: ingredient.ingredientName,
    })
    .from(receivingDiscrepancy)
    .innerJoin(receivingSession, eq(receivingDiscrepancy.sessionId, receivingSession.sessionId))
    .innerJoin(purchaseOrder, eq(receivingSession.poId, purchaseOrder.poId))
    .innerJoin(receivingLine, eq(receivingDiscrepancy.receivingLineId, receivingLine.receivingLineId))
    .leftJoin(purchaseOrderLine, eq(receivingLine.poLineId, purchaseOrderLine.lineId))
    .leftJoin(supplier, eq(receivingDiscrepancy.supplierId, supplier.supplierId))
    .leftJoin(storeLocation, eq(receivingSession.storeLocationId, storeLocation.storeLocationId))
    .leftJoin(ingredient, eq(receivingLine.ingredientId, ingredient.ingredientId))
    .where(
      and(
        eq(purchaseOrder.organisationId, organisationId),
        eq(receivingDiscrepancy.isResolved, false),
        eq(receivingSession.status, "COMPLETED"),
        inArray(receivingSession.storeLocationId, locationIds),
        supplierId ? eq(receivingDiscrepancy.supplierId, supplierId) : undefined,
      ),
    )
    .orderBy(desc(receivingDiscrepancy.createdAt))
    .limit(UNRESOLVED_LIMIT);

  return rows.map(({ isResolved: _r, sessionStatus: _s, poLineUnitCost, lineActualUnitCost, ...row }) => ({
    ...row,
    maxCreditAmount: valueOf({ ...row, poLineUnitCost, lineActualUnitCost }),
  }));
}

/**
 * @module services/creditNoteService
 *
 * Credit note logging against delivery discrepancies.
 * Closes the loop: discrepancy → credit note → resolved.
 */

import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { creditNote, receivingDiscrepancy, receivingSession, purchaseOrder } from "../db/schema.js";
import pino from "pino";

const logger = pino({ name: "creditNoteService" });

export interface CreateCreditNoteInput {
  discrepancyId: string;
  supplierId: string;
  organisationId: number;
  creditAmount: number;
  creditReference?: string;
  notes?: string;
  userId: number;
}

/**
 * Create a credit note against a discrepancy. Marks the discrepancy as resolved.
 */
export async function createCreditNote(input: CreateCreditNoteInput) {
  // Validate discrepancy exists, belongs to caller's org, and is not already resolved.
  // Join through session → PO to reach organisationId (discrepancy has no direct org column).
  const [disc] = await db
    .select({
      discrepancyId: receivingDiscrepancy.discrepancyId,
      isResolved: receivingDiscrepancy.isResolved,
      orgId: purchaseOrder.organisationId,
    })
    .from(receivingDiscrepancy)
    .innerJoin(receivingSession, eq(receivingDiscrepancy.sessionId, receivingSession.sessionId))
    .innerJoin(purchaseOrder, eq(receivingSession.poId, purchaseOrder.poId))
    .where(eq(receivingDiscrepancy.discrepancyId, input.discrepancyId));

  if (!disc) throw new Error("Discrepancy not found");
  if (disc.orgId !== input.organisationId) throw new Error("Discrepancy not found");
  if (disc.isResolved) throw new Error("Discrepancy is already resolved");

  // Create credit note
  const [note] = await db
    .insert(creditNote)
    .values({
      discrepancyId: input.discrepancyId,
      supplierId: input.supplierId,
      organisationId: input.organisationId,
      creditAmount: String(input.creditAmount),
      creditReference: input.creditReference,
      notes: input.notes,
      createdByUserId: input.userId,
    })
    .returning();

  // Mark discrepancy as resolved
  await db
    .update(receivingDiscrepancy)
    .set({ isResolved: true, resolvedAt: new Date() })
    .where(eq(receivingDiscrepancy.discrepancyId, input.discrepancyId));

  logger.info(
    { creditNoteId: note.creditNoteId, discrepancyId: input.discrepancyId },
    "Credit note created, discrepancy resolved",
  );

  return note;
}

/**
 * Get all credit notes for a supplier scoped to the caller's org.
 */
export async function getCreditNotesForSupplier(supplierId: string, organisationId: number) {
  return db
    .select()
    .from(creditNote)
    .where(and(eq(creditNote.supplierId, supplierId), eq(creditNote.organisationId, organisationId)))
    .orderBy(desc(creditNote.createdAt));
}

/**
 * Get all credit notes for an org.
 */
export async function getCreditNotesForOrg(orgId: number) {
  return db
    .select()
    .from(creditNote)
    .where(eq(creditNote.organisationId, orgId))
    .orderBy(desc(creditNote.createdAt));
}

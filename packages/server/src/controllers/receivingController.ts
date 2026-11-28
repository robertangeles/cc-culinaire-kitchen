/**
 * @module controllers/receivingController
 *
 * Input validation and response formatting for delivery receiving.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import { getUserLocationContext, assertLocationAccess } from "../services/locationContextService.js";
import * as receivingService from "../services/receivingService.js";
import * as creditNoteService from "../services/creditNoteService.js";

const logger = pino({ name: "receivingController" });

// ─── Helpers ─────────────────────────────────────────────────────

async function resolveOrgId(req: Request, res: Response): Promise<number | null> {
  const ctx = await getUserLocationContext(req.user!.sub);
  // Prefer a location's org; fall back to the admin's org membership so a
  // location-less org admin can still manage org-wide records (e.g. suppliers).
  const orgId = ctx.locations[0]?.organisationId ?? ctx.organisationId;
  if (orgId === null) {
    res.status(400).json({ error: "You are not a member of any organisation", code: "FORBIDDEN" });
    return null;
  }
  return orgId;
}

/** A session is worked at its own location: the caller must be able to use it. Unknown sessions are left to the service to report. */
async function assertSessionAccess(req: Request, sessionId: string, orgId: number): Promise<void> {
  const locationId = await receivingService.getSessionLocationId(sessionId, orgId);
  if (locationId) await assertLocationAccess(req.user!, locationId);
}

// ─── Schemas ─────────────────────────────────────────────────────

const StartSessionSchema = z.object({
  poId: z.string().uuid(),
  storeLocationId: z.string().uuid(),
});

// The status is left out when only the expiry date or lot number changes (the service checks their values).
const ActionLineSchema = z.object({
  status: z.enum(["RECEIVED", "SHORT", "REJECTED", "PRICE_VARIANCE", "SUBSTITUTED"]).optional(),
  receivedQty: z.string().refine(
    (v) => v.trim() !== "" && !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).optional(),
  actualUnitCost: z.string().refine(
    (v) => v.trim() !== "" && !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).optional(),
  rejectionReason: z.enum(["quality", "damaged", "temperature", "expired", "other"]).optional(),
  rejectionNote: z.string().max(500).optional(),
  substitutedIngredientId: z.string().uuid().optional(),
  expiryDate: z.string().nullable().optional(),
  lotNumber: z.string().nullable().optional(),
}).refine(
  (b) => b.status !== undefined || b.expiryDate !== undefined || b.lotNumber !== undefined,
  "Send a status, an expiry date or a lot number",
);

// Older apps confirm with no body at all.
const ConfirmReceiptSchema = z.object({
  docketNumber: z.string().nullable().optional(),
});

const CreateCreditNoteSchema = z.object({
  // Client-made id, so a repeat after a lost reply answers the first note instead of making a second.
  creditNoteId: z.string().uuid("creditNoteId must be a UUID").optional(),
  discrepancyId: z.string().uuid("Choose a discrepancy"),
  creditAmount: z.number({ required_error: "Enter the credit amount" }).min(0.01, "Credit amount must be at least 0.01").finite(),
  creditReference: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

const CreditListQuerySchema = z.object({
  supplierId: z.string().uuid("supplierId must be a UUID").optional(),
});

const UnresolvedListQuerySchema = CreditListQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── Handlers ────────────────────────────────────────────────────

export async function handleStartSession(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const parsed = StartSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    await assertLocationAccess(req.user!, parsed.data.storeLocationId);

    const userId = req.user!.sub;
    const result = await receivingService.startSession(
      parsed.data.poId,
      parsed.data.storeLocationId,
      userId,
      orgId,
    );

    logger.info({ sessionId: result.session.sessionId, poId: parsed.data.poId, userId }, "Receiving session started");
    res.status(201).json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found") || msg.includes("Cannot") || msg.includes("already in progress")) {
      res.status(400).json({ error: msg });
      return;
    }
    next(err);
  }
}

export async function handleGetSession(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const sessionId = req.params.sessionId as string;
    await assertSessionAccess(req, sessionId, orgId);
    const result = await receivingService.getSession(sessionId, orgId);

    if (!result) {
      res.status(404).json({ error: "Receiving session not found" });
      return;
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function handleActionLine(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const sessionId = req.params.sessionId as string;
    const receivingLineId = req.params.lineId as string;

    const parsed = ActionLineSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", code: "VALIDATION", details: parsed.error.flatten() });
      return;
    }

    await assertSessionAccess(req, sessionId, orgId);
    const result = await receivingService.actionLine(receivingLineId, sessionId, parsed.data, orgId, req.user!.sub);

    logger.info({ sessionId, receivingLineId, status: parsed.data.status }, "Receiving line actioned");
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found") || msg.includes("not active") || msg.includes("no longer active")) {
      res.status(400).json({ error: msg });
      return;
    }
    next(err);
  }
}

export async function handleConfirmReceipt(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const sessionId = req.params.sessionId as string;
    const parsed = ConfirmReceiptSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", code: "VALIDATION", details: parsed.error.flatten() });
      return;
    }

    await assertSessionAccess(req, sessionId, orgId);
    const result = await receivingService.confirmReceipt(sessionId, orgId, req.user!.sub, parsed.data);

    logger.info({ sessionId, poStatus: result.poStatus }, "Receipt confirmed");
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      res.status(400).json({ error: msg });
      return;
    }
    next(err);
  }
}

export async function handleCancelSession(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const sessionId = req.params.sessionId as string;
    await assertSessionAccess(req, sessionId, orgId);
    await receivingService.cancelSession(sessionId, orgId, req.user!.sub);

    logger.info({ sessionId }, "Receiving session cancelled");
    res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      res.status(400).json({ error: msg });
      return;
    }
    next(err);
  }
}

// ─── Credit Notes ────────────────────────────────────────────────

export async function handleCreateCreditNote(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const userId = req.user!.sub;

    const parsed = CreateCreditNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation failed", code: "VALIDATION", details: parsed.error.flatten() });
      return;
    }

    const { note, replay } = await creditNoteService.createCreditNote({
      ...parsed.data,
      organisationId: orgId,
      userId,
    });

    logger.info({ creditNoteId: note.creditNoteId, userId, replay }, "Credit note created");
    res.status(replay ? 200 : 201).json(note);
  } catch (err) {
    next(err);
  }
}

export async function handleGetCreditNotes(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const parsed = CreditListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation failed", code: "VALIDATION", details: parsed.error.flatten() });
      return;
    }

    res.json(await creditNoteService.getCreditNotes(orgId, parsed.data.supplierId));
  } catch (err) {
    next(err);
  }
}

/** One page of the organisation's discrepancies of confirmed deliveries that still have no credit note. */
export async function handleGetUnresolvedDiscrepancies(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const parsed = UnresolvedListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation failed", code: "VALIDATION", details: parsed.error.flatten() });
      return;
    }

    const { supplierId, ...page } = parsed.data;
    res.json(await creditNoteService.listUnresolvedDiscrepancies(orgId, page, supplierId));
  } catch (err) {
    next(err);
  }
}

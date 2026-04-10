/**
 * @module controllers/receivingController
 *
 * Input validation and response formatting for delivery receiving.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import { getUserLocationContext } from "../services/locationContextService.js";
import * as receivingService from "../services/receivingService.js";
import * as creditNoteService from "../services/creditNoteService.js";

const logger = pino({ name: "receivingController" });

// ─── Helpers ─────────────────────────────────────────────────────

async function resolveOrgId(req: Request, res: Response): Promise<number | null> {
  const ctx = await getUserLocationContext(req.user!.sub);
  if (ctx.locations.length === 0) {
    res.status(400).json({ error: "You are not a member of any organisation" });
    return null;
  }
  return ctx.locations[0].organisationId;
}

// ─── Schemas ─────────────────────────────────────────────────────

const StartSessionSchema = z.object({
  poId: z.string().uuid(),
  storeLocationId: z.string().uuid(),
});

const ActionLineSchema = z.object({
  status: z.enum(["RECEIVED", "SHORT", "REJECTED", "PRICE_VARIANCE", "SUBSTITUTED"]),
  receivedQty: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).optional(),
  actualUnitCost: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).optional(),
  rejectionReason: z.enum(["quality", "damaged", "temperature", "expired", "other"]).optional(),
  rejectionNote: z.string().max(500).optional(),
  substitutedIngredientId: z.string().uuid().optional(),
});

const CreateCreditNoteSchema = z.object({
  discrepancyId: z.string().uuid(),
  supplierId: z.string().uuid(),
  creditAmount: z.number().positive("Credit amount must be positive"),
  creditReference: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

// ─── Handlers ────────────────────────────────────────────────────

export async function handleStartSession(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const parsed = StartSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const userId = req.user!.sub;
    const result = await receivingService.startSession(
      parsed.data.poId,
      parsed.data.storeLocationId,
      userId,
    );

    logger.info({ sessionId: result.session.sessionId, poId: parsed.data.poId, userId }, "Receiving session started");
    res.status(201).json(result);
  } catch (err: any) {
    if (err.message?.includes("not found") || err.message?.includes("Cannot") || err.message?.includes("already in progress")) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function handleGetSession(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const sessionId = req.params.sessionId as string;
    const result = await receivingService.getSession(sessionId);

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
    const sessionId = req.params.sessionId as string;
    const receivingLineId = req.params.lineId as string;

    const parsed = ActionLineSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const result = await receivingService.actionLine(receivingLineId, sessionId, parsed.data);

    logger.info({ sessionId, receivingLineId, status: parsed.data.status }, "Receiving line actioned");
    res.json(result);
  } catch (err: any) {
    if (err.message?.includes("not found") || err.message?.includes("not active") || err.message?.includes("no longer active")) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function handleConfirmReceipt(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const sessionId = req.params.sessionId as string;
    const result = await receivingService.confirmReceipt(sessionId);

    logger.info({ sessionId, poStatus: result.poStatus }, "Receipt confirmed");
    res.json(result);
  } catch (err: any) {
    if (err.message?.includes("not found") || err.message?.includes("Cannot transition")) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function handleCancelSession(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const sessionId = req.params.sessionId as string;
    await receivingService.cancelSession(sessionId);

    logger.info({ sessionId }, "Receiving session cancelled");
    res.json({ success: true });
  } catch (err: any) {
    if (err.message?.includes("not found") || err.message?.includes("Cannot transition")) {
      res.status(400).json({ error: err.message });
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
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const result = await creditNoteService.createCreditNote({
      ...parsed.data,
      organisationId: orgId,
      userId,
    });

    logger.info({ creditNoteId: result.creditNoteId, userId }, "Credit note created");
    res.status(201).json(result);
  } catch (err: any) {
    if (err.message?.includes("not found") || err.message?.includes("already resolved")) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function handleGetCreditNotes(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const supplierId = req.query.supplierId as string | undefined;
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const result = supplierId
      ? await creditNoteService.getCreditNotesForSupplier(supplierId)
      : await creditNoteService.getCreditNotesForOrg(orgId);

    res.json(result);
  } catch (err) {
    next(err);
  }
}

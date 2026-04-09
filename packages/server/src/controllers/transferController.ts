/**
 * @module controllers/transferController
 *
 * Input validation and response formatting for inter-location
 * stock transfers. Maps HTTP requests to transferService functions.
 */

import type { Request, Response, NextFunction } from "express";
import pino from "pino";
import { getUserLocationContext } from "../services/locationContextService.js";
import * as transferService from "../services/transferService.js";

const logger = pino({ name: "transferController" });

/** Resolve the user's org ID from their location context. */
async function resolveOrgId(req: Request, res: Response): Promise<number | null> {
  const ctx = await getUserLocationContext(req.user!.sub);
  if (ctx.locations.length === 0) {
    res.status(400).json({ error: "You are not a member of any organisation" });
    return null;
  }
  return ctx.locations[0].organisationId;
}

// ─── Initiate transfer ──────────────────────────────────────────

/** POST /transfers */
export async function handleInitiateTransfer(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const userId = req.user!.sub;
    const { fromLocationId, toLocationId, lines, notes } = req.body;

    if (!fromLocationId) {
      res.status(400).json({ error: "fromLocationId is required" });
      return;
    }
    if (!toLocationId) {
      res.status(400).json({ error: "toLocationId is required" });
      return;
    }
    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ error: "lines array is required with at least one item" });
      return;
    }

    for (const line of lines) {
      if (!line.ingredientId || !line.sentQty || !line.sentUnit) {
        res.status(400).json({ error: "Each line requires ingredientId, sentQty, sentUnit" });
        return;
      }
      if (Number(line.sentQty) <= 0) {
        res.status(400).json({ error: "sentQty must be greater than 0" });
        return;
      }
    }

    const transfer = await transferService.initiateTransfer(
      orgId, fromLocationId, toLocationId, userId, lines, notes,
    );

    res.status(201).json(transfer);
  } catch (err: any) {
    if (err.message?.includes("not found") || err.message?.includes("must be different")) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error(err, "handleInitiateTransfer failed");
    next(err);
  }
}

// ─── Confirm sent ───────────────────────────────────────────────

/** POST /transfers/:id/send */
export async function handleConfirmSent(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const transfer = await transferService.confirmSent(
      req.params.id as string, orgId, req.user!.sub,
    );

    res.json(transfer);
  } catch (err: any) {
    if (err.message?.includes("not found")) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err.message?.includes("Cannot send")) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error(err, "handleConfirmSent failed");
    next(err);
  }
}

// ─── Confirm received ───────────────────────────────────────────

/** POST /transfers/:id/receive */
export async function handleConfirmReceived(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const { receivedLines } = req.body;

    if (!receivedLines || !Array.isArray(receivedLines)) {
      res.status(400).json({ error: "receivedLines array is required" });
      return;
    }

    const transfer = await transferService.confirmReceived(
      req.params.id as string, orgId, req.user!.sub, receivedLines,
    );

    res.json(transfer);
  } catch (err: any) {
    if (err.message?.includes("not found")) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err.message?.includes("Cannot receive")) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error(err, "handleConfirmReceived failed");
    next(err);
  }
}

// ─── Cancel transfer ────────────────────────────────────────────

/** POST /transfers/:id/cancel */
export async function handleCancelTransfer(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const transfer = await transferService.cancelTransfer(
      req.params.id as string, orgId, req.user!.sub,
    );

    res.json(transfer);
  } catch (err: any) {
    if (err.message?.includes("not found")) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err.message?.includes("Only INITIATED")) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error(err, "handleCancelTransfer failed");
    next(err);
  }
}

// ─── List transfers ─────────────────────────────────────────────

/** GET /transfers */
export async function handleListTransfers(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const { status, storeLocationId, limit } = req.query;

    const transfers = await transferService.listTransfers(orgId, {
      status: status as string | undefined,
      storeLocationId: storeLocationId as string | undefined,
      limit: limit ? Number(limit) : undefined,
    });

    res.json(transfers);
  } catch (err) {
    logger.error(err, "handleListTransfers failed");
    next(err);
  }
}

// ─── Get transfer detail ────────────────────────────────────────

/** GET /transfers/:id */
export async function handleGetTransferDetail(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const transfer = await transferService.getTransferDetail(req.params.id as string, orgId);
    if (!transfer) {
      res.status(404).json({ error: "Transfer not found" });
      return;
    }

    res.json(transfer);
  } catch (err) {
    logger.error(err, "handleGetTransferDetail failed");
    next(err);
  }
}

// ─── List pending incoming ──────────────────────────────────────

/** GET /transfers/pending */
export async function handleListPending(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const { storeLocationId } = req.query;

    if (!storeLocationId) {
      res.status(400).json({ error: "storeLocationId query param is required" });
      return;
    }

    const transfers = await transferService.listPendingTransfers(
      storeLocationId as string,
    );

    res.json(transfers);
  } catch (err) {
    logger.error(err, "handleListPending failed");
    next(err);
  }
}

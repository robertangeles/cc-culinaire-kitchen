/**
 * @module controllers/transferController
 *
 * Input validation and response formatting for inter-location
 * stock transfers. Maps HTTP requests to transferService functions.
 */

import type { Request, Response, NextFunction } from "express";
import pino from "pino";
import { getUserLocationContext, assertLocationAccess, canAccessLocation } from "../services/locationContextService.js";
import { AppError } from "../utils/appError.js";
import * as transferService from "../services/transferService.js";

const logger = pino({ name: "transferController" });

/** Resolve the user's org ID from their location context. */
async function resolveOrgId(req: Request, res: Response): Promise<number | null> {
  const ctx = await getUserLocationContext(req.user!.sub);
  // Prefer a location's org; fall back to the admin's org membership so a
  // location-less org admin can still manage org-wide records (e.g. suppliers).
  const orgId = ctx.locations[0]?.organisationId ?? ctx.organisationId;
  if (orgId === null) {
    res.status(400).json({ error: "You are not a member of any organisation" });
    return null;
  }
  return orgId;
}

/**
 * A transfer is acted on from one of its ends: sending, cancelling and editing from the
 * source, receiving at the destination. The caller must be able to use that end (a transfer
 * that does not exist is left to the service to report).
 */
async function assertTransferAccess(
  req: Request, transferId: string, orgId: number, ends: Array<"from" | "to">,
): Promise<void> {
  const t = await transferService.getTransferEndpoints(transferId, orgId);
  if (!t) return;
  for (const end of ends) {
    if (await canAccessLocation(req.user!, end === "from" ? t.fromLocationId : t.toLocationId)) return;
  }
  throw new AppError(403, "LOCATION_NOT_ALLOWED", "You do not have access to this location");
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

    // Stock leaves the source, so it must be the caller's; the destination only has to be in the organisation.
    await assertLocationAccess(req.user!, fromLocationId);

    const transfer = await transferService.initiateTransfer(
      orgId, fromLocationId, toLocationId, userId, lines, notes,
    );

    res.status(201).json(transfer);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found") || msg.includes("must be different")) {
      res.status(400).json({ error: msg });
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

    await assertTransferAccess(req, req.params.id as string, orgId, ["from"]);
    const transfer = await transferService.confirmSent(
      req.params.id as string, orgId, req.user!.sub,
    );

    res.json(transfer);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
      return;
    }
    if (msg.includes("Cannot send")) {
      res.status(400).json({ error: msg });
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

    await assertTransferAccess(req, req.params.id as string, orgId, ["to"]);
    const transfer = await transferService.confirmReceived(
      req.params.id as string, orgId, req.user!.sub, receivedLines,
    );

    res.json(transfer);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
      return;
    }
    if (msg.includes("Cannot receive")) {
      res.status(400).json({ error: msg });
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

    await assertTransferAccess(req, req.params.id as string, orgId, ["from"]);
    const transfer = await transferService.cancelTransfer(
      req.params.id as string, orgId, req.user!.sub,
    );

    res.json(transfer);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
      return;
    }
    if (msg.includes("Only INITIATED")) {
      res.status(400).json({ error: msg });
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

    if (storeLocationId) await assertLocationAccess(req.user!, storeLocationId as string);

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

    await assertTransferAccess(req, req.params.id as string, orgId, ["from", "to"]);
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
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const { storeLocationId } = req.query;

    if (!storeLocationId) {
      res.status(400).json({ error: "storeLocationId query param is required" });
      return;
    }

    await assertLocationAccess(req.user!, storeLocationId as string);

    const transfers = await transferService.listPendingTransfers(
      storeLocationId as string,
      orgId,
    );

    res.json(transfers);
  } catch (err) {
    logger.error(err, "handleListPending failed");
    next(err);
  }
}

/** PUT /transfers/:id — update lines + notes on an INITIATED transfer */
export async function handleUpdateTransfer(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const id = req.params.id as string;
    const { lines, notes } = req.body;

    if (!Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ error: "lines array is required" });
      return;
    }

    await assertTransferAccess(req, id, orgId, ["from"]);
    const result = await transferService.updateTransfer(id, orgId, { lines, notes });
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "not found") {
      res.status(404).json({ error: "Transfer not found" });
    } else if (msg.includes("no longer editable")) {
      res.status(409).json({ error: msg });
    } else if (msg.includes("ingredients not found")) {
      res.status(400).json({ error: msg });
    } else {
      logger.error(err, "handleUpdateTransfer failed");
      next(err);
    }
  }
}

/** POST /transfers/:id/lines — add items to an INITIATED transfer */
export async function handleAddLines(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const id = req.params.id as string;
    const { lines } = req.body;

    if (!Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ error: "lines array is required" });
      return;
    }

    await assertTransferAccess(req, id, orgId, ["from"]);
    const result = await transferService.addLinesToTransfer(id, orgId, lines);
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "not found") {
      res.status(404).json({ error: "Transfer not found" });
    } else if (msg.includes("no longer editable")) {
      res.status(409).json({ error: msg });
    } else if (msg.includes("ingredients not found")) {
      res.status(400).json({ error: msg });
    } else {
      logger.error(err, "handleAddLines failed");
      next(err);
    }
  }
}

/**
 * @module controllers/catalogRequestController
 *
 * Handles HTTP layer for catalog item requests from location staff.
 * Location counters can request new items; HQ admins review and approve/reject.
 */

import type { Request, Response, NextFunction } from "express";
import pino from "pino";
import { getUserLocationContext } from "../services/locationContextService.js";
import {
  requestNewItem,
  listPendingRequests,
  approveRequest,
  rejectRequest,
} from "../services/catalogRequestService.js";

const logger = pino({ name: "catalogRequestController" });

/** Resolve the user's org ID from their location context. */
async function resolveOrgId(req: Request, res: Response): Promise<number | null> {
  const ctx = await getUserLocationContext(req.user!.sub);
  if (ctx.locations.length === 0) {
    res.status(400).json({ error: "You are not a member of any organisation" });
    return null;
  }
  return ctx.locations[0].organisationId;
}

// ─── Request a new catalog item ─────────────────────────────────

/** POST /catalog-requests */
export async function handleRequestNewItem(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const { itemName, itemType, category, baseUnit, countedQty } = req.body;
    if (!itemName) {
      res.status(400).json({ error: "itemName is required" });
      return;
    }

    const result = await requestNewItem(
      orgId,
      req.body.storeLocationId,
      req.user!.sub,
      { itemName, itemType, category, baseUnit, countedQty },
    );

    logger.info(
      { requestId: result.requestId, itemName, userId: req.user!.sub },
      "Catalog item request submitted",
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

// ─── List pending requests (HQ) ─────────────────────────────────

/** GET /catalog-requests/pending */
export async function handleListPendingRequests(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const requests = await listPendingRequests(orgId);
    res.json(requests);
  } catch (err) {
    next(err);
  }
}

// ─── Approve a request (HQ) ─────────────────────────────────────

/** POST /catalog-requests/:id/approve */
export async function handleApproveRequest(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const id = req.params.id as string;
    const { ingredientCategory, baseUnit, itemType } = req.body;
    const result = await approveRequest(
      id,
      orgId,
      req.user!.sub,
      { ingredientCategory, baseUnit, itemType },
    );

    logger.info(
      { requestId: id, userId: req.user!.sub },
      "Catalog item request approved",
    );
    res.json(result);
  } catch (err: any) {
    if (err.message === "Request not found") {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err.message === "Request already reviewed") {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// ─── Reject a request (HQ) ──────────────────────────────────────

/** POST /catalog-requests/:id/reject */
export async function handleRejectRequest(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const id = req.params.id as string;
    const { reason } = req.body;
    if (!reason) {
      res.status(400).json({ error: "reason is required" });
      return;
    }

    const result = await rejectRequest(
      id,
      orgId,
      req.user!.sub,
      reason,
    );

    logger.info(
      { requestId: id, userId: req.user!.sub },
      "Catalog item request rejected",
    );
    res.json(result);
  } catch (err: any) {
    if (err.message === "Request not found") {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err.message === "Request already reviewed") {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}

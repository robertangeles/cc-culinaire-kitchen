/**
 * @module controllers/catalogRequestController
 *
 * Handles HTTP layer for catalog item requests from location staff.
 * Location counters can request new items; HQ admins review and approve/reject.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import { getUserLocationContext, assertLocationAccess } from "../services/locationContextService.js";
import {
  requestNewItem,
  listMyRequests,
  listPendingRequests,
  approveRequest,
  rejectRequest,
} from "../services/catalogRequestService.js";

const logger = pino({ name: "catalogRequestController" });

/** A staff request for an item the catalogue lacks. Lengths match the table's columns. */
const RequestItemSchema = z.object({
  requestId: z.string().uuid().optional(),
  storeLocationId: z.string().uuid(),
  itemName: z.string().trim().min(1).max(200),
  itemType: z.string().max(20).optional(),
  category: z.string().max(50).optional(),
  baseUnit: z.string().max(20).optional(),
  countedQty: z.number().finite().min(0).optional(),
});

/** A page of `GET /catalog-requests/mine`. */
const MineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Resolve the user's org ID from their location context. */
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

// ─── Request a new catalog item ─────────────────────────────────

/** POST /catalog-requests: 201, or 200 for a resend of the same client-made `requestId`. */
export async function handleRequestNewItem(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const parsed = RequestItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Give the item a name (up to 200 characters) and the location it was found at",
        code: "VALIDATION",
        details: parsed.error.flatten(),
      });
      return;
    }
    const { requestId, storeLocationId, ...item } = parsed.data;

    await assertLocationAccess(req.user!, storeLocationId);

    const { request, replay } = await requestNewItem(orgId, storeLocationId, req.user!.sub, item, requestId);

    logger.info(
      { requestId: request.requestId, itemName: item.itemName, userId: req.user!.sub, replay },
      "Catalog item request submitted",
    );
    res.status(replay ? 200 : 201).json(request);
  } catch (err) {
    next(err);
  }
}

// ─── The caller's own requests ──────────────────────────────────

/** GET /catalog-requests/mine?limit=&offset=: `{ data, total }`, newest first. */
export async function handleListMyRequests(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const parsed = MineQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "limit must be 1 to 100 and offset 0 or more",
        code: "VALIDATION",
        details: parsed.error.flatten(),
      });
      return;
    }
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    res.json(await listMyRequests(orgId, req.user!.sub, parsed.data));
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "Request not found") {
      res.status(404).json({ error: msg, code: "NOT_FOUND" });
      return;
    }
    if (msg === "Request already reviewed") {
      res.status(409).json({ error: msg, code: "ALREADY_CONFIRMED" });
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
      res.status(400).json({ error: "reason is required", code: "VALIDATION" });
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "Request not found") {
      res.status(404).json({ error: msg, code: "NOT_FOUND" });
      return;
    }
    if (msg === "Request already reviewed") {
      res.status(409).json({ error: msg, code: "ALREADY_CONFIRMED" });
      return;
    }
    next(err);
  }
}

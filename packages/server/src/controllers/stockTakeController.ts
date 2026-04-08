/**
 * @module controllers/stockTakeController
 *
 * Input validation and response formatting for the stock take workflow:
 * session lifecycle, category management, line item counting, and HQ review.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import { getUserLocationContext } from "../services/locationContextService.js";
import {
  openSession,
  getActiveSession,
  getSessionDetail,
  claimCategory,
  submitCategory,
  approveSession,
  flagSession,
  saveLineItem,
  getCategoryLines,
  getPreviousCountLines,
  getLocationDashboard,
  ConflictError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from "../services/stockTakeService.js";

const logger = pino({ name: "stockTakeController" });

const SaveLineItemSchema = z.object({
  ingredientId: z.string().uuid(),
  rawQty: z.number().min(0).max(99999),
  countedUnit: z.string().min(1).max(20),
});

const FlagSessionSchema = z.object({
  flaggedCategories: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1).max(500),
});

// ─── Helpers ──────────────────────────────────────────────────────

function handleServiceError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof ConflictError) {
    res.status(409).json({ error: err.message });
  } else if (err instanceof InvalidStateError) {
    res.status(400).json({ error: err.message });
  } else if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
  } else if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message });
  } else {
    next(err);
  }
}

/** Resolve org + selected location from the user's context. */
async function resolveContext(req: Request, res: Response) {
  const ctx = await getUserLocationContext(req.user!.sub);
  if (ctx.locations.length === 0) {
    res.status(400).json({ error: "You are not a member of any organisation" });
    return null;
  }
  return {
    orgId: ctx.locations[0].organisationId,
    selectedLocationId: ctx.selectedLocationId,
    isOrgAdmin: ctx.isOrgAdmin,
  };
}

// ─── Session lifecycle ────────────────────────────────────────────

export async function handleOpenSession(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    if (!ctx.selectedLocationId) {
      res.status(400).json({ error: "No location selected. Please select a location first." });
      return;
    }

    const session = await openSession(ctx.selectedLocationId, ctx.orgId, req.user!.sub);

    logger.info(
      { sessionId: session.sessionId, locationId: ctx.selectedLocationId, userId: req.user!.sub },
      "Stock take session opened",
    );
    res.status(201).json(session);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleGetActiveSession(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    if (!ctx.selectedLocationId) {
      res.status(400).json({ error: "No location selected" });
      return;
    }

    const session = await getActiveSession(ctx.selectedLocationId);
    res.json(session);
  } catch (err) {
    next(err);
  }
}

export async function handleGetSessionDetail(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const session = await getSessionDetail(req.params.id as string, ctx.orgId);
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }

    res.json(session);
  } catch (err) {
    next(err);
  }
}

// ─── Category actions ─────────────────────────────────────────────

export async function handleClaimCategory(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const cat = await claimCategory(req.params.id as string, req.params.cat as string, req.user!.sub);

    logger.info(
      { sessionId: req.params.id as string, category: req.params.cat as string, userId: req.user!.sub },
      "Category claimed",
    );
    res.json(cat);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleSaveLineItem(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const parsed = SaveLineItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    // Resolve category ID from session + category name
    const session = await getSessionDetail(req.params.id as string, ctx.orgId);
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }

    const cat = session.categories.find((c) => c.categoryName === req.params.cat as string);
    if (!cat) { res.status(404).json({ error: `Category "${req.params.cat as string}" not found` }); return; }

    if (cat.categoryStatus !== "IN_PROGRESS") {
      res.status(400).json({ error: `Cannot count: category is ${cat.categoryStatus}` });
      return;
    }

    const line = await saveLineItem(
      cat.categoryId,
      parsed.data.ingredientId,
      parsed.data.rawQty,
      parsed.data.countedUnit,
      req.user!.sub,
    );

    res.json(line);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleGetCategoryLines(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const session = await getSessionDetail(req.params.id as string, ctx.orgId);
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }

    const cat = session.categories.find((c) => c.categoryName === req.params.cat as string);
    if (!cat) { res.status(404).json({ error: `Category "${req.params.cat as string}" not found` }); return; }

    const lines = await getCategoryLines(cat.categoryId);
    res.json(lines);
  } catch (err) {
    next(err);
  }
}

export async function handleSubmitCategory(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const cat = await submitCategory(req.params.id as string, req.params.cat as string);

    logger.info(
      { sessionId: req.params.id as string, category: req.params.cat as string, userId: req.user!.sub },
      "Category submitted",
    );
    res.json(cat);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

// ─── HQ review ────────────────────────────────────────────────────

export async function handleApproveSession(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const session = await approveSession(req.params.id as string, req.user!.sub);

    logger.info(
      { sessionId: req.params.id as string, userId: req.user!.sub },
      "Stock take session approved — stock levels updated",
    );
    res.json(session);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleFlagSession(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const parsed = FlagSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const session = await flagSession(
      req.params.id as string,
      parsed.data.flaggedCategories,
      parsed.data.reason,
    );

    logger.info(
      { sessionId: req.params.id as string, flaggedCategories: parsed.data.flaggedCategories, userId: req.user!.sub },
      "Stock take session flagged",
    );
    res.json(session);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

// ─── Copy Last Count (pre-fill) ──────────────────────────────────

export async function handleGetPreviousLines(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    if (!ctx.selectedLocationId) {
      res.status(400).json({ error: "No location selected" });
      return;
    }

    const lines = await getPreviousCountLines(ctx.selectedLocationId, req.params.cat as string);
    res.json(lines);
  } catch (err) {
    next(err);
  }
}

// ─── Location dashboard ──────────────────────────────────────────

export async function handleGetLocationDashboard(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const dashboard = await getLocationDashboard(req.params.locId as string, ctx.orgId);
    res.json(dashboard);
  } catch (err) {
    next(err);
  }
}

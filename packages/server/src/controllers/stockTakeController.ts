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
  submitSessionForReview,
  approveSession,
  flagSession,
  saveLineItem,
  getCategoryLines,
  getPreviousCountLines,
  getPendingReviewSessions,
  getApprovedSessions,
  getLocationDashboard,
  getOrgDashboardSummary,
  openOpeningCount,
  ConflictError,
  SheetIncompleteError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
  ForbiddenError,
  assertCanCount,
} from "../services/stockTakeService.js";
import { hasPermission } from "../middleware/auth.js";
import { getAreaCountSheets } from "../services/areaSessionService.js";
import type { TokenPayload } from "../services/authService.js";

const logger = pino({ name: "stockTakeController" });

const SaveLineItemSchema = z.object({
  ingredientId: z.string().uuid(),
  rawQty: z.number().min(0).max(99999),
  countedUnit: z.string().min(1).max(20),
  // The claim revision the phone queued this line under (mobile eng D10). Optional: the web does not send it.
  claimRevision: z.number().int().min(0).optional(),
});

const SubmitCategorySchema = z.object({
  claimRevision: z.number().int().min(0).optional(),
});

const FlagSessionSchema = z.object({
  flaggedCategories: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1).max(500),
});

// ─── Helpers ──────────────────────────────────────────────────────

/** Line fields that give away the book quantity or what stock is worth: a counter without `inventory:cost` counts blind. */
const COST_FIELDS = ["expectedQty", "varianceQty", "variancePct", "unitCost"] as const;

/** `line` as this caller may see it: without {@link COST_FIELDS} unless they hold `inventory:cost`. */
function forViewer<T extends object>(user: TokenPayload, line: T): T {
  if (hasPermission(user, "inventory:cost")) return line;
  const copy = { ...line } as Record<string, unknown>;
  for (const k of COST_FIELDS) delete copy[k];
  return copy as T;
}

function handleServiceError(err: unknown, res: Response, next: NextFunction): void {
  // `code` lets the phone's offline queue branch on the kind of refusal; `error` stays the sentence the web shows.
  if (err instanceof SheetIncompleteError) {
    res.status(409).json({ error: err.message, code: "SHEET_INCOMPLETE", missing: err.missing });
  } else if (err instanceof ConflictError) {
    res.status(409).json({ error: err.message, code: "CONFLICT" });
  } else if (err instanceof ForbiddenError) {
    res.status(403).json({ error: err.message, code: err.code ?? "FORBIDDEN" });
  } else if (err instanceof InvalidStateError) {
    res.status(400).json({ error: err.message, code: err.code ?? "INVALID_STATE" });
  } else if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message, code: "NOT_FOUND" });
  } else if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message, code: "VALIDATION" });
  } else {
    next(err);
  }
}

/** Resolve org + selected location from the user's context. */
async function resolveContext(req: Request, res: Response) {
  const ctx = await getUserLocationContext(req.user!.sub);
  if (ctx.locations.length === 0) {
    res.status(400).json({ error: "You are not a member of any organisation", code: "FORBIDDEN" });
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
      res.status(400).json({ error: "No location selected. Please select a location first.", code: "VALIDATION" });
      return;
    }

    const categories = Array.isArray(req.body?.categories) ? req.body.categories : undefined;
    const mode = req.body?.mode ?? "CATEGORY";
    if (mode !== "CATEGORY" && mode !== "AREA") {
      res.status(400).json({ error: 'mode must be "CATEGORY" or "AREA"', code: "VALIDATION" });
      return;
    }
    const session = await openSession(ctx.selectedLocationId, ctx.orgId, req.user!.sub, categories, mode);

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
      res.status(400).json({ error: "No location selected", code: "VALIDATION" });
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
    if (!session) { res.status(404).json({ error: "Session not found", code: "NOT_FOUND" }); return; }

    res.json({
      ...session,
      categories: session.categories.map((c) => ({ ...c, lines: c.lines.map((l) => forViewer(req.user!, l)) })),
    });
  } catch (err) {
    next(err);
  }
}

/** GET /stock-takes/:id/count-sheets: the items on each area's sheet, in shelf order (the phone's pre-count download). */
export async function handleGetCountSheets(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const areas = await getAreaCountSheets(req.params.id as string, ctx.orgId);
    res.json({ sessionId: req.params.id, areas });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

// ─── Category actions ─────────────────────────────────────────────

export async function handleClaimCategory(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const sessionId = req.params.id as string;
    const session = await getSessionDetail(sessionId, ctx.orgId);
    if (!session) { res.status(404).json({ error: "Session not found", code: "NOT_FOUND" }); return; }

    const cat = await claimCategory(sessionId, req.params.cat as string, req.user!.sub);

    logger.info(
      { sessionId, category: req.params.cat as string, userId: req.user!.sub },
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
      res.status(400).json({ error: "Validation failed", code: "VALIDATION", details: parsed.error.flatten() });
      return;
    }

    // Resolve category ID from session + category name
    const session = await getSessionDetail(req.params.id as string, ctx.orgId);
    if (!session) { res.status(404).json({ error: "Session not found", code: "NOT_FOUND" }); return; }

    const cat = session.categories.find((c) => c.categoryName === req.params.cat as string);
    if (!cat) { res.status(404).json({ error: `Category "${req.params.cat as string}" not found`, code: "NOT_FOUND" }); return; }

    if (cat.categoryStatus !== "IN_PROGRESS") {
      res.status(400).json({ error: `Cannot count: category is ${cat.categoryStatus}`, code: "STOCK_TAKE_AREA_CLOSED" });
      return;
    }

    assertCanCount(cat, req.user!.sub, {
      isManager: hasPermission(req.user!, "inventory:manage"),
      claimRevision: parsed.data.claimRevision,
    });

    const line = await saveLineItem(
      cat.categoryId,
      parsed.data.ingredientId,
      parsed.data.rawQty,
      parsed.data.countedUnit,
      req.user!.sub,
    );

    res.json(forViewer(req.user!, line));
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
    if (!session) { res.status(404).json({ error: "Session not found", code: "NOT_FOUND" }); return; }

    const cat = session.categories.find((c) => c.categoryName === req.params.cat as string);
    if (!cat) { res.status(404).json({ error: `Category "${req.params.cat as string}" not found`, code: "NOT_FOUND" }); return; }

    const lines = await getCategoryLines(cat.categoryId);
    res.json(lines.map((l) => forViewer(req.user!, l)));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleSubmitCategory(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const sessionId = req.params.id as string;
    const session = await getSessionDetail(sessionId, ctx.orgId);
    if (!session) { res.status(404).json({ error: "Session not found", code: "NOT_FOUND" }); return; }

    const parsed = SubmitCategorySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", code: "VALIDATION", details: parsed.error.flatten() });
      return;
    }

    const target = session.categories.find((c) => c.categoryName === req.params.cat as string);
    if (target) {
      assertCanCount(target, req.user!.sub, {
        isManager: hasPermission(req.user!, "inventory:manage"),
        claimRevision: parsed.data.claimRevision,
      });
    }

    const cat = await submitCategory(sessionId, req.params.cat as string);

    logger.info(
      { sessionId, category: req.params.cat as string, userId: req.user!.sub },
      "Category submitted",
    );
    res.json(cat);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

// ─── Submit for review ────────────────────────────────────────────

export async function handleSubmitForReview(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const session = await submitSessionForReview(req.params.id as string, ctx.orgId, {
      canFinishOpening: hasPermission(req.user!, "inventory:manage"),
    });
    logger.info(
      { sessionId: req.params.id as string, userId: req.user!.sub },
      "Stock take session submitted for review",
    );
    res.json(session);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

// ─── HQ review ────────────────────────────────────────────────────

export async function handleApproveSession(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const session = await approveSession(req.params.id as string, req.user!.sub, ctx.orgId);

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
      res.status(400).json({ error: "Validation failed", code: "VALIDATION", details: parsed.error.flatten() });
      return;
    }

    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const session = await flagSession(
      req.params.id as string,
      parsed.data.flaggedCategories,
      parsed.data.reason,
      ctx.orgId,
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

// ─── Pending reviews (cross-location) ────────────────────────────

export async function handleGetPendingReviews(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const sessions = await getPendingReviewSessions(ctx.orgId);
    res.json(sessions);
  } catch (err) {
    next(err);
  }
}

/** History: approved (closed) stock-take sessions. HQ-only, read-only. */
export async function handleGetHistory(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const sessions = await getApprovedSessions(ctx.orgId);
    res.json(sessions);
  } catch (err) {
    next(err);
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
      res.status(400).json({ error: "No location selected", code: "VALIDATION" });
      return;
    }

    const lines = await getPreviousCountLines(ctx.selectedLocationId, req.params.cat as string);
    res.json(lines.map((l) => forViewer(req.user!, l)));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

// ─── Org-wide dashboard ─────────────────────────────────────────

export async function handleGetOrgDashboard(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const summary = await getOrgDashboardSummary(ctx.orgId, { withValue: hasPermission(req.user!, "inventory:cost") });
    res.json(summary);
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

    const withValue = hasPermission(req.user!, "inventory:cost");
    const dashboard = await getLocationDashboard(req.params.locId as string, ctx.orgId, { withValue });
    // The book quantity is what a blind count is measured against: hidden with the value.
    res.json(withValue ? dashboard : { ...dashboard, stockLevels: dashboard.stockLevels.map(({ currentQty: _, ...rest }) => rest) });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

// ─── Opening inventory count ────────────────────────────────────

/** POST /locations/:locId/opening-count */
export async function handleOpenOpeningCount(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const result = await openOpeningCount(req.params.locId as string, ctx.orgId, req.user!.sub);

    logger.info(
      { locationId: req.params.locId, userId: req.user!.sub },
      "Opening count session created",
    );
    res.status(201).json(result);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

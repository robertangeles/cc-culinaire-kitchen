/**
 * @module controllers/wasteController
 *
 * Request handlers for the Waste Intelligence Lite module.
 * Validates input with Zod, delegates to wasteService.
 */

import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import {
  logWaste,
  getWasteLogs,
  deleteWasteLog,
  editWasteLog,
  getWasteSummary,
  getIngredientSuggestions,
  listIngredientsForWaste,
  generateReuseSuggestions,
} from "../services/wasteService.js";
import { getUserOrgContext } from "../services/orgContextService.js";
import { assertLocationAccess } from "../services/locationContextService.js";
import { hasPermission } from "../middleware/auth.js";
import { AppError } from "../utils/appError.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const logWasteSchema = z.object({
  wasteLogId: z.string().uuid().optional(),
  storeLocationId: z.string().uuid().optional(),
  ingredientName: z.string().min(1, "Ingredient name is required").max(200),
  quantity: z.number().positive("Quantity must be positive"),
  unit: z.string().min(1).max(20),
  estimatedCost: z.number().min(0).nullable().optional(),
  reason: z.string().max(30).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  shift: z.string().max(20).nullable().optional(),
  loggedAt: z.string().datetime().nullable().optional(),
});

const getLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  teamView: z.enum(["true", "false"]).optional(),
  storeLocationId: z.string().uuid().optional(),
});

const summaryQuerySchema = z.object({
  startDate: z.string().min(1, "startDate is required"),
  endDate: z.string().min(1, "endDate is required"),
  teamView: z.enum(["true", "false"]).optional(),
});

const editWasteSchema = z.object({
  ingredientName: z.string().min(1).max(200).optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().min(1).max(20).optional(),
  estimatedCost: z.number().min(0).nullable().optional(),
  reason: z.string().max(30).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  shift: z.string().max(20).nullable().optional(),
});

const suggestionsQuerySchema = z.object({
  q: z.string().min(1, "Search query is required").max(100),
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** POST /api/waste */
export async function handleLogWaste(req: Request, res: Response) {
  const userId = req.user!.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to log waste" });
    return;
  }

  const parsed = logWasteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  // A location sent by the client must be one the caller works at.
  if (parsed.data.storeLocationId) await assertLocationAccess(req.user!, parsed.data.storeLocationId);

  const { row, replay } = await logWaste(userId, parsed.data);
  res.status(replay ? 200 : 201).json(row);
}

/** GET /api/waste */
export async function handleGetWasteLogs(req: Request, res: Response) {
  const userId = req.user!.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to view waste logs" });
    return;
  }

  const parsed = getLogsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const { teamView, storeLocationId, ...rest } = parsed.data;
  // Org-wide entries (who logged what, at what cost) are a report: waste:log alone does not open them.
  if (teamView === "true" && !hasPermission(req.user!, "waste:read")) {
    throw new AppError(403, "FORBIDDEN", "Team waste needs the waste reports permission");
  }
  if (storeLocationId) await assertLocationAccess(req.user!, storeLocationId);
  const result = await getWasteLogs(userId, { ...rest, teamView: teamView === "true", storeLocationId });
  res.json(result);
}

/** DELETE /api/waste/:id */
export async function handleDeleteWasteLog(req: Request, res: Response) {
  const userId = req.user!.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }

  const wasteLogId = req.params.id as string;
  if (!wasteLogId) {
    res.status(400).json({ error: "Invalid waste log ID" });
    return;
  }

  const orgCtx = await getUserOrgContext(userId);
  await deleteWasteLog(wasteLogId, userId, orgCtx);
  res.json({ ok: true });
}

/** PATCH /api/waste/:id */
export async function handleEditWasteLog(req: Request, res: Response) {
  const userId = req.user!.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }

  const wasteLogId = req.params.id as string;
  if (!wasteLogId) {
    res.status(400).json({ error: "Invalid waste log ID" });
    return;
  }

  const parsed = editWasteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const orgCtx = await getUserOrgContext(userId);
  const updated = await editWasteLog(wasteLogId, userId, parsed.data, orgCtx);
  if (!updated) throw new AppError(404, "NOT_FOUND", "Waste log entry not found or not yours");
  res.json(updated);
}

/** GET /api/waste/summary */
export async function handleGetWasteSummary(req: Request, res: Response) {
  const userId = req.user!.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to view waste summary" });
    return;
  }

  const parsed = summaryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const summary = await getWasteSummary(userId, parsed.data.startDate, parsed.data.endDate, parsed.data.teamView === "true");
  res.json(summary);
}

/** GET /api/waste/suggestions */
export async function handleGetIngredientSuggestions(req: Request, res: Response) {
  const userId = req.user!.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }

  const parsed = suggestionsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const result = await getIngredientSuggestions(userId, parsed.data.q);
  res.json({ ingredients: result });
}

/** GET /api/waste/ingredients */
export async function handleListIngredientsForWaste(req: Request, res: Response) {
  res.json(await listIngredientsForWaste(req.user!.sub));
}

/** POST /api/waste/reuse */
export async function handleGenerateReuseSuggestions(req: Request, res: Response, next: NextFunction) {
  const userId = req.user!.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to get reuse suggestions", code: "UNAUTHENTICATED" });
    return;
  }

  try {
    const suggestions = await generateReuseSuggestions(userId);
    res.json({ suggestions });
  } catch (err) {
    next(err);
  }
}

/** GET /api/waste/org-context */
export async function handleGetOrgContext(req: Request, res: Response) {
  const userId = req.user!.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }

  const orgCtx = await getUserOrgContext(userId);
  res.json({
    hasOrg: orgCtx.orgIds.length > 0,
    orgName: orgCtx.primaryOrgName,
    isOrgAdmin: orgCtx.isOrgAdmin,
    memberCount: orgCtx.orgMemberUserIds.length,
  });
}

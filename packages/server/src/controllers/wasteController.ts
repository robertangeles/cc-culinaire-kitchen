/**
 * @module controllers/wasteController
 *
 * Request handlers for the Waste Intelligence Lite module.
 * Validates input with Zod, delegates to wasteService.
 */

import { z } from "zod";
import type { Request, Response } from "express";
import {
  logWaste,
  getWasteLogs,
  deleteWasteLog,
  getWasteSummary,
  getIngredientSuggestions,
  generateReuseSuggestions,
} from "../services/wasteService.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const logWasteSchema = z.object({
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
});

const summaryQuerySchema = z.object({
  startDate: z.string().min(1, "startDate is required"),
  endDate: z.string().min(1, "endDate is required"),
});

const suggestionsQuerySchema = z.object({
  q: z.string().min(1, "Search query is required").max(100),
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** POST /api/waste */
export async function handleLogWaste(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to log waste" });
    return;
  }

  const parsed = logWasteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const row = await logWaste(userId, parsed.data);
  res.status(201).json(row);
}

/** GET /api/waste */
export async function handleGetWasteLogs(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to view waste logs" });
    return;
  }

  const parsed = getLogsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const result = await getWasteLogs(userId, parsed.data);
  res.json(result);
}

/** DELETE /api/waste/:id */
export async function handleDeleteWasteLog(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }

  const wasteLogId = req.params.id as string;
  if (!wasteLogId) {
    res.status(400).json({ error: "Invalid waste log ID" });
    return;
  }

  const deleted = await deleteWasteLog(wasteLogId, userId);
  if (!deleted) {
    res.status(404).json({ error: "Waste log entry not found or not yours" });
    return;
  }
  res.json({ ok: true });
}

/** GET /api/waste/summary */
export async function handleGetWasteSummary(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to view waste summary" });
    return;
  }

  const parsed = summaryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const summary = await getWasteSummary(userId, parsed.data.startDate, parsed.data.endDate);
  res.json(summary);
}

/** GET /api/waste/suggestions */
export async function handleGetIngredientSuggestions(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }

  const parsed = suggestionsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const suggestions = await getIngredientSuggestions(userId, parsed.data.q);
  res.json(suggestions);
}

/** POST /api/waste/reuse */
export async function handleGenerateReuseSuggestions(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to get reuse suggestions" });
    return;
  }

  const suggestions = await generateReuseSuggestions(userId);
  res.json({ suggestions });
}

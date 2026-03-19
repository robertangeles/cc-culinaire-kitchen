/**
 * @module controllers/prepController
 *
 * Request handlers for the Kitchen Operations Copilot Lite module.
 * Validates input with Zod, delegates to prepService.
 */

import { z } from "zod";
import type { Request, Response } from "express";
import {
  createPrepSession,
  getTodaySession,
  getPrepSession,
  updateTaskStatus,
  getIngredientCrossUsage,
  getHighImpactDishes,
  getSessionHistory,
  endSession,
} from "../services/prepService.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const createSessionSchema = z.object({
  prepDate: z.string().min(1, "prepDate is required"),
  expectedCovers: z.number().int().positive().optional(),
});

const updateTaskSchema = z.object({
  status: z.enum(["pending", "in_progress", "completed", "skipped"]),
  assignedTo: z.string().max(100).optional(),
});

const endSessionSchema = z.object({
  actualCovers: z.number().int().positive().optional(),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** POST /api/prep/sessions */
export async function handleCreateSession(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to create a prep session" });
    return;
  }

  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const result = await createPrepSession(userId, parsed.data.prepDate, parsed.data.expectedCovers);
  res.status(201).json(result);
}

/** GET /api/prep/sessions/today */
export async function handleGetTodaySession(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to view today's session" });
    return;
  }

  const result = await getTodaySession(userId);
  res.json(result);
}

/** GET /api/prep/sessions/:id */
export async function handleGetSession(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to view prep sessions" });
    return;
  }

  const sessionId = req.params.id as string;
  if (!sessionId) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  const result = await getPrepSession(sessionId, userId);
  if (!result) {
    res.status(404).json({ error: "Prep session not found or not yours" });
    return;
  }
  res.json(result);
}

/** PATCH /api/prep/tasks/:id */
export async function handleUpdateTask(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to update tasks" });
    return;
  }

  const taskId = req.params.id as string;
  if (!taskId) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const updated = await updateTaskStatus(taskId, userId, parsed.data.status, parsed.data.assignedTo);
  if (!updated) {
    res.status(404).json({ error: "Task not found or not yours" });
    return;
  }
  res.json(updated);
}

/** GET /api/prep/cross-usage/:sessionId */
export async function handleGetCrossUsage(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to view cross-usage data" });
    return;
  }

  const sessionId = req.params.sessionId as string;
  if (!sessionId) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  const data = await getIngredientCrossUsage(sessionId);
  res.json(data);
}

/** GET /api/prep/high-impact */
export async function handleGetHighImpact(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to view high-impact dishes" });
    return;
  }

  const dishes = await getHighImpactDishes(userId);
  res.json(dishes);
}

/** GET /api/prep/history */
export async function handleGetHistory(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to view session history" });
    return;
  }

  const parsed = historyQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const sessions = await getSessionHistory(userId, parsed.data.limit);
  res.json(sessions);
}

/** PATCH /api/prep/sessions/:id/end */
export async function handleEndSession(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to end a session" });
    return;
  }

  const sessionId = req.params.id as string;
  if (!sessionId) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  const parsed = endSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const result = await endSession(sessionId, userId, parsed.data.actualCovers);
  if (!result) {
    res.status(404).json({ error: "Prep session not found or not yours" });
    return;
  }
  res.json(result);
}

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
  getMenuForSelection,
  saveMenuSelections,
  generateTasksFromSelections,
  getSelections,
  getPreviousSelections,
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
  teamView: z.enum(["true", "false"]).optional(),
});

const teamViewQuerySchema = z.object({
  teamView: z.enum(["true", "false"]).optional(),
});

const selectionItemSchema = z.object({
  recipeId: z.string().uuid().optional(),
  menuItemId: z.string().uuid().optional(),
  dishName: z.string().min(1, "dishName is required").max(200),
  expectedPortions: z.number().int().min(1, "expectedPortions must be at least 1"),
  category: z.string().max(50).optional(),
});

const saveSelectionsSchema = z.object({
  selections: z.array(selectionItemSchema).min(1, "At least one selection is required"),
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

  const parsed = teamViewQuerySchema.safeParse(req.query);
  const teamView = parsed.success && parsed.data.teamView === "true";

  const result = await getTodaySession(userId, teamView);
  if (!result) {
    res.status(404).json({ error: "No prep session for today" });
    return;
  }
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

  const parsed = teamViewQuerySchema.safeParse(req.query);
  const teamView = parsed.success && parsed.data.teamView === "true";

  const result = await getPrepSession(sessionId, userId, teamView);
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

  const parsed = teamViewQuerySchema.safeParse(req.query);
  const teamView = parsed.success && parsed.data.teamView === "true";

  const data = await getIngredientCrossUsage(sessionId, userId, teamView);
  res.json(data);
}

/** GET /api/prep/high-impact */
export async function handleGetHighImpact(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to view high-impact dishes" });
    return;
  }

  const parsed = teamViewQuerySchema.safeParse(req.query);
  const teamView = parsed.success && parsed.data.teamView === "true";

  const result = await getHighImpactDishes(userId, teamView);
  res.json(result);
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

  const sessions = await getSessionHistory(userId, parsed.data.limit, parsed.data.teamView === "true");
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

// ---------------------------------------------------------------------------
// New menu-driven handlers
// ---------------------------------------------------------------------------

/** GET /api/prep/menu — dishes available for selection */
export async function handleGetMenuForSelection(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to view the menu" });
    return;
  }

  const parsed = teamViewQuerySchema.safeParse(req.query);
  const teamView = parsed.success && parsed.data.teamView === "true";

  const data = await getMenuForSelection(userId, teamView);
  res.json(data);
}

/** POST /api/prep/sessions/:id/selections — save dish selections */
export async function handleSaveSelections(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to save selections" });
    return;
  }

  const sessionId = req.params.id as string;
  if (!sessionId) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  const parsed = saveSelectionsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  try {
    const selections = await saveMenuSelections(sessionId, userId, parsed.data.selections);
    res.status(201).json(selections);
  } catch (err: any) {
    if (err.message === "Prep session not found or not yours") {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
}

/** POST /api/prep/sessions/:id/generate — generate tasks from selections */
export async function handleGenerateFromSelections(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to generate prep tasks" });
    return;
  }

  const sessionId = req.params.id as string;
  if (!sessionId) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  try {
    const tasks = await generateTasksFromSelections(sessionId, userId);
    res.status(201).json(tasks);
  } catch (err: any) {
    if (err.message === "Prep session not found or not yours") {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
}

/** GET /api/prep/sessions/:id/selections — get selections for a session */
export async function handleGetSelections(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to view selections" });
    return;
  }

  const sessionId = req.params.id as string;
  if (!sessionId) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  const parsed = teamViewQuerySchema.safeParse(req.query);
  const teamView = parsed.success && parsed.data.teamView === "true";

  const selections = await getSelections(sessionId, userId, teamView);
  res.json(selections);
}

/** GET /api/prep/previous-selections — get most recent session's selections */
export async function handleGetPreviousSelections(req: Request, res: Response) {
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to view previous selections" });
    return;
  }

  const parsed = teamViewQuerySchema.safeParse(req.query);
  const teamView = parsed.success && parsed.data.teamView === "true";

  const selections = await getPreviousSelections(userId, teamView);
  res.json(selections);
}

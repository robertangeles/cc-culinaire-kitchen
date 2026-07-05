/**
 * @module brainController
 *
 * Express request handlers for the "Your Brain" API
 * (docs/specs/brain-memory.md, T8/T9). Thin per project rules: validate,
 * call {@link module:brainService}, return JSON. Errors forward to the
 * error-handling middleware.
 *
 * Every user-facing handler operates on `req.user.sub` only — a user can
 * never list or delete another user's memories.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { pino } from "pino";
import { listMemories, deleteMemory, getBrainStats } from "../services/brainService.js";

const log = pino({ transport: { target: "pino-pretty" } });

/** Zod schema for the list query params. */
const ListQuerySchema = z.object({
  sourceType: z.enum(["chat", "recipe", "purchase_order", "waste", "stock", "menu", "prep"]).optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * **GET /memories** — List the authenticated user's memories, newest first.
 *
 * Query: `?sourceType=&search=&limit=&offset=`
 * @returns 200 `{ memories, total }`
 */
export async function handleListMemories(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = ListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const result = await listMemories(req.user!.sub, parsed.data);
    res.json(result);
  } catch (err) {
    log.error(err, "Failed to list brain memories");
    next(err);
  }
}

/**
 * **DELETE /memories/:id** — Delete one of the user's own memories.
 *
 * @returns 200 `{ success: true }` when deleted.
 * @returns 404 when the id doesn't exist or belongs to another user
 *          (identical responses — no cross-tenant oracle).
 */
export async function handleDeleteMemory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const idParsed = z.string().uuid().safeParse(req.params.id);
    if (!idParsed.success) {
      res.status(400).json({ error: "Invalid memory id." });
      return;
    }

    const deleted = await deleteMemory(req.user!.sub, idParsed.data);
    if (!deleted) {
      res.status(404).json({ error: "Memory not found." });
      return;
    }

    // Ids only — memory content is never logged.
    log.info({ memoryId: idParsed.data, userId: req.user!.sub }, "Brain memory deleted");
    res.json({ success: true });
  } catch (err) {
    log.error(err, "Failed to delete brain memory");
    next(err);
  }
}

/**
 * **GET /stats** — Admin-only Brain health snapshot (spec T9): flags, queue
 * depth by status, memories/day volumes, in-process capture counters.
 */
export async function handleBrainStats(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const stats = await getBrainStats();
    res.json(stats);
  } catch (err) {
    log.error(err, "Failed to load brain stats");
    next(err);
  }
}

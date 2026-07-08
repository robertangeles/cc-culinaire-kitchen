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
import {
  listMemories,
  deleteMemory,
  pinMemory,
  correctMemory,
  toggleScope,
  getBrainStats,
} from "../services/brainService.js";

const log = pino({ transport: { target: "pino-pretty" } });

/** Zod schema for the list query params. */
const ListQuerySchema = z.object({
  sourceType: z.enum(["chat", "recipe", "purchase_order", "waste", "stock", "menu", "prep"]).optional(),
  scope: z.enum(["user", "org"]).optional(),
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
 * **PATCH /memories/:id/pin** — Pin or unpin a memory (spec T14b). Pinned rows
 * sort first in "Your Brain".
 *
 * @returns 200 `{ success: true }`; 404 when the id doesn't exist or the caller
 *          isn't authorised (identical — no cross-tenant oracle).
 */
export async function handlePinMemory(
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
    const bodyParsed = z.object({ pinned: z.boolean() }).safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: "Invalid request." });
      return;
    }

    const ok = await pinMemory(req.user!.sub, idParsed.data, bodyParsed.data.pinned);
    if (!ok) {
      res.status(404).json({ error: "Memory not found." });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    log.error(err, "Failed to pin brain memory");
    next(err);
  }
}

/**
 * **PATCH /memories/:id** — Correct a memory's text (spec T14b). The body is
 * re-sanitised and the memory re-enters the embed queue.
 *
 * @returns 200 `{ success: true }`; 404 when missing / unauthorised / empty body.
 */
export async function handleCorrectMemory(
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
    const bodyParsed = z.object({ body: z.string().min(1).max(8000) }).safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: "Invalid request." });
      return;
    }

    const ok = await correctMemory(req.user!.sub, idParsed.data, bodyParsed.data.body);
    if (!ok) {
      res.status(404).json({ error: "Memory not found." });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    log.error(err, "Failed to correct brain memory");
    next(err);
  }
}

/**
 * **PATCH /memories/:id/scope** — Share (user→org) or un-share (org→user) a
 * memory (spec T14b). Sharing promotes to the caller's active org; un-sharing
 * requires org-admin of the owning org.
 *
 * @returns 200 `{ success: true }`; 404 when missing / unauthorised / no org to
 *          share into.
 */
export async function handleToggleScope(
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
    const bodyParsed = z.object({ scope: z.enum(["user", "org"]) }).safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: "Invalid request." });
      return;
    }

    const ok = await toggleScope(req.user!.sub, idParsed.data, bodyParsed.data.scope);
    if (!ok) {
      res.status(404).json({ error: "Couldn't change sharing." });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    log.error(err, "Failed to toggle brain memory scope");
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

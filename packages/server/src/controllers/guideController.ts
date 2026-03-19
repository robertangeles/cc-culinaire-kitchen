/**
 * @module guideController
 *
 * Request handlers for the User Guide API.
 *
 * - GET  /api/guides/:key — public read (any authenticated user)
 * - GET  /api/guides       — admin listing of all guides
 * - PUT  /api/guides/:key — admin upsert (create or update)
 */

import type { Request, Response, NextFunction } from "express";
import { getGuide, getAllGuides, upsertGuide } from "../services/guideService.js";

/**
 * Return a single guide by its key.
 * Any authenticated user may read guides.
 */
export async function handleGetGuide(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const key = req.params.key as string;
    if (!key || key.length > 50) {
      res.status(400).json({ error: "Invalid guide key" });
      return;
    }

    const result = await getGuide(key);
    if (!result) {
      res.status(404).json({ error: "Guide not found" });
      return;
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Return all guides (admin listing).
 */
export async function handleGetAllGuides(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const guides = await getAllGuides();
    res.json(guides);
  } catch (err) {
    next(err);
  }
}

/**
 * Create or update a guide by key.
 * Admin only. Expects body: `{ title: string, content: string }`.
 */
export async function handleUpsertGuide(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const key = req.params.key as string;
    if (!key || key.length > 50) {
      res.status(400).json({ error: "Invalid guide key" });
      return;
    }

    const { title, content } = req.body as { title?: string; content?: string };
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      res.status(400).json({ error: "Title is required" });
      return;
    }
    if (title.length > 200) {
      res.status(400).json({ error: "Title must be 200 characters or fewer" });
      return;
    }
    if (content === undefined || content === null || typeof content !== "string") {
      res.status(400).json({ error: "Content is required" });
      return;
    }

    const userId = (req as unknown as { user: { sub: number } }).user.sub;
    await upsertGuide(key, title.trim(), content, userId);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

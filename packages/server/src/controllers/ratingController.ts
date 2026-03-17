/**
 * @module controllers/ratingController
 *
 * Request handlers for recipe star ratings and text reviews.
 */

import { z } from "zod";
import type { Request, Response } from "express";
import {
  getRatingsSummary,
  upsertRating,
  submitReview,
  deleteReview,
} from "../services/ratingService.js";
import { db } from "../db/index.js";
import { user as userTable } from "../db/schema.js";
import { eq } from "drizzle-orm";

const ratingSchema = z.object({
  rating: z.number().int().min(1).max(5),
});

const reviewSchema = z.object({
  title: z.string().max(200).nullable().optional(),
  body: z.string().min(10, "Review must be at least 10 characters").max(5000),
  rating: z.number().int().min(1).max(5),
});

/** GET /api/recipes/:id/ratings */
export async function handleGetRatings(req: Request, res: Response) {
  const recipeId = req.params.id as string;
  const currentUserId = (req as any).user?.sub;
  const summary = await getRatingsSummary(recipeId, currentUserId);
  res.json(summary);
}

/** POST /api/recipes/:id/ratings */
export async function handleSubmitRating(req: Request, res: Response) {
  const recipeId = req.params.id as string;
  const userId = (req as any).user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Sign in to rate recipes" });
    return;
  }

  const parsed = ratingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  await upsertRating(recipeId, userId, parsed.data.rating);
  res.json({ ok: true });
}

/** POST /api/recipes/:id/reviews */
export async function handleSubmitReview(req: Request, res: Response) {
  const recipeId = req.params.id as string;
  const user = (req as any).user;
  if (!user?.sub) {
    res.status(401).json({ error: "Sign in to write reviews" });
    return;
  }

  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  // Look up userName from database (JWT only has sub/roles/permissions)
  const [dbUser] = await db
    .select({ userName: userTable.userName })
    .from(userTable)
    .where(eq(userTable.userId, user.sub))
    .limit(1);

  const reviewId = await submitReview(
    recipeId,
    user.sub,
    dbUser?.userName ?? "Anonymous",
    parsed.data.title ?? null,
    parsed.data.body,
    parsed.data.rating,
  );
  res.json({ reviewId });
}

/** DELETE /api/recipes/:id/reviews/:reviewId */
export async function handleDeleteReview(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user?.sub) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }

  const reviewId = parseInt(req.params.reviewId as string, 10);
  if (isNaN(reviewId)) {
    res.status(400).json({ error: "Invalid review ID" });
    return;
  }

  // Admins can delete any review; regular users can only delete their own
  const isAdmin = user.roles?.includes("Administrator");
  const deleted = await deleteReview(reviewId, isAdmin ? undefined : user.sub);
  if (!deleted) {
    res.status(404).json({ error: "Review not found or not yours" });
    return;
  }
  res.json({ ok: true });
}

/**
 * @module services/ratingService
 *
 * CRUD operations for recipe star ratings and text reviews.
 */

import pino from "pino";
import { db } from "../db/index.js";
import { recipeRating, recipeReview } from "../db/schema.js";
import { eq, and, sql, desc } from "drizzle-orm";

const logger = pino({ name: "ratingService" });

export interface RatingsSummary {
  average: number;
  count: number;
  distribution: Record<number, number>;
  userRating: number | null;
  reviews: {
    reviewId: number;
    userId: number;
    userName: string;
    reviewTitle: string | null;
    reviewBody: string;
    rating: number;
    createdDttm: Date;
  }[];
}

/**
 * Get ratings summary and reviews for a recipe.
 */
export async function getRatingsSummary(
  recipeId: string,
  currentUserId?: number,
): Promise<RatingsSummary> {
  // All ratings
  const ratings = await db
    .select({ rating: recipeRating.rating })
    .from(recipeRating)
    .where(eq(recipeRating.recipeId, recipeId));

  const count = ratings.length;
  const average = count > 0
    ? Math.round((ratings.reduce((sum, r) => sum + r.rating, 0) / count) * 10) / 10
    : 0;

  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of ratings) distribution[r.rating] = (distribution[r.rating] ?? 0) + 1;

  // Current user's rating
  let userRating: number | null = null;
  if (currentUserId) {
    const [ur] = await db
      .select({ rating: recipeRating.rating })
      .from(recipeRating)
      .where(and(eq(recipeRating.recipeId, recipeId), eq(recipeRating.userId, currentUserId)))
      .limit(1);
    userRating = ur?.rating ?? null;
  }

  // Reviews
  const reviews = await db
    .select()
    .from(recipeReview)
    .where(eq(recipeReview.recipeId, recipeId))
    .orderBy(desc(recipeReview.createdDttm))
    .limit(50);

  return {
    average,
    count,
    distribution,
    userRating,
    reviews: reviews.map((r) => ({
      reviewId: r.reviewId,
      userId: r.userId,
      userName: r.userName,
      reviewTitle: r.reviewTitle,
      reviewBody: r.reviewBody,
      rating: r.rating,
      createdDttm: r.createdDttm,
    })),
  };
}

/**
 * Submit or update a star rating (one per user per recipe).
 */
export async function upsertRating(
  recipeId: string,
  userId: number,
  rating: number,
): Promise<void> {
  // Atomic upsert — INSERT or UPDATE on unique(recipe_id, user_id)
  await db.execute(sql`
    INSERT INTO recipe_rating (recipe_id, user_id, rating)
    VALUES (${recipeId}, ${userId}, ${rating})
    ON CONFLICT (recipe_id, user_id) DO UPDATE
    SET rating = ${rating}, updated_dttm = NOW()
  `);

  logger.info({ recipeId, userId, rating }, "Rating upserted");
}

/**
 * Submit a review (also upserts the star rating).
 */
export async function submitReview(
  recipeId: string,
  userId: number,
  userName: string,
  title: string | null,
  body: string,
  rating: number,
): Promise<number> {
  // Upsert the star rating
  await upsertRating(recipeId, userId, rating);

  // Insert review
  const [review] = await db
    .insert(recipeReview)
    .values({
      recipeId,
      userId,
      userName,
      reviewTitle: title,
      reviewBody: body,
      rating,
    })
    .returning({ reviewId: recipeReview.reviewId });

  logger.info({ recipeId, userId, reviewId: review.reviewId }, "Review submitted");
  return review.reviewId;
}

/**
 * Delete a review. If userId is provided, only deletes if the review belongs
 * to that user. If userId is omitted (admin), deletes any review.
 */
export async function deleteReview(
  reviewId: number,
  userId?: number,
): Promise<boolean> {
  const conditions = [eq(recipeReview.reviewId, reviewId)];
  if (userId !== undefined) {
    conditions.push(eq(recipeReview.userId, userId));
  }

  const result = await db
    .delete(recipeReview)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .returning({ reviewId: recipeReview.reviewId });

  return result.length > 0;
}

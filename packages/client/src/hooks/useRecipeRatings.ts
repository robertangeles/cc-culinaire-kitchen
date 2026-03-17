/**
 * @module hooks/useRecipeRatings
 *
 * Fetch and mutate recipe star ratings and text reviews.
 */

import { useState, useEffect, useCallback } from "react";

export interface ReviewItem {
  reviewId: number;
  userId: number;
  userName: string;
  reviewTitle: string | null;
  reviewBody: string;
  rating: number;
  createdDttm: string;
}

export interface RatingsSummary {
  average: number;
  count: number;
  distribution: Record<number, number>;
  userRating: number | null;
  reviews: ReviewItem[];
}

const API = import.meta.env.VITE_API_URL ?? "";

export function useRecipeRatings(recipeId: string | undefined) {
  const [data, setData] = useState<RatingsSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchRatings = useCallback(async () => {
    if (!recipeId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/recipes/${recipeId}/ratings`, {
        credentials: "include",
      });
      if (res.ok) {
        setData(await res.json());
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [recipeId]);

  useEffect(() => {
    fetchRatings();
  }, [fetchRatings]);

  const submitRating = useCallback(
    async (rating: number) => {
      if (!recipeId) return;
      const res = await fetch(`${API}/api/recipes/${recipeId}/ratings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rating }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to submit rating");
      }
      await fetchRatings();
    },
    [recipeId, fetchRatings],
  );

  const submitReview = useCallback(
    async (body: string, rating: number, title?: string) => {
      if (!recipeId) return;
      const res = await fetch(`${API}/api/recipes/${recipeId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ body, rating, title: title || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to submit review");
      }
      await fetchRatings();
    },
    [recipeId, fetchRatings],
  );

  const deleteReview = useCallback(
    async (reviewId: number) => {
      if (!recipeId) return;
      const res = await fetch(
        `${API}/api/recipes/${recipeId}/reviews/${reviewId}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete review");
      }
      await fetchRatings();
    },
    [recipeId, fetchRatings],
  );

  return {
    data,
    loading,
    refresh: fetchRatings,
    submitRating,
    submitReview,
    deleteReview,
  };
}

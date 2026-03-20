/**
 * @module hooks/useMyRecipes
 *
 * React hook for fetching the authenticated user's saved recipes
 * with "Load More" pagination, domain filtering, and visibility filtering.
 */

import { useState, useEffect, useCallback, useRef } from "react";

export interface MyRecipe {
  recipeId: string;
  slug: string | null;
  title: string;
  description: string | null;
  domain: string;
  imageUrl: string | null;
  isPublicInd: boolean;
  viewCount: number;
  createdDttm: string;
  averageRating: number;
  ratingCount: number;
}

const API = import.meta.env.VITE_API_URL ?? "";

export function useMyRecipes(filters?: {
  domain?: string;
  visibility?: "all" | "public" | "private";
  limit?: number;
}) {
  const [recipes, setRecipes] = useState<MyRecipe[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  /** Track the current filter fingerprint to detect resets. */
  const filterKey = `${filters?.domain ?? ""}|${filters?.visibility ?? "all"}|${filters?.limit ?? 20}`;
  const prevFilterKey = useRef(filterKey);

  const fetchPage = useCallback(
    async (targetPage: number, append: boolean) => {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }
      try {
        const limit = filters?.limit ?? 20;
        const params = new URLSearchParams({
          page: String(targetPage),
          limit: String(limit),
        });
        if (filters?.domain) params.set("domain", filters.domain);
        const res = await fetch(`${API}/api/recipes/my?${params}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to fetch recipes");
        const data = await res.json();

        let filtered = data.recipes as MyRecipe[];
        // Client-side visibility filter (backend returns all user recipes)
        if (filters?.visibility === "public") {
          filtered = filtered.filter((r) => r.isPublicInd);
        } else if (filters?.visibility === "private") {
          filtered = filtered.filter((r) => !r.isPublicInd);
        }

        if (append) {
          setRecipes((prev) => [...prev, ...filtered]);
        } else {
          setRecipes(filtered);
        }
        setTotal(data.total);
        setPage(data.page);
      } catch {
        if (!append) setRecipes([]);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [filters?.domain, filters?.visibility, filters?.limit],
  );

  // Reset when filters change
  useEffect(() => {
    if (prevFilterKey.current !== filterKey) {
      prevFilterKey.current = filterKey;
      setPage(1);
      setRecipes([]);
    }
    fetchPage(1, false);
  }, [filterKey, fetchPage]);

  /** Load the next page and append results. */
  const loadMore = useCallback(() => {
    const nextPage = page + 1;
    fetchPage(nextPage, true);
  }, [page, fetchPage]);

  /** Full refresh (reset to page 1). */
  const refresh = useCallback(() => {
    setPage(1);
    setRecipes([]);
    fetchPage(1, false);
  }, [fetchPage]);

  const toggleVisibility = useCallback(
    async (recipeId: string, isPublic: boolean) => {
      const res = await fetch(`${API}/api/recipes/${recipeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isPublicInd: isPublic }),
      });
      if (!res.ok) throw new Error("Failed to update visibility");
      // Optimistically update local state
      setRecipes((prev) =>
        prev.map((r) =>
          r.recipeId === recipeId ? { ...r, isPublicInd: isPublic } : r,
        ),
      );
    },
    [],
  );

  const archiveRecipe = useCallback(
    async (recipeId: string) => {
      const res = await fetch(`${API}/api/recipes/${recipeId}/archive`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to archive recipe");
      // Remove from local state
      setRecipes((prev) => prev.filter((r) => r.recipeId !== recipeId));
      setTotal((t) => t - 1);
    },
    [],
  );

  return {
    recipes,
    total,
    isLoading,
    isLoadingMore,
    loadMore,
    refresh,
    toggleVisibility,
    archiveRecipe,
  };
}

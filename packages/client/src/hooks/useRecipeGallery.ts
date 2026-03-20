/**
 * @module hooks/useRecipeGallery
 *
 * React hook for fetching public gallery recipes with "Load More" pagination
 * and filtering. Results are appended as the user loads more pages.
 */

import { useState, useEffect, useCallback, useRef } from "react";

export interface GalleryRecipe {
  recipeId: string;
  slug: string | null;
  title: string;
  description: string | null;
  domain: string;
  imageUrl: string | null;
  viewCount: number;
  recipeData: Record<string, unknown>;
  createdDttm: string;
  averageRating: number;
  ratingCount: number;
  isPublicInd?: boolean;
}

export function useRecipeGallery(filters?: {
  domain?: string;
  search?: string;
  limit?: number;
}) {
  const [recipes, setRecipes] = useState<GalleryRecipe[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  /** Track the current filter fingerprint to detect resets. */
  const filterKey = `${filters?.domain ?? ""}|${filters?.search ?? ""}|${filters?.limit ?? 20}`;
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
        if (filters?.search) params.set("search", filters.search);
        const res = await fetch(`/api/recipes/gallery?${params}`);
        if (!res.ok) throw new Error("Failed to fetch gallery");
        const data = await res.json();
        if (append) {
          setRecipes((prev) => [...prev, ...data.recipes]);
        } else {
          setRecipes(data.recipes);
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
    [filters?.domain, filters?.search, filters?.limit],
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

  return { recipes, total, isLoading, isLoadingMore, loadMore, refresh };
}

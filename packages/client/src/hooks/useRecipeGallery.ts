/**
 * @module hooks/useRecipeGallery
 *
 * React hook for fetching public gallery recipes with pagination and filtering.
 */

import { useState, useEffect, useCallback } from "react";

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
}

export function useRecipeGallery(filters?: { domain?: string; search?: string }) {
  const [recipes, setRecipes] = useState<GalleryRecipe[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const fetchRecipes = useCallback(async (p = page) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (filters?.domain) params.set("domain", filters.domain);
      if (filters?.search) params.set("search", filters.search);
      const res = await fetch(`/api/recipes/gallery?${params}`);
      if (!res.ok) throw new Error("Failed to fetch gallery");
      const data = await res.json();
      setRecipes(data.recipes);
      setTotal(data.total);
      setPage(data.page);
    } catch {
      setRecipes([]);
    } finally {
      setIsLoading(false);
    }
  }, [page, filters?.domain, filters?.search]);

  useEffect(() => {
    fetchRecipes();
  }, [fetchRecipes]);

  return { recipes, total, page, setPage, isLoading, refresh: fetchRecipes };
}

/**
 * @module hooks/useMyRecipes
 *
 * React hook for fetching the authenticated user's saved recipes
 * with pagination, domain filtering, and visibility filtering.
 */

import { useState, useEffect, useCallback } from "react";

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
}) {
  const [recipes, setRecipes] = useState<MyRecipe[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const fetchRecipes = useCallback(
    async (p = page) => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({ page: String(p) });
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

        setRecipes(filtered);
        setTotal(data.total);
        setPage(data.page);
      } catch {
        setRecipes([]);
      } finally {
        setIsLoading(false);
      }
    },
    [page, filters?.domain, filters?.visibility],
  );

  useEffect(() => {
    fetchRecipes();
  }, [fetchRecipes]);

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
    page,
    setPage,
    isLoading,
    refresh: fetchRecipes,
    toggleVisibility,
    archiveRecipe,
  };
}

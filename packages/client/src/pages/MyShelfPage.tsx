/**
 * @module MyShelfPage
 *
 * Personal recipe shelf — shows all recipes saved by the authenticated user.
 * Recipes are private by default; users can toggle visibility to share
 * on The Kitchen Shelf (public gallery). Uses "Load More" pagination
 * with page size driven by the `recipes_per_page` site setting.
 */

import { useState, useEffect, useRef } from "react";
import { BookMarked, Loader2, Search } from "lucide-react";
import { useMyRecipes } from "../hooks/useMyRecipes.js";
import { RecipeGalleryCard } from "../components/recipes/RecipeGalleryCard.js";
import { useSettings } from "../context/SettingsContext.js";
import type { GalleryRecipe } from "../hooks/useRecipeGallery.js";

const DOMAIN_TABS = [
  { value: "", label: "All" },
  { value: "recipe", label: "Culinary" },
  { value: "patisserie", label: "Patisserie" },
  { value: "spirits", label: "Spirits" },
];

export function MyShelfPage() {
  const { settings } = useSettings();
  const pageSize = Number(settings.recipes_per_page) || 20;

  const [domainFilter, setDomainFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  const {
    recipes,
    total,
    isLoading,
    isLoadingMore,
    loadMore,
    toggleVisibility,
    archiveRecipe,
  } = useMyRecipes({
    domain: domainFilter || undefined,
    limit: pageSize,
  });

  // Client-side search filter (applied on top of paginated results)
  const filteredRecipes = debouncedSearch.trim()
    ? recipes.filter((r) => {
        const q = debouncedSearch.toLowerCase();
        return (
          r.title.toLowerCase().includes(q) ||
          (r.description?.toLowerCase().includes(q))
        );
      })
    : recipes;

  // Convert MyRecipe to GalleryRecipe shape for the shared card component
  function toGalleryRecipe(r: typeof recipes[number]): GalleryRecipe {
    return {
      recipeId: r.recipeId,
      slug: r.slug,
      title: r.title,
      description: r.description,
      domain: r.domain,
      imageUrl: r.imageUrl,
      viewCount: r.viewCount,
      recipeData: {},
      createdDttm: r.createdDttm,
      averageRating: r.averageRating,
      ratingCount: r.ratingCount,
      isPublicInd: r.isPublicInd,
    };
  }

  async function handleToggleVisibility(recipeId: string, isPublic: boolean) {
    try {
      await toggleVisibility(recipeId, isPublic);
    } catch {
      // silent — optimistic update already applied
    }
  }

  async function handleArchive(recipeId: string) {
    try {
      await archiveRecipe(recipeId);
    } catch {
      // silent
    }
  }

  const hasMore = recipes.length < total;

  return (
    <div className="flex-1 overflow-y-auto bg-[#0A0A0A]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <BookMarked className="size-7 text-[#D4A574]" />
            <h1 className="text-2xl font-bold text-[#FAFAFA]">My Shelf</h1>
          </div>
          <p className="text-sm text-[#999999]">
            All your recipes in one place. Use the globe icon to share a recipe on The Kitchen Shelf.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6">
          {/* Domain filter */}
          <div className="flex gap-1 bg-[#161616] rounded-lg p-1 border border-[#2A2A2A]">
            {DOMAIN_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setDomainFilter(tab.value)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  domainFilter === tab.value
                    ? "bg-[#D4A574] text-[#0A0A0A]"
                    : "text-[#999999] hover:text-[#E5E5E5]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#666666]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search your recipes..."
              className="pl-9 pr-3 py-1.5 text-sm rounded-xl border border-[#2A2A2A] bg-[#0A0A0A] text-white placeholder-[#444444] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574]/50 w-48 sm:w-56"
            />
          </div>
        </div>

        {/* Recipe count */}
        <div className="mb-4">
          <span className="text-xs text-[#666666]">
            {filteredRecipes.length} {filteredRecipes.length === 1 ? "recipe" : "recipes"}
            {debouncedSearch && ` matching "${debouncedSearch}"`}
          </span>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 animate-spin text-[#D4A574]" />
          </div>
        ) : filteredRecipes.length === 0 ? (
          <div className="text-center py-20">
            <BookMarked className="size-12 text-[#666666] mx-auto mb-4" />
            <h3 className="text-lg font-medium text-[#999999] mb-2">
              {debouncedSearch ? "No matching recipes" : "No recipes yet"}
            </h3>
            <p className="text-sm text-[#666666] max-w-sm mx-auto">
              {debouncedSearch
                ? "Try a different search term."
                : "Head to a Recipe Lab to create your first recipe. Every recipe you generate is automatically saved here."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredRecipes.map((recipe) => (
              <div key={recipe.recipeId} className="animate-fade-in">
                <RecipeGalleryCard
                  recipe={toGalleryRecipe(recipe)}
                  isOwner
                  onToggleVisibility={handleToggleVisibility}
                  onArchive={handleArchive}
                />
              </div>
            ))}
          </div>
        )}

        {/* Load More */}
        {!isLoading && hasMore && !debouncedSearch && (
          <div className="mt-6">
            <button
              onClick={loadMore}
              disabled={isLoadingMore}
              className="w-full py-3 bg-[#1E1E1E] hover:bg-[#2A2A2A] text-[#E5E5E5] rounded-xl transition-colors text-sm font-medium disabled:opacity-50"
            >
              {isLoadingMore ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Loading...
                </span>
              ) : (
                "Load More"
              )}
            </button>
          </div>
        )}

        {/* Showing X of Y */}
        {!isLoading && recipes.length > 0 && (
          <p className="text-center text-sm text-[#666666] mt-3">
            Showing {recipes.length} of {total} recipes
          </p>
        )}
      </div>
    </div>
  );
}

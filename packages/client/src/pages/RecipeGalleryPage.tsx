/**
 * @module RecipeGalleryPage
 *
 * Public gallery page showing recipes in a masonry-style grid.
 * No authentication required to view.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, ChefHat, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useRecipeGallery } from "../hooks/useRecipeGallery.js";
import { RecipeGalleryCard } from "../components/recipes/RecipeGalleryCard.js";

const DOMAIN_FILTERS = [
  { value: "", label: "All Recipes" },
  { value: "recipe", label: "Culinary" },
  { value: "patisserie", label: "Patisserie" },
  { value: "spirits", label: "Spirits" },
];

export function RecipeGalleryPage() {
  const [domainFilter, setDomainFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput);
      setPage(1);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput]);

  const { recipes, total, page, setPage, isLoading, refresh } = useRecipeGallery({
    domain: domainFilter || undefined,
    search: searchQuery || undefined,
  });

  const handleArchive = useCallback(async (recipeId: string) => {
    try {
      await fetch(`/api/recipes/${recipeId}/archive`, {
        method: "POST",
        credentials: "include",
      });
      refresh();
    } catch { /* silent */ }
  }, [refresh]);

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <ChefHat className="size-10 mx-auto mb-3 text-amber-600" />
          <h1 className="text-2xl md:text-3xl font-bold text-stone-800">The Kitchen Shelf</h1>
          <p className="text-stone-500 mt-2">AI Recipes for Inspiration. Season to your own Judgment.</p>
          <p className="text-xs text-stone-400 max-w-2xl mx-auto mt-3 leading-relaxed">
            All recipes are AI-generated and should be reviewed by a qualified professional before use.
            CulinAIre Kitchen does not guarantee outcomes, nutritional accuracy, or allergen completeness.
            Always verify ingredient safety, cooking temperatures, and dietary suitability.
          </p>
        </div>

        {/* Filters */}
        <div className="flex justify-center gap-2 mb-8">
          {DOMAIN_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => { setDomainFilter(f.value); setPage(1); }}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                domainFilter === f.value
                  ? "bg-amber-600 text-white"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Search bar */}
        <div className="max-w-md mx-auto mb-8">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 size-4 text-stone-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search recipes by name, ingredient, cuisine..."
              className="w-full pl-10 pr-4 py-2.5 border border-stone-300 rounded-full text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-white"
            />
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center py-20">
            <Loader2 className="size-8 animate-spin text-amber-600" />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && recipes.length === 0 && (
          <div className="text-center py-20">
            <ChefHat className="size-12 mx-auto text-stone-300 mb-3" />
            <p className="text-stone-500 font-medium">No recipes in the gallery yet</p>
            <p className="text-sm text-stone-400 mt-1">Generate a recipe and make it public to see it here.</p>
          </div>
        )}

        {/* Masonry grid */}
        {!isLoading && recipes.length > 0 && (
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
            {recipes.map((recipe) => (
              <div key={recipe.recipeId} className="break-inside-avoid">
                <RecipeGalleryCard recipe={recipe} onArchive={handleArchive} />
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-8">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              className="flex items-center gap-1 px-4 py-2 text-sm text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="size-4" /> Previous
            </button>
            <span className="text-sm text-stone-500">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="flex items-center gap-1 px-4 py-2 text-sm text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200 disabled:opacity-30 transition-colors"
            >
              Next <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

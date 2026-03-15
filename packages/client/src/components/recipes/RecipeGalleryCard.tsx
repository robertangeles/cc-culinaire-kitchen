/**
 * Compact recipe card for the masonry gallery grid.
 * Shows hero image, title, domain badge, difficulty, and cook time.
 */

import { Link } from "react-router";
import { Clock, Eye, ChefHat, Croissant, GlassWater, Archive } from "lucide-react";
import type { GalleryRecipe } from "../../hooks/useRecipeGallery";
import { useAuth } from "../../context/AuthContext.js";

const DOMAIN_ICONS: Record<string, typeof ChefHat> = {
  recipe: ChefHat,
  patisserie: Croissant,
  spirits: GlassWater,
};

const DOMAIN_COLORS: Record<string, string> = {
  recipe: "bg-amber-100 text-amber-700",
  patisserie: "bg-pink-100 text-pink-700",
  spirits: "bg-amber-200 text-amber-900",
};

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "text-green-600",
  intermediate: "text-amber-600",
  advanced: "text-orange-600",
  expert: "text-red-600",
};

export function RecipeGalleryCard({ recipe, onArchive }: { recipe: GalleryRecipe; onArchive?: (id: string) => void }) {
  const { user } = useAuth();
  const data = recipe.recipeData as Record<string, unknown>;
  const difficulty = (data.difficulty as string) ?? "";
  const cookTime = (data.cookTime as string) ?? "";
  const DomainIcon = DOMAIN_ICONS[recipe.domain] ?? ChefHat;

  return (
    <Link
      to={`/kitchen-shelf/${recipe.slug ?? recipe.recipeId}`}
      className="group block bg-white rounded-xl shadow-sm border border-stone-200 overflow-hidden hover:shadow-md transition-shadow"
    >
      {/* Image */}
      <div className="aspect-[4/3] bg-stone-100 overflow-hidden">
        {recipe.imageUrl ? (
          <img
            src={recipe.imageUrl}
            alt={recipe.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-stone-100 to-stone-200">
            <DomainIcon className="size-12 text-stone-300" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${DOMAIN_COLORS[recipe.domain] ?? "bg-stone-100 text-stone-600"}`}>
            <DomainIcon className="size-3" />
            {recipe.domain}
          </span>
          {difficulty && (
            <span className={`text-xs font-medium capitalize ${DIFFICULTY_COLORS[difficulty] ?? "text-stone-500"}`}>
              {difficulty}
            </span>
          )}
        </div>

        <h3 className="font-semibold text-stone-800 text-sm leading-tight mb-1 line-clamp-2 group-hover:text-amber-700 transition-colors">
          {recipe.title}
        </h3>

        {recipe.description && (
          <p className="text-xs text-stone-500 line-clamp-2 mb-3">{recipe.description}</p>
        )}

        <div className="flex items-center justify-between text-xs text-stone-400">
          <div className="flex items-center gap-3">
            {cookTime && (
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {cookTime}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Eye className="size-3" />
              {recipe.viewCount}
            </span>
          </div>
          {onArchive && user?.roles?.includes("Administrator") && (
            <button
              onClick={(e) => { e.preventDefault(); onArchive(recipe.recipeId); }}
              className="p-1 rounded hover:bg-stone-100 text-stone-400 hover:text-red-500 transition-colors"
              title="Archive recipe"
            >
              <Archive className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}

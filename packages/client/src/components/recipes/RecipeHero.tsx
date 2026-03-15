/**
 * @module components/recipes/RecipeHero
 *
 * 1:1 aspect ratio hero image for the recipe output. Shows the AI-generated
 * image when available, or a styled placeholder matching the domain accent.
 * Capped at 500px max height to prevent oversized images on large screens.
 */

import { ChefHat, GlassWater, Croissant } from "lucide-react";
import type { RecipeDomain } from "./RecipeForm.js";

interface RecipeHeroProps {
  imageUrl: string | null;
  recipeName: string;
  domain: RecipeDomain;
}

const PLACEHOLDER_CONFIG = {
  recipe: {
    bg: "from-amber-900 to-stone-900",
    Icon: ChefHat,
    iconColor: "text-amber-400",
  },
  patisserie: {
    bg: "from-pink-900 to-stone-900",
    Icon: Croissant,
    iconColor: "text-pink-300",
  },
  spirits: {
    bg: "from-amber-950 to-stone-900",
    Icon: GlassWater,
    iconColor: "text-amber-300",
  },
};

export function RecipeHero({ imageUrl, recipeName, domain }: RecipeHeroProps) {
  const config = PLACEHOLDER_CONFIG[domain];

  if (imageUrl) {
    return (
      <div className="relative w-full aspect-square max-h-[500px] overflow-hidden group cursor-pointer"
        onClick={() => window.open(imageUrl, "_blank")}
      >
        <img
          src={imageUrl}
          alt={recipeName}
          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        {/* Gradient overlay for text legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-8 flex items-end justify-between">
          <h1 className="text-white text-3xl md:text-4xl font-bold drop-shadow-md leading-tight">
            {recipeName}
          </h1>
          <span className="text-white/70 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
            View full photo
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative w-full aspect-square max-h-[500px] bg-gradient-to-br ${config.bg} flex flex-col items-center justify-center`}
    >
      <config.Icon className={`size-20 ${config.iconColor} opacity-30 mb-4`} />
      <h1 className="text-white text-3xl md:text-4xl font-bold text-center px-8 leading-tight">
        {recipeName}
      </h1>
    </div>
  );
}

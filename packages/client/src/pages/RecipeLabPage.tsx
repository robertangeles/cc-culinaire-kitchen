/**
 * @module pages/RecipeLabPage
 *
 * Domain-aware recipe lab page. The active domain is determined by the
 * route:
 *   /recipes     → CulinAIre Recipe   (warm amber accent)
 *   /patisserie  → CulinAIre Patisserie (blush/pink accent)
 *   /spirits     → CulinAIre Spirits    (deep amber/dark accent)
 *
 * Layout:
 *   1. Hero image (full-width, 60vh) — AI-generated or placeholder
 *   2. Two-column recipe card (ingredients + method)
 *
 * Before a recipe is generated: shows a centered form panel.
 * After generation: shows the hero + recipe card with a "Generate Another" button.
 */

import { useState } from "react";
import { ChefHat, Croissant, GlassWater, AlertCircle, RefreshCw } from "lucide-react";
import { RecipeForm, type RecipeFormData, type RecipeDomain } from "../components/recipes/RecipeForm.js";
import { RecipeHero } from "../components/recipes/RecipeHero.js";
import { RecipeCard, type RecipeData } from "../components/recipes/RecipeCard.js";

// ---------------------------------------------------------------------------
// Domain configuration
// ---------------------------------------------------------------------------

interface DomainConfig {
  label: string;
  tagline: string;
  icon: React.ElementType;
  accent: string;
  bg: string;
  apiEndpoint: string;
}

const DOMAIN_CONFIG: Record<RecipeDomain, DomainConfig> = {
  recipe: {
    label: "CulinAIre Recipe",
    tagline: "AI-powered recipes across every cuisine and technique",
    icon: ChefHat,
    accent: "text-amber-600",
    bg: "bg-amber-50",
    apiEndpoint: "/api/recipes/generate",
  },
  patisserie: {
    label: "CulinAIre Patisserie",
    tagline: "Precision pastry recipes from a world-class AI pastry chef",
    icon: Croissant,
    accent: "text-pink-500",
    bg: "bg-pink-50",
    apiEndpoint: "/api/recipes/patisserie",
  },
  spirits: {
    label: "CulinAIre Spirits",
    tagline: "Cocktails and mocktails crafted by an AI bar director",
    icon: GlassWater,
    accent: "text-amber-800",
    bg: "bg-amber-100",
    apiEndpoint: "/api/recipes/spirits",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RecipeLabPageProps {
  domain: RecipeDomain;
}

interface GeneratedRecipe {
  recipe: RecipeData;
  imageUrl: string | null;
}

export function RecipeLabPage({ domain }: RecipeLabPageProps) {
  const config = DOMAIN_CONFIG[domain];
  const DomainIcon = config.icon;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedRecipe | null>(null);
  const [proseResponse, setProseResponse] = useState<string | null>(null);

  async function handleGenerate(formData: RecipeFormData) {
    setLoading(true);
    setError(null);
    setGenerated(null);
    setProseResponse(null);

    try {
      // Convert mainIngredients string to array if provided
      const body = {
        ...formData,
        mainIngredients: formData.mainIngredients
          ? formData.mainIngredients.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
      };

      const res = await fetch(config.apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? `Request failed (${res.status})`);
      }

      const data = (await res.json()) as {
        recipe?: RecipeData;
        imageUrl?: string | null;
        prose?: string;
      };

      if (data.prose) {
        setProseResponse(data.prose);
      } else if (data.recipe) {
        setGenerated({ recipe: data.recipe, imageUrl: data.imageUrl ?? null });
      } else {
        throw new Error("Unexpected response from server.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setGenerated(null);
    setProseResponse(null);
    setError(null);
  }

  // State: recipe generated — show hero + card
  if (generated) {
    return (
      <div className="flex-1 overflow-y-auto">
        <RecipeHero
          imageUrl={generated.imageUrl}
          recipeName={generated.recipe.name}
          domain={domain}
        />
        <div className="max-w-5xl mx-auto">
          <RecipeCard recipe={generated.recipe} domain={domain} />
          <div className="px-6 md:px-10 pb-10 flex justify-center">
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl border-2 border-stone-300 text-stone-700 font-medium text-sm hover:border-stone-400 transition-colors"
            >
              <RefreshCw className="size-4" />
              Generate Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  // State: prose fallback
  if (proseResponse) {
    return (
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center p-8">
        <div className="max-w-xl w-full bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="size-5 text-amber-600" />
            <h2 className="font-semibold text-stone-800">Here are some suggestions</h2>
          </div>
          <p className="text-stone-600 text-sm leading-relaxed whitespace-pre-line">{proseResponse}</p>
          <button
            onClick={handleReset}
            className="mt-6 flex items-center gap-2 px-5 py-2 rounded-lg bg-stone-800 text-white text-sm font-medium hover:bg-stone-700 transition-colors"
          >
            <RefreshCw className="size-4" />
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // State: form (initial or after error)
  return (
    <div className={`flex-1 overflow-y-auto ${config.bg}`}>
      <div className="min-h-full flex flex-col items-center justify-center p-6 md:p-10">
        {/* Lab header */}
        <div className="text-center mb-8">
          <DomainIcon className={`size-12 mx-auto mb-3 ${config.accent}`} />
          <h1 className="text-2xl md:text-3xl font-bold text-stone-800">{config.label}</h1>
          <p className="text-stone-500 mt-2 text-sm md:text-base">{config.tagline}</p>
        </div>

        {/* Form card */}
        <div className="w-full max-w-xl bg-white rounded-2xl shadow-sm border border-stone-200 p-6 md:p-8">
          {error && (
            <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
          <RecipeForm domain={domain} onSubmit={handleGenerate} loading={loading} />
        </div>
      </div>
    </div>
  );
}

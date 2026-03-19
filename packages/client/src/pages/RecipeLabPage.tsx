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
import { useAuth } from "../context/AuthContext.js";

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
    accent: "text-[#D4A574]",
    bg: "bg-[#0A0A0A]",
    apiEndpoint: "/api/recipes/generate",
  },
  patisserie: {
    label: "CulinAIre Patisserie",
    tagline: "Precision pastry recipes from a world-class AI pastry chef",
    icon: Croissant,
    accent: "text-[#D4A574]",
    bg: "bg-[#0A0A0A]",
    apiEndpoint: "/api/recipes/patisserie",
  },
  spirits: {
    label: "CulinAIre Spirits",
    tagline: "Cocktails and mocktails crafted by an AI bar director",
    icon: GlassWater,
    accent: "text-[#D4A574]",
    bg: "bg-[#0A0A0A]",
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
  recipeId: string | null;
  slug: string | null;
}

export function RecipeLabPage({ domain }: RecipeLabPageProps) {
  const config = DOMAIN_CONFIG[domain];
  const DomainIcon = config.icon;
  const { user, isGuest, guestToken, refreshGuestUsage, refreshUser } = useAuth();

  // User-specific storage key prevents recipe data leaking between accounts
  const userKey = user?.userId ?? guestToken ?? "anon";
  const storageKey = `recipe_lab_${domain}_${userKey}`;

  // Restore from sessionStorage on mount
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedRecipe | null>(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [proseResponse, setProseResponse] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);

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

      const guestToken = localStorage.getItem("culinaire_guest_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (guestToken) headers["X-Guest-Token"] = guestToken;

      const res = await fetch(config.apiEndpoint, {
        method: "POST",
        headers,
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
        recipeId?: string | null;
        slug?: string | null;
        prose?: string;
      };

      if (data.prose) {
        setProseResponse(data.prose);
      } else if (data.recipe) {
        const gen: GeneratedRecipe = {
          recipe: data.recipe,
          imageUrl: data.imageUrl ?? null,
          recipeId: data.recipeId ?? null,
          slug: data.slug ?? null,
        };
        setGenerated(gen);
        setIsPublic(false);
        try { sessionStorage.setItem(storageKey, JSON.stringify(gen)); } catch { /* quota */ }
        // Refresh session counter immediately (no page reload)
        if (isGuest) {
          refreshGuestUsage();
        } else {
          setTimeout(() => refreshUser(), 300);
        }
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
    sessionStorage.removeItem(storageKey);
  }

  // ---------------------------------------------------------------------------
  // Split-screen layout: form left, output right (md+). Stacked on mobile.
  // When no recipe generated yet: form centered full-width.
  // ---------------------------------------------------------------------------

  // Form panel (shared between initial and split-screen states)
  const formPanel = (
    <div className={`${generated ? "" : "w-full max-w-xl"} bg-[#161616] rounded-2xl border border-[#2A2A2A] p-6 md:p-8`}>
      {error && (
        <div className="mb-4 flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <AlertCircle className="size-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}
      {proseResponse && (
        <div className="mb-4 bg-[#D4A574]/10 border border-[#D4A574]/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="size-4 text-[#D4A574]" />
            <h3 className="text-sm font-semibold text-[#D4A574]">Suggestions</h3>
          </div>
          <p className="text-sm text-[#E5E5E5] whitespace-pre-line">{proseResponse}</p>
        </div>
      )}
      <RecipeForm domain={domain} onSubmit={handleGenerate} loading={loading} />
    </div>
  );

  // No recipe generated yet — centered form
  if (!generated) {
    return (
      <div className={`flex-1 overflow-y-auto ${config.bg}`}>
        <div className="min-h-full flex flex-col items-center justify-center p-6 md:p-10">
          <div className="text-center mb-8">
            <DomainIcon className={`size-12 mx-auto mb-3 ${config.accent}`} />
            <h1 className="text-2xl md:text-3xl font-bold text-[#FAFAFA] tracking-tight">{config.label}</h1>
            <p className="text-[#999999] mt-2 text-sm md:text-base">{config.tagline}</p>
          </div>
          {formPanel}
        </div>
      </div>
    );
  }

  // Recipe generated — split screen
  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
      {/* Left: form panel (sticky, scrollable) */}
      <div className="md:w-[380px] lg:w-[420px] md:flex-shrink-0 md:border-r border-[#2A2A2A] bg-[#161616] overflow-y-auto p-6">
        <div className="mb-4">
          <DomainIcon className={`size-8 mb-2 ${config.accent}`} />
          <h2 className="text-lg font-bold text-[#FAFAFA] tracking-tight">{config.label}</h2>
          <p className="text-xs text-[#999999]">{config.tagline}</p>
        </div>
        {formPanel}
      </div>

      {/* Right: recipe output (scrollable) */}
      <div className="flex-1 overflow-y-auto bg-[#0A0A0A]">
        <RecipeHero
          imageUrl={generated.imageUrl}
          recipeName={generated.recipe.name}
          domain={domain}
        />
        <div className="max-w-5xl mx-auto">
          <RecipeCard
            recipe={generated.recipe}
            domain={domain}
            recipeId={generated.recipeId ?? undefined}
            slug={generated.slug ?? undefined}
            imageUrl={generated.imageUrl}
            isPublic={isPublic}
            creator={user ? {
              userName: user.userName,
              userPhotoPath: user.userPhotoPath,
              userBio: null,
              userFacebook: null,
              userInstagram: null,
              userTiktok: null,
              userPinterest: null,
              userLinkedin: null,
              restaurantName: null,
            } : null}
            onTogglePublic={generated.recipeId ? async (pub) => {
              try {
                const gt = localStorage.getItem("culinaire_guest_token");
                const hdrs: Record<string, string> = { "Content-Type": "application/json" };
                if (gt) hdrs["X-Guest-Token"] = gt;
                const patchRes = await fetch(`/api/recipes/${generated.recipeId}`, {
                  method: "PATCH",
                  headers: hdrs,
                  credentials: "include",
                  body: JSON.stringify({ isPublicInd: pub }),
                });
                if (patchRes.ok) setIsPublic(pub);
              } catch { /* silent */ }
            } : undefined}
          />
        </div>
      </div>
    </div>
  );
}

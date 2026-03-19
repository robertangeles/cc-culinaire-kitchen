/**
 * @module RecipeDetailPage
 *
 * Public view of a single recipe accessed via /kitchen-shelf/:slug.
 * Shows hero image, full recipe card with all V2 sections.
 *
 * SEO: Automatically sets page title, meta description, og:image,
 * twitter:card, and injects Recipe JSON-LD structured data for
 * rich snippets in search engines.
 */

import { useParams, Navigate } from "react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { RecipeCard, type RecipeData } from "../components/recipes/RecipeCard.js";
import { RecipeHero } from "../components/recipes/RecipeHero.js";
import type { RecipeDomain } from "../components/recipes/RecipeForm.js";
import { useRecipeRatings } from "../hooks/useRecipeRatings.js";
import type { CreatorInfo } from "../components/recipes/CreatorCard.js";
import { useAuth } from "../context/AuthContext.js";

interface RecipeDetail {
  recipeId: string;
  slug: string | null;
  title: string;
  domain: string;
  recipeData: RecipeData;
  imageUrl: string | null;
  userId: number | null;
  isPublicInd: boolean;
  creator: CreatorInfo | null;
}

/** Set or update a <meta> tag by property or name. */
function setMeta(attr: "property" | "name", key: string, content: string) {
  let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

/** Inject or update JSON-LD structured data script. */
function setJsonLd(data: Record<string, unknown>) {
  const id = "recipe-jsonld";
  let script = document.getElementById(id) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement("script");
    script.id = id;
    script.type = "application/ld+json";
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(data);
}

/** Remove SEO tags on unmount. */
function cleanupSeo() {
  const jsonLd = document.getElementById("recipe-jsonld");
  if (jsonLd) jsonLd.remove();
  // Reset OG tags to defaults (will be overwritten by usePageMeta on next page)
  ["og:title", "og:description", "og:image", "og:type", "og:url"].forEach((key) => {
    const el = document.querySelector(`meta[property="${key}"]`);
    if (el) el.remove();
  });
  const twitterCard = document.querySelector('meta[name="twitter:card"]');
  if (twitterCard) (twitterCard as HTMLMetaElement).content = "summary";
}

/** Convert ISO 8601 duration string like "25 minutes" to PT format. */
function toPTDuration(timeStr: string): string {
  const match = timeStr.match(/(\d+)\s*(hour|minute|min|hr)/i);
  if (!match) return "PT0M";
  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("hour") || unit.startsWith("hr")) return `PT${num}H`;
  return `PT${num}M`;
}

export function RecipeDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const { data: ratingsData } = useRecipeRatings(recipe?.recipeId);
  const isOwner = user && recipe && recipe.userId === user.userId;

  useEffect(() => {
    if (!id) return;

    async function load() {
      try {
        const guestToken = localStorage.getItem("culinaire_guest_token");
        const headers: Record<string, string> = {};
        if (guestToken) headers["X-Guest-Token"] = guestToken;

        const res = await fetch(`/api/recipes/${id}`, {
          headers,
          credentials: "include",
        });
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const data = await res.json();
        setRecipe({
          recipeId: data.recipeId,
          slug: data.slug,
          title: data.title,
          domain: data.domain,
          recipeData: data.recipeData as RecipeData,
          imageUrl: data.imageUrl,
          userId: data.userId ?? null,
          isPublicInd: data.isPublicInd,
          creator: data.creator ?? null,
        });
        setIsPublic(data.isPublicInd ?? false);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }

    load();

    return () => cleanupSeo();
  }, [id]);

  // Set SEO tags when recipe loads
  useEffect(() => {
    if (!recipe) return;

    const r = recipe.recipeData;
    const pageTitle = `${r.name} | CulinAIre Kitchen`;
    const description = (r.description || "").slice(0, 160);
    const url = `${window.location.origin}/kitchen-shelf/${recipe.slug ?? recipe.recipeId}`;
    const image = recipe.imageUrl || "";

    // Page title
    document.title = pageTitle;

    // Meta tags
    setMeta("name", "description", description);
    setMeta("property", "og:title", pageTitle);
    setMeta("property", "og:description", description);
    setMeta("property", "og:type", "article");
    setMeta("property", "og:url", url);
    if (image) setMeta("property", "og:image", image);
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", pageTitle);
    setMeta("name", "twitter:description", description);
    if (image) setMeta("name", "twitter:image", image);

    // JSON-LD Recipe structured data (schema.org)
    const jsonLd: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: r.name,
      description: r.description,
      image: image || undefined,
      author: {
        "@type": "Organization",
        name: "CulinAIre Kitchen",
      },
      prepTime: toPTDuration(r.prepTime),
      cookTime: toPTDuration(r.cookTime),
      recipeYield: r.yield,
      recipeCategory: recipe.domain,
      recipeIngredient: r.ingredients.map(
        (i) => `${i.amount} ${i.unit} ${i.name}${i.note ? ` (${i.note})` : ""}`,
      ),
      recipeInstructions: r.steps.map((s) => ({
        "@type": "HowToStep",
        position: s.step,
        text: s.instruction,
      })),
    };

    // Add nutrition if available
    if (r.nutritionPerServing && r.nutritionPerServing.length > 0) {
      const nutritionMap: Record<string, string> = {};
      for (const n of r.nutritionPerServing) {
        const key = n.nutrient.toLowerCase();
        if (key.includes("calor")) nutritionMap.calories = n.amount;
        if (key.includes("protein")) nutritionMap.proteinContent = n.amount;
        if (key.includes("fat") && !key.includes("saturated")) nutritionMap.fatContent = n.amount;
        if (key.includes("carb")) nutritionMap.carbohydrateContent = n.amount;
        if (key.includes("fiber")) nutritionMap.fiberContent = n.amount;
        if (key.includes("sodium")) nutritionMap.sodiumContent = n.amount;
      }
      if (Object.keys(nutritionMap).length > 0) {
        jsonLd.nutrition = { "@type": "NutritionInformation", ...nutritionMap };
      }
    }

    // Add aggregate rating for rich snippets
    if (ratingsData && ratingsData.count > 0) {
      jsonLd.aggregateRating = {
        "@type": "AggregateRating",
        ratingValue: ratingsData.average,
        ratingCount: ratingsData.count,
        bestRating: 5,
        worstRating: 1,
      };
    }

    setJsonLd(jsonLd);
  }, [recipe, ratingsData]);

  if (notFound) return <Navigate to="/kitchen-shelf" replace />;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-[#D4A574]" />
      </div>
    );
  }

  if (!recipe) return <Navigate to="/kitchen-shelf" replace />;

  return (
    <div className="flex-1 overflow-y-auto bg-[#0A0A0A]">
      <RecipeHero
        imageUrl={recipe.imageUrl}
        recipeName={recipe.recipeData.name}
        domain={recipe.domain as RecipeDomain}
      />
      <div className="max-w-5xl mx-auto">
        <RecipeCard
          recipe={recipe.recipeData}
          domain={recipe.domain as RecipeDomain}
          recipeId={recipe.recipeId}
          slug={recipe.slug ?? undefined}
          imageUrl={recipe.imageUrl}
          creator={recipe.creator}
          isPublic={isPublic}
          onTogglePublic={isOwner ? async (pub) => {
            try {
              await fetch(`/api/recipes/${recipe.recipeId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ isPublicInd: pub }),
              });
              setIsPublic(pub);
            } catch { /* silent */ }
          } : undefined}
        />
        {/* AI Disclaimer */}
        <div className="px-6 md:px-10 pb-8 mt-4">
          <div className="bg-[#161616] rounded-lg border border-[#2A2A2A] p-4">
            <p className="text-xs text-[#666666] leading-relaxed">
              <strong className="text-[#999999]">AI-Generated Content:</strong> This recipe was generated by CulinAIre Kitchen,
              an AI-powered culinary platform. All recipes should be reviewed by a qualified professional before use.
              CulinAIre Kitchen does not guarantee outcomes, nutritional accuracy, or allergen completeness.
              Always verify ingredient safety, cooking temperatures, and dietary suitability. Use professional judgment.
              By using this content, you acknowledge it is AI-generated and accept responsibility for any adaptations.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

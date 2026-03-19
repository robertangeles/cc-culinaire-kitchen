/**
 * @module components/recipes/RecipeCard
 *
 * The full recipe card rendered below the hero image.
 * Two-column layout (ingredients left, method right) on medium+ screens;
 * stacked on mobile.
 */

import { useState } from "react";
import { Printer, Clock, Users, ChefHat, AlertTriangle, Thermometer, GlassWater, Flame, Wine, Hash, Sparkles, Share2, Copy, Check } from "lucide-react";
import type { RecipeDomain } from "./RecipeForm.js";
import { RecipeShareBar } from "./RecipeShareBar.js";
import RecipeRatings from "./RecipeRatings.js";
import { CreatorCard, type CreatorInfo } from "./CreatorCard.js";

interface Ingredient {
  amount: string;
  unit: string;
  name: string;
  note?: string;
}

interface Step {
  step: number;
  instruction: string;
}

interface FlavorScore {
  score: number;
  description: string;
}

interface NutritionInfo {
  nutrient: string;
  amount: string;
  dailyValue?: string;
}

interface WinePairingPrimary {
  wine: string;
  intensityMatch?: number;
  flavorHarmony?: number;
  textureInteraction?: number;
  why: string;
}

export interface RecipeData {
  name: string;
  description: string;
  yield: string;
  prepTime: string;
  cookTime: string;
  difficulty: string;
  temperature?: string;
  glassware?: string;
  garnish?: string;
  alcoholic?: boolean;
  ingredients: Ingredient[];
  steps: Step[];
  proTips?: string[];
  allergenNote: string;
  confidenceNote: string;
  // V2 fields
  whyThisWorks?: string;
  theResult?: string;
  flavorBalance?: {
    sweet: FlavorScore;
    salty: FlavorScore;
    sour: FlavorScore;
    bitter: FlavorScore;
    umami: FlavorScore;
  };
  nutritionPerServing?: NutritionInfo[];
  storageAndSafety?: string;
  hookLine?: string;
  storyBehindTheDish?: string;
  platingGuide?: string;
  hashtags?: string[];
  winePairing?: {
    primary: WinePairingPrimary;
    alternatives?: { wine: string; why: string }[];
  };
  // Patisserie-specific
  bakerPercentages?: { ingredient: string; weight: string; percentage: string }[];
  textureContrast?: string;
  makeAheadComponents?: string[];
  criticalTemperatures?: string;
  // Spirits-specific
  venueType?: string;
  buildTime?: string;
  ice?: string;
  abv?: string;
  standardDrinks?: string;
  batchSpec?: { servings: number; components: string[]; storage: string; toServe: string };
  variations?: { name: string; description: string; specAdjustment: string }[];
  foodPairing?: { primary: { dish: string; why: string }; alternatives?: { dish: string; why: string }[] };
}

interface RecipeCardProps {
  recipe: RecipeData;
  domain: RecipeDomain;
  /** Recipe UUID for share link */
  recipeId?: string;
  /** URL slug for share link (preferred over recipeId) */
  slug?: string;
  /** Hero image URL for social sharing */
  imageUrl?: string | null;
  /** Callback when user toggles public visibility */
  onTogglePublic?: (isPublic: boolean) => void;
  /** Current public state */
  isPublic?: boolean;
  /** Recipe creator info for "Added By" display */
  creator?: CreatorInfo | null;
}

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-[#1E1E1E] text-[#999999]",
  intermediate: "bg-[#1E1E1E] text-[#999999]",
  advanced: "bg-[#1E1E1E] text-[#999999]",
  expert: "bg-[#1E1E1E] text-[#999999]",
};

export function RecipeCard({ recipe, domain, recipeId, slug, imageUrl, onTogglePublic, isPublic, creator }: RecipeCardProps) {
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(new Set());
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  function toggleIngredient(index: number) {
    setCheckedIngredients((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleStep(stepNum: number) {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepNum)) next.delete(stepNum);
      else next.add(stepNum);
      return next;
    });
  }

  function handlePrint() {
    window.print();
  }

  const accentBorder = "border-[#D4A574]";

  return (
    <div className="bg-[#161616] border border-[#2A2A2A] rounded-2xl overflow-visible">
      {/* Recipe meta strip */}
      <div className="border-b border-[#2A2A2A] px-6 md:px-10 py-5">
        <p className="text-[#E5E5E5] text-sm leading-relaxed mb-4 max-w-3xl">{recipe.description}</p>

        <div className="flex flex-wrap items-center gap-4 text-sm text-[#E5E5E5]">
          <span className="flex items-center gap-1.5">
            <Clock className="size-4 text-[#999999]" />
            Prep {recipe.prepTime}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="size-4 text-[#999999]" />
            Cook {recipe.cookTime}
          </span>
          <span className="flex items-center gap-1.5">
            <Users className="size-4 text-[#999999]" />
            {recipe.yield}
          </span>
          <span
            className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${
              DIFFICULTY_COLORS[recipe.difficulty] ?? "bg-[#1E1E1E] text-[#999999]"
            }`}
          >
            {recipe.difficulty}
          </span>
          {recipe.temperature && (
            <span className="flex items-center gap-1.5">
              <Thermometer className="size-4 text-[#999999]" />
              {recipe.temperature}
            </span>
          )}
          {recipe.glassware && (
            <span className="flex items-center gap-1.5">
              <GlassWater className="size-4 text-[#999999]" />
              {recipe.glassware}
            </span>
          )}
          {recipe.garnish && (
            <span className="text-[#999999] italic">Garnish: {recipe.garnish}</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onTogglePublic && (
              <button
                onClick={() => onTogglePublic(!isPublic)}
                className={`flex items-center gap-1.5 text-sm transition-colors ${
                  isPublic ? "text-[#D4A574] hover:text-[#C4956A]" : "text-[#999999] hover:text-white"
                }`}
              >
                <Share2 className="size-4" />
                {isPublic ? "Public" : "Make Public"}
              </button>
            )}
          </div>
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 text-sm text-[#999999] hover:text-white transition-colors"
          >
            <Printer className="size-4" />
            Print
          </button>
        </div>

        {/* Hook line (social caption) */}
        {recipe.hookLine && (
          <div className="mt-4 bg-[#D4A574]/10 border border-[#D4A574]/20 rounded-xl px-4 py-3">
            <p className="text-sm font-medium text-[#D4A574] italic">"{recipe.hookLine}"</p>
          </div>
        )}

        {/* Social share bar + star rating + Added By */}
        {(recipeId || slug) && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#666666]">Share:</span>
                <RecipeShareBar
                  title={recipe.name}
                  description={recipe.description}
                  hookLine={recipe.hookLine}
                  hashtags={recipe.hashtags}
                  imageUrl={imageUrl}
                  slug={slug}
                  recipeId={recipeId}
                />
              </div>
              <div className="flex flex-col items-end gap-1">
                {recipeId && (
                  <RecipeRatings recipeId={recipeId} compact />
                )}
                {creator ? (
                  <CreatorCard creator={creator} />
                ) : (
                  <span className="text-xs text-[#666666]">Added by <span className="font-medium text-[#999999]">Anonymous</span></span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid md:grid-cols-5 gap-0 divide-y md:divide-y-0 md:divide-x divide-[#2A2A2A]">
        {/* Ingredients — 2/5 width */}
        <div className="md:col-span-2 px-6 md:px-8 py-8">
          <h2 className={`text-lg font-semibold text-[#FAFAFA] mb-5 pb-2 border-b-2 ${accentBorder}`}>
            Ingredients
          </h2>
          <ul className="space-y-3">
            {recipe.ingredients.map((ing, idx) => (
              <li key={idx} className="flex items-start gap-3">
                <button
                  onClick={() => toggleIngredient(idx)}
                  className={`mt-0.5 size-5 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                    checkedIngredients.has(idx)
                      ? "bg-[#D4A574] border-[#D4A574]"
                      : "border-[#3A3A3A] hover:border-[#D4A574]"
                  }`}
                  aria-label={`Mark ${ing.name} as used`}
                >
                  {checkedIngredients.has(idx) && (
                    <svg className="size-3 text-[#0A0A0A]" fill="none" viewBox="0 0 12 12">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <span className={`text-sm leading-relaxed ${checkedIngredients.has(idx) ? "line-through text-[#666666]" : "text-[#E5E5E5]"}`}>
                  <strong className="font-medium">
                    {ing.amount} {ing.unit}
                  </strong>{" "}
                  {ing.name}
                  {ing.note && <span className="text-[#999999] italic"> ({ing.note})</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Method — 3/5 width */}
        <div className="md:col-span-3 px-6 md:px-8 py-8">
          <h2 className={`text-lg font-semibold text-[#FAFAFA] mb-5 pb-2 border-b-2 ${accentBorder}`}>
            Method
          </h2>
          <ol className="space-y-6">
            {recipe.steps.map((step) => (
              <li key={step.step} className="flex gap-4">
                <button
                  onClick={() => toggleStep(step.step)}
                  className={`size-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 transition-colors ${
                    completedSteps.has(step.step)
                      ? "bg-[#D4A574] text-[#0A0A0A]"
                      : "bg-[#1E1E1E] text-[#D4A574] hover:bg-[#2A2A2A]"
                  }`}
                  aria-label={`Mark step ${step.step} complete`}
                >
                  {step.step}
                </button>
                <p
                  className={`text-sm leading-relaxed pt-1 ${
                    completedSteps.has(step.step) ? "text-[#666666] line-through" : "text-[#E5E5E5]"
                  }`}
                >
                  {step.instruction}
                </p>
              </li>
            ))}
          </ol>

          {/* Pro tips */}
          {recipe.proTips && recipe.proTips.length > 0 && (
            <div className="mt-8 bg-[#D4A574]/10 border border-[#D4A574]/20 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <ChefHat className="size-4 text-[#D4A574]" />
                <h3 className="text-sm font-semibold text-[#FAFAFA]">Pro Tips</h3>
              </div>
              <ul className="space-y-2">
                {recipe.proTips.map((tip, idx) => (
                  <li key={idx} className="text-sm text-[#E5E5E5] leading-relaxed">
                    • {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Allergen note */}
      <div className="mx-6 md:mx-10 mb-8 mt-2 flex items-start gap-3 bg-[#D4A574]/10 border border-[#D4A574]/20 rounded-xl p-4">
        <AlertTriangle className="size-4 text-[#D4A574] shrink-0 mt-0.5" />
        <p className="text-sm text-[#E5E5E5] leading-relaxed">{recipe.allergenNote}</p>
      </div>

      {/* Why This Works */}
      {recipe.whyThisWorks && (
        <div className="mx-6 md:mx-10 mb-6">
          <h3 className="text-sm font-semibold text-[#FAFAFA] mb-2 flex items-center gap-2">
            <Sparkles className="size-4 text-[#D4A574]" />
            Why This Works
          </h3>
          <p className="text-sm text-[#E5E5E5] leading-relaxed">{recipe.whyThisWorks}</p>
        </div>
      )}

      {/* The Result */}
      {recipe.theResult && (
        <div className="mx-6 md:mx-10 mb-6">
          <h3 className="text-sm font-semibold text-[#FAFAFA] mb-2">The Result</h3>
          <p className="text-sm text-[#E5E5E5] leading-relaxed italic">{recipe.theResult}</p>
        </div>
      )}

      {/* Flavor Balance */}
      {recipe.flavorBalance && (
        <div className="mx-6 md:mx-10 mb-6 bg-[#1E1E1E] rounded-xl p-5 border border-[#2A2A2A]">
          <h3 className="text-sm font-semibold text-[#FAFAFA] mb-4 flex items-center gap-2">
            <Flame className="size-4 text-[#D4A574]" />
            Flavor Balance
          </h3>
          <div className="grid grid-cols-5 gap-3">
            {(["sweet", "salty", "sour", "bitter", "umami"] as const).map((taste) => {
              const data = recipe.flavorBalance![taste];
              return (
                <div key={taste} className="text-center">
                  <div className="text-xs font-medium text-[#999999] uppercase mb-1">{taste}</div>
                  <div className="text-lg font-bold text-[#FAFAFA]">{data.score}<span className="text-xs text-[#666666]">/10</span></div>
                  <div className="w-full bg-[#2A2A2A] rounded-full h-1.5 mt-1">
                    <div className="bg-[#D4A574] h-1.5 rounded-full" style={{ width: `${data.score * 10}%` }} />
                  </div>
                  <p className="text-xs text-[#666666] mt-1 leading-tight">{data.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Nutrition */}
      {recipe.nutritionPerServing && recipe.nutritionPerServing.length > 0 && (
        <div className="mx-6 md:mx-10 mb-6">
          <h3 className="text-sm font-semibold text-[#FAFAFA] mb-3">Nutrition Per Serving</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {recipe.nutritionPerServing.map((n, i) => (
              <div key={i} className="bg-[#1E1E1E] rounded-xl px-3 py-2 text-center">
                <div className="text-xs text-[#999999]">{n.nutrient}</div>
                <div className="text-sm font-semibold text-[#FAFAFA]">{n.amount}</div>
                {n.dailyValue && <div className="text-xs text-[#666666]">{n.dailyValue} DV</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Wine Pairing (not shown for spirits — spirits uses foodPairing instead) */}
      {recipe.winePairing && domain !== "spirits" && (
        <div className="mx-6 md:mx-10 mb-6 bg-[#1E1E1E] rounded-xl p-5 border border-[#2A2A2A]">
          <h3 className="text-sm font-semibold text-[#FAFAFA] mb-3 flex items-center gap-2">
            <Wine className="size-4 text-[#D4A574]" />
            Wine Pairing
          </h3>
          <p className="text-sm font-medium text-[#FAFAFA]">{recipe.winePairing.primary.wine}</p>
          <p className="text-sm text-[#E5E5E5] mt-1">{recipe.winePairing.primary.why}</p>
          {recipe.winePairing.alternatives && recipe.winePairing.alternatives.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[#2A2A2A]">
              <p className="text-xs font-medium text-[#999999] mb-1">Alternatives:</p>
              {recipe.winePairing.alternatives.map((alt, i) => (
                <p key={i} className="text-xs text-[#E5E5E5]"><strong>{alt.wine}</strong> — {alt.why}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* === Patisserie-specific sections === */}

      {/* Baker's Percentages */}
      {recipe.bakerPercentages && recipe.bakerPercentages.length > 0 && (
        <div className="mx-6 md:mx-10 mb-6">
          <h3 className="text-sm font-semibold text-[#FAFAFA] mb-3">Baker's Percentages</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2A2A2A] text-left">
                  <th className="py-2 pr-4 font-medium text-[#999999]">Ingredient</th>
                  <th className="py-2 pr-4 font-medium text-[#999999]">Weight</th>
                  <th className="py-2 font-medium text-[#999999]">%</th>
                </tr>
              </thead>
              <tbody>
                {recipe.bakerPercentages.map((bp, i) => (
                  <tr key={i} className="border-b border-[#1E1E1E]">
                    <td className="py-1.5 pr-4 text-[#E5E5E5]">{bp.ingredient}</td>
                    <td className="py-1.5 pr-4 text-[#E5E5E5]">{bp.weight}</td>
                    <td className="py-1.5 text-[#D4A574] font-medium">{bp.percentage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Texture Contrast */}
      {recipe.textureContrast && (
        <div className="mx-6 md:mx-10 mb-6">
          <h3 className="text-sm font-semibold text-[#FAFAFA] mb-2">Texture Contrast</h3>
          <p className="text-sm text-[#E5E5E5] leading-relaxed italic">{recipe.textureContrast}</p>
        </div>
      )}

      {/* Critical Temperatures */}
      {recipe.criticalTemperatures && (
        <div className="mx-6 md:mx-10 mb-6 bg-red-500/10 rounded-xl p-4 border border-red-500/20">
          <h3 className="text-sm font-semibold text-red-400 mb-2 flex items-center gap-2">
            <Thermometer className="size-4" />
            Critical Temperatures
          </h3>
          <p className="text-sm text-[#E5E5E5] leading-relaxed">{recipe.criticalTemperatures}</p>
        </div>
      )}

      {/* Make-Ahead Components */}
      {recipe.makeAheadComponents && recipe.makeAheadComponents.length > 0 && (
        <div className="mx-6 md:mx-10 mb-6">
          <h3 className="text-sm font-semibold text-[#FAFAFA] mb-2">Make-Ahead Components</h3>
          <ul className="space-y-1">
            {recipe.makeAheadComponents.map((c, i) => (
              <li key={i} className="text-sm text-[#E5E5E5]"><span className="text-[#D4A574]">•</span> {c}</li>
            ))}
          </ul>
        </div>
      )}

      {/* === Spirits-specific sections === */}

      {/* Batch Spec */}
      {recipe.batchSpec && (
        <div className="mx-6 md:mx-10 mb-6 bg-[#D4A574]/10 rounded-xl p-5 border border-[#D4A574]/20">
          <h3 className="text-sm font-semibold text-[#D4A574] mb-3">Batch Spec ({recipe.batchSpec.servings} Servings)</h3>
          <ul className="space-y-1 mb-3">
            {recipe.batchSpec.components.map((c, i) => (
              <li key={i} className="text-sm text-[#E5E5E5]"><span className="text-[#D4A574]">•</span> {c}</li>
            ))}
          </ul>
          <p className="text-xs text-[#999999]"><strong>Storage:</strong> {recipe.batchSpec.storage}</p>
          <p className="text-xs text-[#999999] mt-1"><strong>To serve:</strong> {recipe.batchSpec.toServe}</p>
        </div>
      )}

      {/* Variations */}
      {recipe.variations && recipe.variations.length > 0 && (
        <div className="mx-6 md:mx-10 mb-6">
          <h3 className="text-sm font-semibold text-[#FAFAFA] mb-3">Variations</h3>
          <div className="space-y-3">
            {recipe.variations.map((v, i) => (
              <div key={i} className="bg-[#1E1E1E] rounded-xl p-4 border border-[#2A2A2A]">
                <p className="text-sm font-medium text-[#FAFAFA]">{v.name}</p>
                <p className="text-xs text-[#999999] mt-1">{v.description}</p>
                <p className="text-xs text-[#E5E5E5] mt-1"><strong>Change:</strong> {v.specAdjustment}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Food Pairing (Spirits) */}
      {recipe.foodPairing && (
        <div className="mx-6 md:mx-10 mb-6 bg-[#1E1E1E] rounded-xl p-5 border border-[#2A2A2A]">
          <h3 className="text-sm font-semibold text-[#FAFAFA] mb-3">Food Pairing</h3>
          <p className="text-sm font-medium text-[#FAFAFA]">{recipe.foodPairing.primary.dish}</p>
          <p className="text-sm text-[#E5E5E5] mt-1">{recipe.foodPairing.primary.why}</p>
          {recipe.foodPairing.alternatives && recipe.foodPairing.alternatives.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[#2A2A2A]">
              {recipe.foodPairing.alternatives.map((a, i) => (
                <p key={i} className="text-xs text-[#E5E5E5] mt-1"><strong>{a.dish}</strong> — {a.why}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ABV / Safety Disclosure (Spirits) */}
      {(recipe.abv || recipe.standardDrinks) && (
        <div className="mx-6 md:mx-10 mb-6 flex flex-wrap items-center gap-3 text-xs text-[#999999]">
          {recipe.abv && <span className="bg-[#1E1E1E] px-3 py-1 rounded-full">ABV: {recipe.abv}</span>}
          {recipe.standardDrinks && <span className="bg-[#1E1E1E] px-3 py-1 rounded-full">{recipe.standardDrinks}</span>}
          {recipe.venueType && <span className="bg-[#1E1E1E] px-3 py-1 rounded-full capitalize">{recipe.venueType}</span>}
          {recipe.buildTime && <span className="bg-[#1E1E1E] px-3 py-1 rounded-full">Build: {recipe.buildTime}</span>}
        </div>
      )}

      {/* Storage & Safety */}
      {recipe.storageAndSafety && (
        <div className="mx-6 md:mx-10 mb-6">
          <h3 className="text-sm font-semibold text-[#FAFAFA] mb-2">Storage & Food Safety</h3>
          <p className="text-sm text-[#E5E5E5] leading-relaxed whitespace-pre-line">{recipe.storageAndSafety}</p>
        </div>
      )}

      {/* Plating Guide */}
      {recipe.platingGuide && (
        <div className="mx-6 md:mx-10 mb-6">
          <h3 className="text-sm font-semibold text-[#FAFAFA] mb-2">Plating Guide</h3>
          <p className="text-sm text-[#E5E5E5] leading-relaxed italic">{recipe.platingGuide}</p>
        </div>
      )}

      {/* Story Behind the Dish */}
      {recipe.storyBehindTheDish && (
        <div className="mx-6 md:mx-10 mb-6">
          <h3 className="text-sm font-semibold text-[#FAFAFA] mb-2">The Story</h3>
          <p className="text-sm text-[#E5E5E5] leading-relaxed">{recipe.storyBehindTheDish}</p>
        </div>
      )}

      {/* Hashtags */}
      {recipe.hashtags && recipe.hashtags.length > 0 && (
        <div className="mx-6 md:mx-10 mb-6 flex flex-wrap gap-2">
          <Hash className="size-4 text-[#666666]" />
          {recipe.hashtags.map((tag, i) => (
            <span key={i} className="text-xs text-[#D4A574] bg-[#D4A574]/10 px-2 py-0.5 rounded-full">
              {tag.startsWith("#") ? tag : `#${tag}`}
            </span>
          ))}
        </div>
      )}

      {/* Star Ratings & Reviews */}
      {recipeId && (
        <RecipeRatings recipeId={recipeId} />
      )}

      {/* Confidence note */}
      <div className="px-6 md:px-10 pb-4">
        <p className="text-xs text-[#999999] italic">{recipe.confidenceNote}</p>
      </div>

      {/* AI Disclaimer */}
      <div className="px-6 md:px-10 pb-8">
        <p className="text-xs text-[#666666] leading-relaxed">
          All recipes are AI-generated and should be reviewed by a qualified professional before use.
          CulinAIre Kitchen does not guarantee outcomes, nutritional accuracy, or allergen completeness.
          Always verify ingredient safety, cooking temperatures, and dietary suitability.
        </p>
      </div>
    </div>
  );
}

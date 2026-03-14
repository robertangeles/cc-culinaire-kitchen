/**
 * @module components/recipes/RecipeCard
 *
 * The full recipe card rendered below the hero image.
 * Two-column layout (ingredients left, method right) on medium+ screens;
 * stacked on mobile.
 */

import { useState } from "react";
import { Printer, Clock, Users, ChefHat, AlertTriangle, Thermometer, GlassWater } from "lucide-react";
import type { RecipeDomain } from "./RecipeForm.js";

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
}

interface RecipeCardProps {
  recipe: RecipeData;
  domain: RecipeDomain;
}

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-green-100 text-green-800",
  intermediate: "bg-amber-100 text-amber-800",
  advanced: "bg-orange-100 text-orange-800",
  expert: "bg-red-100 text-red-800",
};

export function RecipeCard({ recipe, domain }: RecipeCardProps) {
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(new Set());
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

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

  const accentBorder = {
    recipe: "border-amber-500",
    patisserie: "border-pink-400",
    spirits: "border-amber-700",
  }[domain];

  return (
    <div className="bg-white">
      {/* Recipe meta strip */}
      <div className="border-b border-stone-200 px-6 md:px-10 py-5">
        <p className="text-stone-600 text-sm leading-relaxed mb-4 max-w-3xl">{recipe.description}</p>

        <div className="flex flex-wrap items-center gap-4 text-sm text-stone-600">
          <span className="flex items-center gap-1.5">
            <Clock className="size-4 text-stone-400" />
            Prep {recipe.prepTime}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="size-4 text-stone-400" />
            Cook {recipe.cookTime}
          </span>
          <span className="flex items-center gap-1.5">
            <Users className="size-4 text-stone-400" />
            {recipe.yield}
          </span>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
              DIFFICULTY_COLORS[recipe.difficulty] ?? "bg-stone-100 text-stone-700"
            }`}
          >
            {recipe.difficulty}
          </span>
          {recipe.temperature && (
            <span className="flex items-center gap-1.5">
              <Thermometer className="size-4 text-stone-400" />
              {recipe.temperature}
            </span>
          )}
          {recipe.glassware && (
            <span className="flex items-center gap-1.5">
              <GlassWater className="size-4 text-stone-400" />
              {recipe.glassware}
            </span>
          )}
          {recipe.garnish && (
            <span className="text-stone-500 italic">Garnish: {recipe.garnish}</span>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-700 transition-colors"
          >
            <Printer className="size-4" />
            Print
          </button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid md:grid-cols-5 gap-0 divide-y md:divide-y-0 md:divide-x divide-stone-200">
        {/* Ingredients — 2/5 width */}
        <div className="md:col-span-2 px-6 md:px-8 py-8">
          <h2 className={`text-lg font-semibold text-stone-800 mb-5 pb-2 border-b-2 ${accentBorder}`}>
            Ingredients
          </h2>
          <ul className="space-y-3">
            {recipe.ingredients.map((ing, idx) => (
              <li key={idx} className="flex items-start gap-3">
                <button
                  onClick={() => toggleIngredient(idx)}
                  className={`mt-0.5 size-5 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                    checkedIngredients.has(idx)
                      ? "bg-stone-600 border-stone-600"
                      : "border-stone-300 hover:border-stone-500"
                  }`}
                  aria-label={`Mark ${ing.name} as used`}
                >
                  {checkedIngredients.has(idx) && (
                    <svg className="size-3 text-white" fill="none" viewBox="0 0 12 12">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <span className={`text-sm leading-relaxed ${checkedIngredients.has(idx) ? "line-through text-stone-400" : "text-stone-700"}`}>
                  <strong className="font-medium">
                    {ing.amount} {ing.unit}
                  </strong>{" "}
                  {ing.name}
                  {ing.note && <span className="text-stone-500 italic"> ({ing.note})</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Method — 3/5 width */}
        <div className="md:col-span-3 px-6 md:px-8 py-8">
          <h2 className={`text-lg font-semibold text-stone-800 mb-5 pb-2 border-b-2 ${accentBorder}`}>
            Method
          </h2>
          <ol className="space-y-6">
            {recipe.steps.map((step) => (
              <li key={step.step} className="flex gap-4">
                <button
                  onClick={() => toggleStep(step.step)}
                  className={`size-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 transition-colors ${
                    completedSteps.has(step.step)
                      ? "bg-stone-700 text-white"
                      : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                  }`}
                  aria-label={`Mark step ${step.step} complete`}
                >
                  {step.step}
                </button>
                <p
                  className={`text-sm leading-relaxed pt-1 ${
                    completedSteps.has(step.step) ? "text-stone-400 line-through" : "text-stone-700"
                  }`}
                >
                  {step.instruction}
                </p>
              </li>
            ))}
          </ol>

          {/* Pro tips */}
          {recipe.proTips && recipe.proTips.length > 0 && (
            <div className="mt-8 bg-stone-50 rounded-xl p-5 border border-stone-200">
              <div className="flex items-center gap-2 mb-3">
                <ChefHat className="size-4 text-stone-600" />
                <h3 className="text-sm font-semibold text-stone-700">Pro Tips</h3>
              </div>
              <ul className="space-y-2">
                {recipe.proTips.map((tip, idx) => (
                  <li key={idx} className="text-sm text-stone-600 leading-relaxed">
                    • {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Allergen note */}
      <div className="mx-6 md:mx-10 mb-8 mt-2 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
        <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800 leading-relaxed">{recipe.allergenNote}</p>
      </div>

      {/* Confidence note */}
      <div className="px-6 md:px-10 pb-8">
        <p className="text-xs text-stone-400 italic">{recipe.confidenceNote}</p>
      </div>
    </div>
  );
}

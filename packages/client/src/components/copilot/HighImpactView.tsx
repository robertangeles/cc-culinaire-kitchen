/**
 * @module components/copilot/HighImpactView
 *
 * High-Impact tab — top 10 dishes ranked by complexity score.
 * Standalone view (no session needed). Shows difficulty, timing,
 * ingredient/step counts, and menu engineering classification.
 */

import { useState, useEffect, useCallback } from "react";
import { Loader2, Flame, Clock, ListChecks, ShoppingBasket } from "lucide-react";

interface HighImpactDish {
  id: number;
  title: string;
  difficulty: "beginner" | "intermediate" | "advanced" | "expert";
  prepTime: number | null;
  cookTime: number | null;
  ingredientCount: number;
  stepCount: number;
  complexityScore: number;
  classification: string | null;
}

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-green-600/80 text-green-100",
  intermediate: "bg-amber-600/80 text-amber-100",
  advanced: "bg-orange-600/80 text-orange-100",
  expert: "bg-red-600/80 text-red-100",
};

const CLASSIFICATION_STYLES: Record<string, string> = {
  Star: "bg-yellow-600/80 text-yellow-100",
  Plowhorse: "bg-blue-600/80 text-blue-100",
  Puzzle: "bg-purple-600/80 text-purple-100",
  Dog: "bg-gray-600/80 text-gray-200",
};

export function HighImpactView() {
  const [dishes, setDishes] = useState<HighImpactDish[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/prep/high-impact", { credentials: "include" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `Failed (${res.status})`);
      }
      const json = await res.json();
      setDishes(Array.isArray(json) ? json : json.dishes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load high-impact dishes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Loading
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-amber-500" />
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
        {error}
      </div>
    );
  }

  // Empty state
  if (dishes.length === 0) {
    return (
      <div className="text-center py-16">
        <Flame className="size-10 mx-auto text-gray-600 mb-3" />
        <p className="text-gray-400">Generate some recipes first to see high-impact dishes.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        Top 10 dishes ranked by complexity. Focus prep resources on these first.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {dishes.map((dish, index) => (
          <div
            key={dish.id}
            className="bg-gray-800 rounded-xl p-5 border border-gray-700 hover:border-gray-600 transition-colors"
          >
            {/* Rank + Title */}
            <div className="flex items-start gap-3 mb-3">
              <span className="text-2xl font-bold text-amber-500/60 shrink-0">
                #{index + 1}
              </span>
              <div className="min-w-0">
                <h3 className="font-bold text-white text-lg leading-tight truncate">
                  {dish.title}
                </h3>
              </div>
            </div>

            {/* Badges */}
            <div className="flex flex-wrap gap-2 mb-3">
              {/* Difficulty */}
              <span
                className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                  DIFFICULTY_COLORS[dish.difficulty] ?? "bg-gray-600 text-gray-200"
                }`}
              >
                {dish.difficulty}
              </span>

              {/* Classification */}
              {dish.classification && (
                <span
                  className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    CLASSIFICATION_STYLES[dish.classification] ?? "bg-gray-600 text-gray-200"
                  }`}
                >
                  {dish.classification}
                </span>
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2">
              {dish.prepTime != null && (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Clock className="size-3.5 text-gray-500" />
                  <span>Prep: {dish.prepTime}m</span>
                </div>
              )}
              {dish.cookTime != null && (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Clock className="size-3.5 text-gray-500" />
                  <span>Cook: {dish.cookTime}m</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <ShoppingBasket className="size-3.5 text-gray-500" />
                <span>{dish.ingredientCount} ingredients</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <ListChecks className="size-3.5 text-gray-500" />
                <span>{dish.stepCount} steps</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

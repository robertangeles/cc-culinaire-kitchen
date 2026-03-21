/**
 * @module components/copilot/HighImpactView
 *
 * High-Impact tab — top 10 dishes ranked by complexity score.
 * Standalone view (no session needed). Shows difficulty, timing,
 * ingredient/step counts, and menu engineering classification.
 */

import { useState, useEffect, useCallback } from "react";
import { Loader2, Flame, Clock, ShoppingBasket, Info } from "lucide-react";

interface HighImpactDish {
  recipeId: string;
  menuItemId: string | null;
  title: string;
  ingredientCount: number;
  totalPrepMinutes: number;
  complexityScore: number;
  classification: string | null;
}

const CLASSIFICATION_STYLES: Record<string, string> = {
  Star: "bg-[#D4A574]/15 text-[#D4A574] border border-[#D4A574]/30",
  Plowhorse: "bg-blue-500/15 text-blue-400 border border-blue-500/30",
  Puzzle: "bg-purple-500/15 text-purple-400 border border-purple-500/30",
  Dog: "bg-[#2A2A2A] text-[#666666] border border-[#2A2A2A]",
};

interface Props {
  teamView?: boolean;
}

export function HighImpactView({ teamView }: Props) {
  const [dishes, setDishes] = useState<HighImpactDish[]>([]);
  const [hasMenuItems, setHasMenuItems] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = teamView ? "?teamView=true" : "";
      const res = await fetch(`/api/prep/high-impact${params}`, { credentials: "include" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `Failed (${res.status})`);
      }
      const json = await res.json();
      if (Array.isArray(json)) {
        // Legacy array response
        setDishes(json);
        setHasMenuItems(false);
      } else {
        setDishes(json.dishes ?? []);
        setHasMenuItems(json.hasMenuItems ?? false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load high-impact dishes");
    } finally {
      setLoading(false);
    }
  }, [teamView]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Loading
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-[#D4A574]" />
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
        <Flame className="size-10 mx-auto text-[#666666] mb-3" />
        <p className="text-[#999999]">Generate some recipes first to see high-impact dishes.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Banner when no menu items */}
      {!hasMenuItems && (
        <div className="flex items-start gap-3 bg-[#D4A574]/10 border border-[#D4A574]/20 rounded-lg px-4 py-3 mb-4">
          <Info className="size-4 text-[#D4A574] mt-0.5 flex-shrink-0" />
          <p className="text-sm text-[#D4A574]">
            Set up your menu in Menu Intelligence for richer insights. Showing recipe library analysis.
          </p>
        </div>
      )}

      <p className="text-sm text-[#666666] mb-4">
        {hasMenuItems
          ? "Top 10 menu items ranked by complexity. Focus prep resources on these first."
          : "Top 10 dishes ranked by complexity. Focus prep resources on these first."}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {dishes.map((dish, index) => (
          <div
            key={dish.menuItemId ?? dish.recipeId ?? index}
            className="bg-[#161616] rounded-xl p-5 border border-[#2A2A2A] hover:border-[#3A3A3A] transition-colors"
          >
            {/* Rank + Title */}
            <div className="flex items-start gap-3 mb-3">
              <span className="text-2xl font-bold text-[#D4A574]/60 shrink-0">
                #{index + 1}
              </span>
              <div className="min-w-0">
                <h3 className="font-bold text-white text-lg leading-tight truncate">
                  {dish.title}
                </h3>
              </div>
            </div>

            {/* Classification badges */}
            {dish.classification && (
              <div className="flex flex-wrap gap-2 mb-3">
                <span
                  className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    CLASSIFICATION_STYLES[dish.classification] ?? "bg-[#2A2A2A] text-[#E5E5E5]"
                  }`}
                >
                  {dish.classification}
                </span>
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2">
              {dish.totalPrepMinutes > 0 && (
                <div className="flex items-center gap-2 text-sm text-[#999999]">
                  <Clock className="size-3.5 text-[#666666]" />
                  <span>{dish.totalPrepMinutes}m total</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-[#999999]">
                <ShoppingBasket className="size-3.5 text-[#666666]" />
                <span>{dish.ingredientCount} ingredients</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-[#999999]">
                <Flame className="size-3.5 text-[#666666]" />
                <span>Score: {dish.complexityScore}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

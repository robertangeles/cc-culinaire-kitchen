/**
 * @module components/waste/WasteReuseSuggestions
 *
 * AI-powered reuse suggestions based on recent waste logs.
 * Fetches suggestions from POST /api/waste/reuse-suggestions,
 * displays them as cards with type badges, and offers a
 * "Generate Recipe" shortcut to the Recipe Lab.
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import { Loader2, Lightbulb, Sparkles, X, ChefHat, Trash2 } from "lucide-react";

interface ReuseSuggestion {
  id: string;
  ingredientName: string;
  quantityWasted: string;
  suggestion: string;
  type: "Recipe" | "Stock" | "Special" | "Staff Meal";
}

const TYPE_BADGE_STYLES: Record<string, string> = {
  Recipe: "bg-amber-600/20 text-amber-400 border-amber-600/30",
  Stock: "bg-blue-600/20 text-blue-400 border-blue-600/30",
  Special: "bg-purple-600/20 text-purple-400 border-purple-600/30",
  "Staff Meal": "bg-green-600/20 text-green-400 border-green-600/30",
};

export function WasteReuseSuggestions() {
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<ReuseSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/waste/reuse", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Failed (${res.status})`);
      }

      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
      setHasGenerated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate suggestions");
    } finally {
      setLoading(false);
    }
  }

  function handleDismiss(id: string) {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }

  function handleGenerateRecipe(ingredientName: string) {
    navigate("/recipes", { state: { prefillIngredient: ingredientName } });
  }

  return (
    <div>
      {/* Generate button */}
      <div className="text-center mb-8">
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="inline-flex items-center gap-2 px-6 py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors min-h-[44px]"
        >
          {loading ? (
            <>
              <Loader2 className="size-5 animate-spin" />
              Generating Suggestions...
            </>
          ) : (
            <>
              <Sparkles className="size-5" />
              Generate Reuse Suggestions
            </>
          )}
        </button>
        <p className="text-xs text-gray-500 mt-2">
          AI analyzes your recent waste logs and suggests ways to reuse ingredients.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Empty state — no logs yet */}
      {hasGenerated && !loading && suggestions.length === 0 && (
        <div className="text-center py-12">
          <Trash2 className="size-10 mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400 font-medium">No suggestions available</p>
          <p className="text-sm text-gray-500 mt-1">
            Log some waste first, then we'll suggest ways to reuse it.
          </p>
        </div>
      )}

      {/* Initial empty state */}
      {!hasGenerated && !loading && (
        <div className="text-center py-12">
          <Lightbulb className="size-10 mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400 font-medium">Ready for suggestions?</p>
          <p className="text-sm text-gray-500 mt-1">
            Click the button above to get AI-powered reuse ideas based on your waste logs.
          </p>
        </div>
      )}

      {/* Suggestion cards */}
      {suggestions.length > 0 && (
        <div className="space-y-4">
          {suggestions.map((s) => (
            <div
              key={s.id}
              className="bg-gray-800 rounded-xl p-5 border border-gray-700"
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-white font-medium">{s.ingredientName}</h3>
                    <span className="text-xs text-gray-400">({s.quantityWasted})</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                        TYPE_BADGE_STYLES[s.type] || TYPE_BADGE_STYLES.Recipe
                      }`}
                    >
                      {s.type}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleDismiss(s.id)}
                  className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0"
                  title="Dismiss"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Suggestion text */}
              <p className="text-sm text-gray-300 leading-relaxed mb-4">{s.suggestion}</p>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => handleGenerateRecipe(s.ingredientName)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 text-sm font-medium rounded-lg transition-colors border border-amber-600/30 min-h-[44px]"
                >
                  <ChefHat className="size-4" />
                  Generate Recipe
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

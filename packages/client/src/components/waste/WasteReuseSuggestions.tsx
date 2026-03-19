/**
 * @module components/waste/WasteReuseSuggestions
 *
 * AI-powered reuse suggestions based on recent waste logs.
 * Fetches suggestions from POST /api/waste/reuse,
 * displays them as cards with color-coded type badges, and offers a
 * "Generate Recipe" shortcut to the Recipe Lab via URL params.
 * Includes Save for Later toggle (local state for MVP).
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import { Loader2, Lightbulb, Sparkles, ChefHat, Trash2, Bookmark, BookmarkCheck } from "lucide-react";

interface ReuseSuggestion {
  id: string;
  ingredientName: string;
  quantityWasted: number;
  suggestion: string;
  type: string;
}

const TYPE_BADGE_STYLES: Record<string, string> = {
  recipe: "bg-[#D4A574]/20 text-[#D4A574] border-[#D4A574]/30",
  stock: "bg-blue-600/20 text-blue-400 border-blue-600/30",
  special: "bg-purple-600/20 text-purple-400 border-purple-600/30",
  "staff meal": "bg-emerald-600/20 text-emerald-400 border-emerald-600/30",
};

const TYPE_LABELS: Record<string, string> = {
  recipe: "Recipe",
  stock: "Stock",
  special: "Special",
  "staff meal": "Staff Meal",
};

function getBadgeStyle(type: string): string {
  const key = type?.toLowerCase?.() ?? "";
  return TYPE_BADGE_STYLES[key] ?? TYPE_BADGE_STYLES.recipe;
}

function getTypeLabel(type: string): string {
  const key = type?.toLowerCase?.() ?? "";
  return TYPE_LABELS[key] ?? type ?? "Recipe";
}

export function WasteReuseSuggestions() {
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<ReuseSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

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
      setSuggestions(data?.suggestions ?? []);
      setHasGenerated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate suggestions");
    } finally {
      setLoading(false);
    }
  }

  function handleDismiss(id: string) {
    setSuggestions((prev) => prev.filter((s) => s?.id !== id));
    setSavedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function toggleSave(id: string) {
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleGenerateRecipe(ingredientName: string) {
    const params = new URLSearchParams({ prefill: ingredientName });
    navigate(`/recipes?${params.toString()}`);
  }

  return (
    <div>
      {/* Generate button */}
      <div className="text-center mb-8">
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="inline-flex items-center gap-2 px-6 py-3 bg-[#D4A574] hover:bg-[#C4956A] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors min-h-[48px]"
        >
          {loading ? (
            <>
              <Loader2 className="size-5 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="size-5" />
              Generate Reuse Suggestions
            </>
          )}
        </button>
        <p className="text-xs text-[#666666] mt-2">
          AI analyzes your recent waste logs and suggests ways to reuse ingredients.
        </p>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="text-center py-12">
          <Loader2 className="size-10 mx-auto text-[#D4A574] animate-spin mb-4" />
          <p className="text-[#E5E5E5] font-medium">Our AI chef is thinking of ways to reduce your waste...</p>
          <p className="text-xs text-[#666666] mt-1">This usually takes a few seconds.</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Empty state — generated but nothing */}
      {hasGenerated && !loading && suggestions.length === 0 && (
        <div className="text-center py-12">
          <Trash2 className="size-10 mx-auto text-[#666666] mb-3" />
          <p className="text-[#999999] font-medium">No suggestions yet</p>
          <p className="text-sm text-[#666666] mt-1">
            Log some waste first, then we&apos;ll suggest creative ways to reuse ingredients and save money.
          </p>
        </div>
      )}

      {/* Initial empty state */}
      {!hasGenerated && !loading && (
        <div className="text-center py-12">
          <Lightbulb className="size-10 mx-auto text-[#666666] mb-3" />
          <p className="text-[#999999] font-medium">Ready for suggestions?</p>
          <p className="text-sm text-[#666666] mt-1">
            Click the button above to get AI-powered reuse ideas based on your waste logs.
          </p>
        </div>
      )}

      {/* Suggestion cards */}
      {!loading && suggestions.length > 0 && (
        <div className="space-y-4">
          {suggestions.map((s) => {
            const isSaved = savedIds.has(s?.id);
            return (
              <div
                key={s?.id}
                className="bg-[#161616] rounded-xl p-5 border border-[#2A2A2A]"
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-white font-medium">{s?.ingredientName ?? "Unknown"}</h3>
                      <span className="text-xs text-[#999999]">
                        {Number(s?.quantityWasted ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg wasted this week
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border font-medium ${getBadgeStyle(s?.type)}`}
                      >
                        {getTypeLabel(s?.type)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Suggestion text */}
                <p className="text-sm text-[#E5E5E5] leading-relaxed mb-4">{s?.suggestion}</p>

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleGenerateRecipe(s?.ingredientName ?? "")}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#D4A574]/20 hover:bg-[#D4A574]/30 text-[#D4A574] text-sm font-medium rounded-lg transition-colors border border-[#D4A574]/30 min-h-[44px]"
                  >
                    <ChefHat className="size-4" />
                    Generate Recipe
                  </button>
                  <button
                    onClick={() => toggleSave(s?.id)}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors border min-h-[44px] ${
                      isSaved
                        ? "bg-emerald-600/20 text-emerald-400 border-emerald-600/30 hover:bg-emerald-600/30"
                        : "bg-[#1E1E1E]/50 text-[#999999] border-[#2A2A2A] hover:bg-[#1E1E1E] hover:text-[#E5E5E5]"
                    }`}
                  >
                    {isSaved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
                    {isSaved ? "Saved" : "Save for Later"}
                  </button>
                  <button
                    onClick={() => handleDismiss(s?.id)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1E1E1E]/50 hover:bg-[#1E1E1E] text-[#666666] hover:text-[#E5E5E5] text-sm font-medium rounded-lg transition-colors border border-[#2A2A2A] min-h-[44px]"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

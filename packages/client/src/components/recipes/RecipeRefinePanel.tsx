/**
 * @module components/recipes/RecipeRefinePanel
 *
 * Modal overlay for AI-powered recipe refinement.
 * User types an instruction, AI refines the recipe, then user can
 * accept or retry.
 */

import { useState, useCallback } from "react";
import { X, Sparkles, Loader2, Check, RotateCcw } from "lucide-react";

interface RecipeRefinePanelProps {
  recipeId: string;
  recipeData: unknown;
  onAccept: (refinedData: unknown) => void;
  onClose: () => void;
}

interface RefinementResult {
  refinedData: unknown;
  changeSummary: string;
}

const QUICK_SUGGESTIONS = [
  "Make dairy-free",
  "Scale to 50 portions",
  "Reduce food cost",
  "Simplify technique",
  "Make gluten-free",
  "Add vegetarian option",
];

const INPUT_CLS =
  "w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl px-4 py-3 text-white placeholder-[#444444] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 transition-shadow text-sm";

export function RecipeRefinePanel({
  recipeId,
  recipeData: _recipeData,
  onAccept,
  onClose,
}: RecipeRefinePanelProps) {
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RefinementResult | null>(null);
  const [accepting, setAccepting] = useState(false);

  const handleRefine = useCallback(async () => {
    if (!instruction.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/api/recipes/${recipeId}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ instruction: instruction.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? `Refinement failed (${res.status})`,
        );
      }

      const data = (await res.json()) as RefinementResult;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [instruction, recipeId]);

  const handleAccept = useCallback(async () => {
    if (!result) return;
    setAccepting(true);
    setError(null);

    try {
      const res = await fetch(`/api/recipes/${recipeId}/accept-refinement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          recipeData: result.refinedData,
          changeSummary: result.changeSummary,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? `Accept failed (${res.status})`,
        );
      }

      onAccept(result.refinedData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAccepting(false);
    }
  }, [result, recipeId, onAccept]);

  const handleTryAgain = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#161616] rounded-2xl border border-[#2A2A2A] max-w-2xl w-full mx-auto p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-[#D4A574]/10 flex items-center justify-center">
              <Sparkles className="size-5 text-[#D4A574]" />
            </div>
            <h2 className="text-xl font-semibold text-[#FAFAFA]">
              Refine Recipe with AI
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#666666] hover:text-white transition-colors p-1"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Input phase */}
        {!result && !loading && (
          <>
            <div className="mb-4">
              <label className="block text-xs font-medium text-[#999999] mb-1.5">
                What would you like to change?
              </label>
              <input
                className={INPUT_CLS}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="e.g. Make this recipe suitable for a vegan menu..."
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleRefine();
                  }
                }}
                autoFocus
              />
            </div>

            {/* Quick suggestions */}
            <div className="flex flex-wrap gap-2 mb-6">
              {QUICK_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setInstruction(suggestion)}
                  className="px-3 py-1.5 text-xs font-medium text-[#D4A574] bg-[#D4A574]/10 border border-[#D4A574]/20 rounded-full hover:bg-[#D4A574]/20 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            {error && (
              <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <button
              onClick={handleRefine}
              disabled={!instruction.trim()}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold bg-[#D4A574] hover:bg-[#C4956A] text-[#0A0A0A] rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Sparkles className="size-4" />
              Refine
            </button>
          </>
        )}

        {/* Loading phase */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="size-8 animate-spin text-[#D4A574]" />
            <p className="text-sm text-[#999999]">
              AI is refining your recipe...
            </p>
          </div>
        )}

        {/* Result phase */}
        {result && !loading && (
          <>
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-[#FAFAFA] mb-2">
                Changes Summary
              </h3>
              <div className="bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl p-4">
                <p className="text-sm text-[#E5E5E5] leading-relaxed whitespace-pre-line">
                  {result.changeSummary}
                </p>
              </div>
            </div>

            {error && (
              <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-5 py-3 text-sm text-[#999999] hover:text-white transition-colors rounded-xl"
              >
                Cancel
              </button>
              <div className="flex-1" />
              <button
                onClick={handleTryAgain}
                className="flex items-center gap-2 px-5 py-3 text-sm font-medium text-[#D4A574] border border-[#D4A574]/30 hover:border-[#D4A574]/60 hover:bg-[#D4A574]/10 rounded-xl transition-colors"
              >
                <RotateCcw className="size-4" />
                Try Again
              </button>
              <button
                onClick={handleAccept}
                disabled={accepting}
                className="flex items-center gap-2 px-6 py-3 text-sm font-semibold bg-[#D4A574] hover:bg-[#C4956A] text-[#0A0A0A] rounded-xl transition-colors disabled:opacity-50"
              >
                {accepting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                Accept Changes
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

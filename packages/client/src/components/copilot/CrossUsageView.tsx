/**
 * @module components/copilot/CrossUsageView
 *
 * Cross-Usage tab — shows ingredients ranked by how many dishes use them.
 * Expandable rows reveal which dishes reference each ingredient.
 */

import { useState, useEffect, useCallback } from "react";
import { Loader2, ChevronDown, ChevronRight, Layers } from "lucide-react";

interface CrossUsageItem {
  ingredientName: string;
  dishCount: number;
  totalQuantity: number;
  unit: string;
  dishes: string[];
}

interface Props {
  sessionId: string | null;
}

export function CrossUsageView({ sessionId }: Props) {
  const [data, setData] = useState<CrossUsageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/prep/cross-usage/${sessionId}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `Failed (${res.status})`);
      }
      const json = await res.json();
      setData(Array.isArray(json) ? json : json.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cross-usage data");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Empty state — no session
  if (!sessionId) {
    return (
      <div className="text-center py-16">
        <Layers className="size-10 mx-auto text-[#666666] mb-3" />
        <p className="text-[#999999]">Create a prep session first to see cross-usage data.</p>
      </div>
    );
  }

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

  // Empty data
  if (data.length === 0) {
    return (
      <div className="text-center py-16">
        <Layers className="size-10 mx-auto text-[#666666] mb-3" />
        <p className="text-[#999999]">No cross-usage data for this session.</p>
        <p className="text-sm text-[#666666] mt-1">Tasks need multiple dishes sharing ingredients.</p>
      </div>
    );
  }

  const maxDishCount = Math.max(...data.map((d) => d.dishCount), 1);

  return (
    <div>
      <p className="text-sm text-[#666666] mb-4">
        Ingredients ranked by the number of dishes that use them. Prep these once, use everywhere.
      </p>

      <div className="space-y-3">
        {data.map((item) => {
          const isExpanded = expanded.has(item.ingredientName);
          const highlight = item.dishCount >= 3;
          const barWidth = Math.max((item.dishCount / maxDishCount) * 100, 4);

          return (
            <div
              key={item.ingredientName}
              className={`rounded-lg border border-[#2A2A2A] overflow-hidden ${
                highlight ? "bg-[#D4A574]/10" : "bg-[#161616]"
              }`}
            >
              {/* Row */}
              <button
                onClick={() => toggleExpand(item.ingredientName)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-[#1E1E1E]/50 transition-colors min-h-[44px]"
              >
                {isExpanded ? (
                  <ChevronDown className="size-4 text-[#666666] shrink-0" />
                ) : (
                  <ChevronRight className="size-4 text-[#666666] shrink-0" />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-medium text-white truncate mr-2">
                      {item.ingredientName}
                    </span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs bg-[#D4A574]/80 text-white px-2 py-0.5 rounded-full font-medium">
                        {item.dishCount} {item.dishCount === 1 ? "dish" : "dishes"}
                      </span>
                      <span className="text-sm text-[#999999]">
                        {item.totalQuantity} {item.unit}
                      </span>
                    </div>
                  </div>
                  {/* Bar */}
                  <div className="w-full bg-[#1E1E1E] rounded-full h-2">
                    <div
                      className="h-2 rounded-full bg-[#D4A574]/100 transition-all duration-500"
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              </button>

              {/* Expanded dish list */}
              {isExpanded && item.dishes?.length > 0 && (
                <div className="px-4 pb-4 pl-11">
                  <p className="text-xs text-[#666666] uppercase tracking-wider mb-2">Used in:</p>
                  <ul className="space-y-1">
                    {item.dishes.map((dish) => (
                      <li key={dish} className="text-sm text-[#E5E5E5] flex items-center gap-2">
                        <span className="size-1.5 rounded-full bg-[#D4A574]/100 shrink-0" />
                        {dish}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * @module components/menu/CategorySettings
 *
 * Category-level food cost targets.
 * Shows each category with editable target %, actual %, and
 * items that exceed the target.
 */

import { useState, useEffect, useMemo } from "react";
import {
  Save,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Settings2,
} from "lucide-react";
import type { MenuItem } from "../../hooks/useMenuItems.js";

const API = import.meta.env.VITE_API_URL ?? "";

interface CategorySettingsProps {
  categories: string[];
  items: MenuItem[];
}

interface CategorySetting {
  categoryName: string;
  targetFoodCostPct: string;
}

export function CategorySettings({
  categories,
  items,
}: CategorySettingsProps) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Fetch saved settings
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/menu/categories`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const data: CategorySetting[] = await res.json();
        const map: Record<string, string> = {};
        for (const s of data) map[s.categoryName] = s.targetFoodCostPct;
        setSettings(map);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Compute actual food cost % per category
  const categoryActuals = useMemo(() => {
    const result: Record<string, number> = {};
    for (const cat of categories) {
      const catItems = items.filter((i) => i.category === cat);
      if (catItems.length === 0) {
        result[cat] = 0;
        continue;
      }
      const avg =
        catItems.reduce((sum, i) => sum + i.foodCostPct, 0) / catItems.length;
      result[cat] = avg;
    }
    return result;
  }, [categories, items]);

  // Items exceeding target per category
  const exceedingItems = useMemo(() => {
    const result: Record<string, MenuItem[]> = {};
    for (const cat of categories) {
      const target = parseFloat(settings[cat] ?? "30");
      result[cat] = items.filter(
        (i) => i.category === cat && i.foodCostPct > target
      );
    }
    return result;
  }, [categories, items, settings]);

  async function handleSave(categoryName: string) {
    const val = settings[categoryName] ?? "30";
    setSaving(categoryName);
    setError("");
    try {
      const res = await fetch(
        `${API}/api/menu/categories/${encodeURIComponent(categoryName)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ targetFoodCostPct: val }),
        }
      );
      if (!res.ok) throw new Error("Failed to save");
    } catch {
      setError(`Failed to save ${categoryName} settings.`);
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-[#D4A574]" />
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="bg-[#161616] rounded-2xl border border-[#2A2A2A] p-12 text-center">
        <Settings2 className="size-12 mx-auto mb-4 text-[#333333]" />
        <h3 className="text-lg font-semibold text-[#FAFAFA] mb-2">
          No categories yet
        </h3>
        <p className="text-sm text-[#666666] max-w-md mx-auto">
          Add menu items to create categories. You can then set food cost
          targets for each category.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="bg-[#161616] rounded-2xl border border-[#2A2A2A] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#2A2A2A]">
          <h3 className="text-sm font-semibold text-[#FAFAFA]">
            Category Food Cost Targets
          </h3>
          <p className="text-xs text-[#666666] mt-1">
            Set your target food cost percentage for each menu category. Items
            exceeding the target will be flagged in the Menu Items table.
          </p>
        </div>

        <div className="divide-y divide-[#2A2A2A]/50">
          {categories.map((cat) => {
            const actual = categoryActuals[cat] ?? 0;
            const target = parseFloat(settings[cat] ?? "30");
            const exceeding = exceedingItems[cat] ?? [];
            const isExpanded = expanded === cat;
            const isOverTarget = actual > target;

            return (
              <div key={cat}>
                <div className="px-6 py-4 flex items-center gap-4">
                  {/* Category name */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#FAFAFA] truncate">
                      {cat}
                    </p>
                    <p className="text-xs text-[#666666]">
                      {items.filter((i) => i.category === cat).length} items
                    </p>
                  </div>

                  {/* Target input */}
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-[#666666]">Target:</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="100"
                      value={settings[cat] ?? "30"}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          [cat]: e.target.value,
                        }))
                      }
                      className="w-16 px-2 py-1.5 text-sm bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg text-[#FAFAFA] text-right focus:outline-none focus:ring-1 focus:ring-[#D4A574]/50 min-h-[36px]"
                    />
                    <span className="text-xs text-[#666666]">%</span>
                  </div>

                  {/* Actual % */}
                  <div className="text-right w-20">
                    <p className="text-xs text-[#666666]">Actual:</p>
                    <p
                      className={`text-sm font-semibold ${
                        isOverTarget ? "text-red-400" : "text-green-400"
                      }`}
                    >
                      {actual.toFixed(1)}%
                    </p>
                  </div>

                  {/* Save button */}
                  <button
                    onClick={() => handleSave(cat)}
                    disabled={saving === cat}
                    className="p-2 rounded-lg text-[#D4A574] hover:bg-[#D4A574]/10 disabled:opacity-50 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                    title="Save target"
                  >
                    {saving === cat ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Save className="size-4" />
                    )}
                  </button>

                  {/* Expand exceeding items */}
                  {exceeding.length > 0 && (
                    <button
                      onClick={() =>
                        setExpanded(isExpanded ? null : cat)
                      }
                      className="flex items-center gap-1 px-2 py-1.5 text-xs text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20 transition-colors min-h-[36px]"
                    >
                      <AlertTriangle className="size-3" />
                      {exceeding.length}
                      {isExpanded ? (
                        <ChevronUp className="size-3" />
                      ) : (
                        <ChevronDown className="size-3" />
                      )}
                    </button>
                  )}
                </div>

                {/* Exceeding items list */}
                {isExpanded && exceeding.length > 0 && (
                  <div className="px-6 pb-4">
                    <div className="bg-[#0A0A0A] rounded-xl border border-red-500/10 p-3 space-y-1.5">
                      <p className="text-[10px] uppercase text-red-400 font-medium mb-2">
                        Items exceeding {target}% target
                      </p>
                      {exceeding.map((item) => (
                        <div
                          key={item.menuItemId}
                          className="flex items-center justify-between text-xs"
                        >
                          <span className="text-[#FAFAFA]">{item.name}</span>
                          <span className="text-red-400 font-medium">
                            {item.foodCostPct.toFixed(1)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

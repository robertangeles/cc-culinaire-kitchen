/**
 * Configure target food cost percentage per menu category.
 */

import { useState, useEffect } from "react";
import { Loader2, Save } from "lucide-react";

const API = import.meta.env.VITE_API_URL ?? "";

interface CategorySetting {
  categoryName: string;
  targetFoodCostPct: string;
}

interface MenuCategorySettingsProps {
  categories: string[];
}

export function MenuCategorySettings({ categories }: MenuCategorySettingsProps) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API}/api/menu/categories`, { credentials: "include" });
        if (!res.ok) return;
        const data: CategorySetting[] = await res.json();
        const map: Record<string, string> = {};
        for (const s of data) map[s.categoryName] = s.targetFoodCostPct;
        setSettings(map);
      } catch {
        // silent
      }
    }
    load();
  }, []);

  async function handleSave(categoryName: string) {
    const val = settings[categoryName] ?? "30";
    setSaving(categoryName);
    try {
      await fetch(`${API}/api/menu/categories/${encodeURIComponent(categoryName)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetFoodCostPct: val }),
      });
    } catch {
      // silent
    } finally {
      setSaving(null);
    }
  }

  if (categories.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4">
      <h3 className="text-sm font-semibold text-stone-800 mb-2">Category Food Cost Targets</h3>
      <p className="text-xs text-stone-500 mb-3">
        Set your target food cost percentage for each menu category. Items exceeding the target will be flagged.
      </p>
      <div className="space-y-2">
        {categories.map((cat) => (
          <div key={cat} className="flex items-center gap-3">
            <span className="text-sm text-stone-700 w-32 truncate">{cat}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.5"
                min="0"
                max="100"
                value={settings[cat] ?? "30"}
                onChange={(e) => setSettings((prev) => ({ ...prev, [cat]: e.target.value }))}
                className="w-20 px-2 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 text-right"
              />
              <span className="text-sm text-stone-400">%</span>
            </div>
            <button
              onClick={() => handleSave(cat)}
              disabled={saving === cat}
              className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 disabled:opacity-50 transition-colors"
            >
              {saving === cat ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

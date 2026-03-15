/**
 * @module components/profile/MyKitchenTab
 *
 * Inline settings form for the user's kitchen profile.
 * Shown in Profile → My Kitchen tab.
 *
 * Fetches the current kitchen_profile on mount and lets users
 * edit all fields at once (vs the step-by-step KitchenWizard modal).
 */

import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, AlertCircle, Save } from "lucide-react";
import { usePersonalisationOptions } from "../../hooks/usePersonalisationOptions.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KitchenProfile {
  skillLevel: string;
  cuisinePreferences: string[];
  dietaryRestrictions: string[];
  kitchenEquipment: string[];
  servingsDefault: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MyKitchenTab() {
  const { options, loading: optionsLoading } = usePersonalisationOptions();

  const skillLevels   = options?.skill_level ?? [];
  const cuisineOpts   = options?.cuisine     ?? [];
  const dietaryOpts   = options?.dietary     ?? [];
  const equipmentOpts = options?.equipment   ?? [];

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const [form, setForm] = useState<KitchenProfile>({
    skillLevel: "home_cook",
    cuisinePreferences: [],
    dietaryRestrictions: [],
    kitchenEquipment: [],
    servingsDefault: 4,
  });

  // Fetch on mount
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/users/kitchen-profile", { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load kitchen profile");
        const data = await res.json();
        setForm({
          skillLevel: data.skillLevel ?? "home_cook",
          cuisinePreferences: data.cuisinePreferences ?? [],
          dietaryRestrictions: data.dietaryRestrictions ?? [],
          kitchenEquipment: data.kitchenEquipment ?? [],
          servingsDefault: data.servingsDefault ?? 4,
        });
      } catch {
        // Use defaults — don't block the tab
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function toggleChip(field: "cuisinePreferences" | "dietaryRestrictions" | "kitchenEquipment", value: string) {
    setForm((prev) => {
      const current = prev[field];
      return {
        ...prev,
        [field]: current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value],
      };
    });
  }

  async function handleSave() {
    setSaving(true);
    setSuccessMsg("");
    setErrorMsg("");
    try {
      const res = await fetch("/api/users/kitchen-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to save");
      }
      setSuccessMsg("Kitchen profile saved.");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save kitchen profile.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || optionsLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-stone-400">
        <Loader2 className="size-5 animate-spin mr-2" />
        Loading kitchen profile…
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-6">
      <div>
        <h2 className="text-base font-semibold text-stone-800">My Kitchen</h2>
        <p className="text-sm text-stone-500 mt-1">
          Personalise your AI culinary assistant. These preferences are injected into every conversation.
        </p>
      </div>

      {/* Status messages */}
      {successMsg && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <CheckCircle2 className="size-4 flex-shrink-0" /> {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="size-4 flex-shrink-0" /> {errorMsg}
        </div>
      )}

      {/* Skill Level */}
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-2">Skill Level</label>
        <div className="space-y-2">
          {skillLevels.map((level) => (
            <button
              key={level.optionValue}
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, skillLevel: level.optionValue }))}
              className={`w-full flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                form.skillLevel === level.optionValue
                  ? "border-amber-500 bg-amber-50"
                  : "border-stone-200 bg-white hover:bg-stone-50"
              }`}
            >
              <span className={`mt-0.5 size-4 flex-shrink-0 rounded-full border-2 flex items-center justify-center ${
                form.skillLevel === level.optionValue ? "border-amber-500" : "border-stone-300"
              }`}>
                {form.skillLevel === level.optionValue && (
                  <span className="size-2 rounded-full bg-amber-500" />
                )}
              </span>
              <span>
                <span className="text-sm font-medium text-stone-800">{level.optionLabel}</span>
                {level.optionDescription && (
                  <span className="text-xs text-stone-500 block">{level.optionDescription}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Cuisine Preferences */}
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-2">
          Cuisine Preferences
          <span className="text-stone-400 font-normal ml-1">(select all that apply)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {cuisineOpts.map((opt) => (
            <button
              key={opt.optionValue}
              type="button"
              onClick={() => toggleChip("cuisinePreferences", opt.optionLabel)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                form.cuisinePreferences.includes(opt.optionLabel)
                  ? "bg-amber-600 text-white border-amber-600"
                  : "bg-white text-stone-600 border-stone-300 hover:border-amber-400"
              }`}
            >
              {opt.optionLabel}
            </button>
          ))}
        </div>
      </div>

      {/* Dietary Restrictions */}
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-2">
          Dietary Restrictions
          <span className="text-stone-400 font-normal ml-1">(always respect in responses)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {dietaryOpts.map((opt) => (
            <button
              key={opt.optionValue}
              type="button"
              onClick={() => toggleChip("dietaryRestrictions", opt.optionLabel)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                form.dietaryRestrictions.includes(opt.optionLabel)
                  ? "bg-amber-600 text-white border-amber-600"
                  : "bg-white text-stone-600 border-stone-300 hover:border-amber-400"
              }`}
            >
              {opt.optionLabel}
            </button>
          ))}
        </div>
      </div>

      {/* Kitchen Equipment */}
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-2">
          Kitchen Equipment
          <span className="text-stone-400 font-normal ml-1">(what you have available)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {equipmentOpts.map((opt) => (
            <button
              key={opt.optionValue}
              type="button"
              onClick={() => toggleChip("kitchenEquipment", opt.optionLabel)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                form.kitchenEquipment.includes(opt.optionLabel)
                  ? "bg-amber-600 text-white border-amber-600"
                  : "bg-white text-stone-600 border-stone-300 hover:border-amber-400"
              }`}
            >
              {opt.optionLabel}
            </button>
          ))}
        </div>
      </div>

      {/* Default Servings */}
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">Default Servings</label>
        <p className="text-xs text-stone-400 mb-2">How many portions should recipes default to?</p>
        <input
          type="number"
          min={1}
          max={100}
          value={form.servingsDefault}
          onChange={(e) => setForm((prev) => ({ ...prev, servingsDefault: Math.max(1, Math.min(100, parseInt(e.target.value) || 1)) }))}
          className="w-24 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
        />
      </div>

      {/* Save button */}
      <div className="flex justify-end pt-2 border-t border-stone-100">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save Kitchen Profile
        </button>
      </div>
    </div>
  );
}

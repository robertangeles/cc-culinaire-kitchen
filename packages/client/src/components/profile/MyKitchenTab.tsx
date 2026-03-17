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
import { Loader2, CheckCircle2, AlertCircle, Save, ChevronDown, ChevronUp } from "lucide-react";
import { usePersonalisationOptions } from "../../hooks/usePersonalisationOptions.js";
import {
  ESTABLISHMENT_TYPES,
  PRICE_POINTS,
  PLATING_STYLES,
  SOURCING_VALUES,
  KITCHEN_CONSTRAINTS_OPTIONS,
  MENU_NEEDS,
  type ProfileOption,
} from "@culinaire/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KitchenProfileForm {
  skillLevel: string;
  cuisinePreferences: string[];
  dietaryRestrictions: string[];
  kitchenEquipment: string[];
  servingsDefault: number;
  // Restaurant / business profile
  restaurantName: string;
  establishmentType: string;
  establishmentTypeOther: string; // local-only for "other" freeform
  cuisineIdentity: string;
  targetDiner: string;
  pricePoint: string;
  restaurantVoice: string;
  sourcingValues: string[];
  sourcingOther: string; // local-only for "other" freeform
  platingStyle: string;
  kitchenConstraints: string[];
  menuNeeds: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Chip multi-select from a ProfileOption[] list */
function ChipSelect({
  options,
  selected,
  onToggle,
  max,
}: {
  options: ProfileOption[];
  selected: string[];
  onToggle: (value: string) => void;
  max?: number;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const isSelected = selected.includes(opt.value);
        const atMax = max && !isSelected && selected.length >= max;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => !atMax && onToggle(opt.value)}
            disabled={!!atMax}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              isSelected
                ? "bg-amber-600 text-white border-amber-600"
                : atMax
                  ? "bg-stone-100 text-stone-400 border-stone-200 cursor-not-allowed"
                  : "bg-white text-stone-600 border-stone-300 hover:border-amber-400"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Radio-style single select from a ProfileOption[] list */
function RadioSelect({
  options,
  selected,
  onSelect,
}: {
  options: ProfileOption[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onSelect(selected === opt.value ? "" : opt.value)}
          className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
            selected === opt.value
              ? "bg-amber-600 text-white border-amber-600"
              : "bg-white text-stone-600 border-stone-300 hover:border-amber-400"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Text input with character counter */
function TextInputWithCounter({
  value,
  onChange,
  maxLength,
  placeholder,
  helperText,
}: {
  value: string;
  onChange: (val: string) => void;
  maxLength: number;
  placeholder?: string;
  helperText?: string;
}) {
  return (
    <div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
        placeholder={placeholder}
        className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
      />
      <div className="flex justify-between mt-1">
        {helperText && <p className="text-xs text-stone-400 italic">{helperText}</p>}
        <span className={`text-xs ml-auto ${value.length > maxLength * 0.9 ? "text-amber-600" : "text-stone-400"}`}>
          {value.length}/{maxLength}
        </span>
      </div>
    </div>
  );
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
  const [restaurantOpen, setRestaurantOpen] = useState(false);

  const [form, setForm] = useState<KitchenProfileForm>({
    skillLevel: "home_cook",
    cuisinePreferences: [],
    dietaryRestrictions: [],
    kitchenEquipment: [],
    servingsDefault: 4,
    restaurantName: "",
    establishmentType: "",
    establishmentTypeOther: "",
    cuisineIdentity: "",
    targetDiner: "",
    pricePoint: "",
    restaurantVoice: "",
    sourcingValues: [],
    sourcingOther: "",
    platingStyle: "",
    kitchenConstraints: [],
    menuNeeds: [],
  });

  // Fetch on mount
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/users/kitchen-profile", { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load kitchen profile");
        const data = await res.json();

        // Check if establishment type is a custom "other" value
        const knownEstTypes = ESTABLISHMENT_TYPES.map((o) => o.value);
        const estType = data.establishmentType ?? "";
        const isOtherEst = estType && !knownEstTypes.includes(estType);

        // Check if sourcing has custom "other" values
        const knownSourcingVals = SOURCING_VALUES.map((o) => o.value);
        const sourcingArr = (data.sourcingValues ?? []) as string[];
        const otherSourcing = sourcingArr.filter((v) => !knownSourcingVals.includes(v));
        const knownSourcing = sourcingArr.filter((v) => knownSourcingVals.includes(v));

        setForm({
          skillLevel: data.skillLevel ?? "home_cook",
          cuisinePreferences: data.cuisinePreferences ?? [],
          dietaryRestrictions: data.dietaryRestrictions ?? [],
          kitchenEquipment: data.kitchenEquipment ?? [],
          servingsDefault: data.servingsDefault ?? 4,
          restaurantName: data.restaurantName ?? "",
          establishmentType: isOtherEst ? "other" : estType,
          establishmentTypeOther: isOtherEst ? estType : "",
          cuisineIdentity: data.cuisineIdentity ?? "",
          targetDiner: data.targetDiner ?? "",
          pricePoint: data.pricePoint ?? "",
          restaurantVoice: data.restaurantVoice ?? "",
          sourcingValues: knownSourcing,
          sourcingOther: otherSourcing.join(", "),
          platingStyle: data.platingStyle ?? "",
          kitchenConstraints: data.kitchenConstraints ?? [],
          menuNeeds: data.menuNeeds ?? [],
        });

        // Auto-expand restaurant section if any restaurant fields are populated
        const hasRestaurantData = data.restaurantName || data.establishmentType || data.cuisineIdentity ||
          data.targetDiner || data.pricePoint || data.restaurantVoice ||
          (data.sourcingValues?.length > 0) || data.platingStyle ||
          (data.kitchenConstraints?.length > 0) || (data.menuNeeds?.length > 0);
        if (hasRestaurantData) setRestaurantOpen(true);
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

  function toggleArrayField(field: "sourcingValues" | "kitchenConstraints" | "menuNeeds", value: string) {
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
      // Build payload — resolve "other" freeform values
      const establishmentType = form.establishmentType === "other" && form.establishmentTypeOther.trim()
        ? form.establishmentTypeOther.trim()
        : form.establishmentType || null;

      const sourcingValues = [...form.sourcingValues];
      if (form.sourcingOther.trim()) {
        sourcingValues.push(form.sourcingOther.trim());
      }

      const payload = {
        skillLevel: form.skillLevel,
        cuisinePreferences: form.cuisinePreferences,
        dietaryRestrictions: form.dietaryRestrictions,
        kitchenEquipment: form.kitchenEquipment,
        servingsDefault: form.servingsDefault,
        restaurantName: form.restaurantName || null,
        establishmentType: establishmentType,
        cuisineIdentity: form.cuisineIdentity || null,
        targetDiner: form.targetDiner || null,
        pricePoint: form.pricePoint || null,
        restaurantVoice: form.restaurantVoice || null,
        sourcingValues,
        platingStyle: form.platingStyle || null,
        kitchenConstraints: form.kitchenConstraints,
        menuNeeds: form.menuNeeds,
      };

      const res = await fetch("/api/users/kitchen-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
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

      {/* ─── Restaurant / Business Profile ─────────────────────── */}
      <div className="border-t border-stone-200 pt-4">
        <button
          type="button"
          onClick={() => setRestaurantOpen(!restaurantOpen)}
          className="w-full flex items-center justify-between text-left"
        >
          <div>
            <h3 className="text-base font-semibold text-stone-800">Restaurant / Business Profile</h3>
            <p className="text-xs text-stone-500 mt-0.5">
              These details shape how CulinAIre generates recipes for your kitchen — from ingredient choices and plating style to the tone of descriptions and menu copy.
            </p>
          </div>
          {restaurantOpen ? (
            <ChevronUp className="size-5 text-stone-400 flex-shrink-0 ml-2" />
          ) : (
            <ChevronDown className="size-5 text-stone-400 flex-shrink-0 ml-2" />
          )}
        </button>

        {restaurantOpen && (
          <div className="mt-4 space-y-5">
            {/* Restaurant Name */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Restaurant or Business Name
              </label>
              <TextInputWithCounter
                value={form.restaurantName}
                onChange={(v) => setForm((prev) => ({ ...prev, restaurantName: v }))}
                maxLength={200}
                placeholder="e.g., The Blue Knife, Sourdough & Co."
                helperText="For students: your training venue or the concept you're developing"
              />
            </div>

            {/* Establishment Type */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-2">
                Type of Establishment
              </label>
              <RadioSelect
                options={ESTABLISHMENT_TYPES}
                selected={form.establishmentType}
                onSelect={(v) => setForm((prev) => ({ ...prev, establishmentType: v }))}
              />
              {form.establishmentType === "other" && (
                <input
                  type="text"
                  value={form.establishmentTypeOther}
                  onChange={(e) => setForm((prev) => ({ ...prev, establishmentTypeOther: e.target.value.slice(0, 50) }))}
                  placeholder="Describe your establishment type"
                  className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
              )}
            </div>

            {/* Cuisine Identity */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Cuisine Identity of Your Menu
              </label>
              <p className="text-xs text-stone-400 mb-2">
                Not your personal preference — this is how your menu is positioned.
              </p>
              <TextInputWithCounter
                value={form.cuisineIdentity}
                onChange={(v) => setForm((prev) => ({ ...prev, cuisineIdentity: v }))}
                maxLength={200}
                placeholder="e.g., Modern Australian with Japanese influence"
              />
            </div>

            {/* Target Diner */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Who is Your Target Diner?
              </label>
              <TextInputWithCounter
                value={form.targetDiner}
                onChange={(v) => setForm((prev) => ({ ...prev, targetDiner: v }))}
                maxLength={200}
                placeholder="e.g., Inner-city professionals aged 28-45 who eat out 3+ times per week"
              />
            </div>

            {/* Price Point */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-2">
                Average Price Point Per Main Course
              </label>
              <RadioSelect
                options={PRICE_POINTS}
                selected={form.pricePoint}
                onSelect={(v) => setForm((prev) => ({ ...prev, pricePoint: v }))}
              />
            </div>

            {/* Restaurant Voice */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Your Restaurant's Voice or Personality
              </label>
              <p className="text-xs text-stone-400 mb-2">
                This shapes the tone of recipe descriptions and menu copy we generate.
              </p>
              <TextInputWithCounter
                value={form.restaurantVoice}
                onChange={(v) => setForm((prev) => ({ ...prev, restaurantVoice: v }))}
                maxLength={200}
                placeholder="e.g., Relaxed but precise. No fuss, no pretension, nothing on the plate that doesn't earn its place."
              />
            </div>

            {/* Sourcing Values */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-2">
                Sourcing Values
                <span className="text-stone-400 font-normal ml-1">(optional)</span>
              </label>
              <ChipSelect
                options={SOURCING_VALUES.filter((o) => o.value !== "other")}
                selected={form.sourcingValues}
                onToggle={(v) => toggleArrayField("sourcingValues", v)}
              />
              <input
                type="text"
                value={form.sourcingOther}
                onChange={(e) => setForm((prev) => ({ ...prev, sourcingOther: e.target.value }))}
                placeholder="Other sourcing values (optional)"
                className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            {/* Plating Style */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-2">
                Plating Style That Fits Your Menu
              </label>
              <RadioSelect
                options={PLATING_STYLES}
                selected={form.platingStyle}
                onSelect={(v) => setForm((prev) => ({ ...prev, platingStyle: v }))}
              />
            </div>

            {/* Kitchen Constraints */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-2">
                Kitchen Constraints
                <span className="text-stone-400 font-normal ml-1">(optional)</span>
              </label>
              <ChipSelect
                options={KITCHEN_CONSTRAINTS_OPTIONS}
                selected={form.kitchenConstraints}
                onToggle={(v) => toggleArrayField("kitchenConstraints", v)}
              />
            </div>

            {/* Menu Needs */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-2">
                What Does Your Menu Need Right Now?
                <span className="text-stone-400 font-normal ml-1">(pick up to 3)</span>
              </label>
              <p className="text-xs text-stone-400 mb-2">
                This helps us prioritise the kinds of recipes we generate for you.
              </p>
              <ChipSelect
                options={MENU_NEEDS}
                selected={form.menuNeeds}
                onToggle={(v) => toggleArrayField("menuNeeds", v)}
                max={3}
              />
            </div>
          </div>
        )}
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

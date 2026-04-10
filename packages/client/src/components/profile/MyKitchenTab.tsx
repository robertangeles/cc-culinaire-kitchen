/**
 * @module components/profile/MyKitchenTab
 *
 * Inline settings form for the user's kitchen profile.
 * Shown in Profile → Profile tab (kitchen profile section).
 *
 * Organised into collapsible accordion sections to minimise scrolling.
 * Fetches the current kitchen_profile on mount and lets users
 * edit all fields at once (vs the step-by-step KitchenWizard modal).
 */

import { useState, useEffect, type ReactNode } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Save,
  ChevronRight,
  Sparkles,
  UtensilsCrossed,
  Building2,
  Leaf,
} from "lucide-react";
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
  restaurantName: string;
  establishmentType: string;
  establishmentTypeOther: string;
  cuisineIdentity: string;
  targetDiner: string;
  pricePoint: string;
  restaurantVoice: string;
  sourcingValues: string[];
  sourcingOther: string;
  platingStyle: string;
  kitchenConstraints: string[];
  menuNeeds: string[];
}

// ---------------------------------------------------------------------------
// Accordion Section
// ---------------------------------------------------------------------------

function AccordionSection({
  title,
  subtitle,
  icon: Icon,
  isOpen,
  onToggle,
  hasData,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  isOpen: boolean;
  onToggle: () => void;
  hasData: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border transition-all duration-300 ${
        isOpen
          ? "bg-[#161616]/80 backdrop-blur-sm border-[rgba(212,165,116,0.25)] shadow-[0_0_16px_rgba(212,165,116,0.06)]"
          : "bg-[#161616]/50 border-[#2A2A2A] hover:border-[#3A3A3A]"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left group"
      >
        <div
          className={`flex items-center justify-center size-9 rounded-xl transition-colors ${
            isOpen
              ? "bg-[#D4A574]/15 text-[#D4A574]"
              : "bg-[#2A2A2A] text-[#666666] group-hover:text-[#999999]"
          }`}
        >
          <Icon className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[#E5E5E5]">{title}</span>
            {hasData && !isOpen && (
              <span className="size-2 rounded-full bg-emerald-400 flex-shrink-0" />
            )}
          </div>
          <p className="text-xs text-[#666666] truncate">{subtitle}</p>
        </div>
        <ChevronRight
          className={`size-4 text-[#666666] transition-transform duration-300 flex-shrink-0 ${
            isOpen ? "rotate-90" : ""
          }`}
        />
      </button>

      {/* Animated content */}
      <div
        className={`grid transition-all duration-300 ease-in-out ${
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-5 pb-5 space-y-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chip Selects
// ---------------------------------------------------------------------------

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
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150 ${
              isSelected
                ? "bg-[#D4A574]/15 text-[#D4A574] border-[#D4A574]/30 shadow-[0_0_8px_rgba(212,165,116,0.1)]"
                : atMax
                  ? "bg-[#1E1E1E] text-[#444444] border-[#2A2A2A] cursor-not-allowed"
                  : "bg-[#1E1E1E] text-[#999999] border-[#2A2A2A] hover:border-[#3A3A3A] hover:text-[#E5E5E5]"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

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
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150 ${
            selected === opt.value
              ? "bg-[#D4A574]/15 text-[#D4A574] border-[#D4A574]/30 shadow-[0_0_8px_rgba(212,165,116,0.1)]"
              : "bg-[#1E1E1E] text-[#999999] border-[#2A2A2A] hover:border-[#3A3A3A] hover:text-[#E5E5E5]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

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
        className="w-full rounded-xl border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 text-sm text-[#E5E5E5] placeholder:text-[#444444] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent transition-shadow"
      />
      <div className="flex justify-between mt-1">
        {helperText && <p className="text-[10px] text-[#666666] italic">{helperText}</p>}
        <span
          className={`text-[10px] ml-auto ${
            value.length > maxLength * 0.9 ? "text-[#D4A574]" : "text-[#666666]"
          }`}
        >
          {value.length}/{maxLength}
        </span>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 text-sm text-[#E5E5E5] placeholder:text-[#444444] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent transition-shadow";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MyKitchenTab({ isOrgAdmin = false }: { isOrgAdmin?: boolean }) {
  const { options, loading: optionsLoading } = usePersonalisationOptions();

  const skillLevels = options?.skill_level ?? [];
  const cuisineOpts = options?.cuisine ?? [];
  const dietaryOpts = options?.dietary ?? [];
  const equipmentOpts = options?.equipment ?? [];

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Accordion state — track which sections are open
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  function toggleSection(id: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

        const knownEstTypes = ESTABLISHMENT_TYPES.map((o) => o.value);
        const estType = data.establishmentType ?? "";
        const isOtherEst = estType && !knownEstTypes.includes(estType);

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

        // All sections collapsed by default — green dots show which have data
        setOpenSections(new Set());
      } catch {
        // Use defaults
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function toggleChip(
    field: "cuisinePreferences" | "dietaryRestrictions" | "kitchenEquipment",
    value: string,
  ) {
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

  function toggleArrayField(
    field: "sourcingValues" | "kitchenConstraints" | "menuNeeds",
    value: string,
  ) {
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
      const establishmentType =
        form.establishmentType === "other" && form.establishmentTypeOther.trim()
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
        establishmentType,
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

  // Data checks for green dots
  const hasSkillData = form.cuisinePreferences.length > 0 || form.dietaryRestrictions.length > 0;
  const hasKitchenData = form.kitchenEquipment.length > 0 || form.kitchenConstraints.length > 0;
  const hasRestaurantData =
    !!form.restaurantName || !!form.establishmentType || !!form.cuisineIdentity;
  const hasMenuData =
    form.sourcingValues.length > 0 || !!form.platingStyle || form.menuNeeds.length > 0;

  if (loading || optionsLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-[#666666]">
        <Loader2 className="size-5 animate-spin mr-2" />
        Loading kitchen profile…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[#E5E5E5]">Kitchen Profile</h2>
          <p className="text-xs text-[#666666] mt-0.5">
            These preferences shape every AI conversation and recipe.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#0A0A0A] bg-[#D4A574] rounded-xl hover:bg-[#C4956A] disabled:opacity-50 disabled:cursor-not-allowed transition-all ${
            saving ? "" : "hover:shadow-[0_0_20px_rgba(212,165,116,0.2)]"
          }`}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save
        </button>
      </div>

      {/* Status messages */}
      {successMsg && (
        <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2 animate-[fadeIn_150ms_ease-out]">
          <CheckCircle2 className="size-4 flex-shrink-0" /> {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
          <AlertCircle className="size-4 flex-shrink-0" /> {errorMsg}
        </div>
      )}

      {/* ─── Section 1: Your Skill & Style ─────────────────────── */}
      <AccordionSection
        title="Your Skill & Style"
        subtitle="Skill level, cuisine preferences, dietary restrictions"
        icon={Sparkles}
        isOpen={openSections.has("skill")}
        onToggle={() => toggleSection("skill")}
        hasData={hasSkillData}
      >
        {/* Skill Level */}
        <div>
          <label className="block text-xs font-medium text-[#999999] uppercase tracking-wider mb-2">
            Skill Level
          </label>
          <div className="grid grid-cols-1 gap-1.5">
            {skillLevels.map((level) => (
              <button
                key={level.optionValue}
                type="button"
                onClick={() =>
                  setForm((prev) => ({ ...prev, skillLevel: level.optionValue }))
                }
                className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition-all duration-150 ${
                  form.skillLevel === level.optionValue
                    ? "border-[#D4A574]/30 bg-[#D4A574]/10 shadow-[0_0_12px_rgba(212,165,116,0.06)]"
                    : "border-[#2A2A2A] bg-[#0A0A0A] hover:border-[#3A3A3A]"
                }`}
              >
                <span
                  className={`size-4 flex-shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
                    form.skillLevel === level.optionValue
                      ? "border-[#D4A574]"
                      : "border-[#3A3A3A]"
                  }`}
                >
                  {form.skillLevel === level.optionValue && (
                    <span className="size-2 rounded-full bg-[#D4A574]" />
                  )}
                </span>
                <span>
                  <span className="text-sm font-medium text-[#E5E5E5]">
                    {level.optionLabel}
                  </span>
                  {level.optionDescription && (
                    <span className="text-xs text-[#666666] block">
                      {level.optionDescription}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>

        {isOrgAdmin && (
          <>
            {/* Cuisine Preferences */}
            <div>
              <label className="block text-xs font-medium text-[#999999] uppercase tracking-wider mb-2">
                Cuisine Preferences
              </label>
              <div className="flex flex-wrap gap-2">
                {cuisineOpts.map((opt) => (
                  <button
                    key={opt.optionValue}
                    type="button"
                    onClick={() => toggleChip("cuisinePreferences", opt.optionLabel)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150 ${
                      form.cuisinePreferences.includes(opt.optionLabel)
                        ? "bg-[#D4A574]/15 text-[#D4A574] border-[#D4A574]/30 shadow-[0_0_8px_rgba(212,165,116,0.1)]"
                        : "bg-[#1E1E1E] text-[#999999] border-[#2A2A2A] hover:border-[#3A3A3A] hover:text-[#E5E5E5]"
                    }`}
                  >
                    {opt.optionLabel}
                  </button>
                ))}
              </div>
            </div>

            {/* Dietary Restrictions */}
            <div>
              <label className="block text-xs font-medium text-[#999999] uppercase tracking-wider mb-2">
                Dietary Restrictions
              </label>
              <div className="flex flex-wrap gap-2">
                {dietaryOpts.map((opt) => (
                  <button
                    key={opt.optionValue}
                    type="button"
                    onClick={() => toggleChip("dietaryRestrictions", opt.optionLabel)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150 ${
                      form.dietaryRestrictions.includes(opt.optionLabel)
                        ? "bg-[#D4A574]/15 text-[#D4A574] border-[#D4A574]/30 shadow-[0_0_8px_rgba(212,165,116,0.1)]"
                        : "bg-[#1E1E1E] text-[#999999] border-[#2A2A2A] hover:border-[#3A3A3A] hover:text-[#E5E5E5]"
                    }`}
                  >
                    {opt.optionLabel}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </AccordionSection>

      {/* ─── Section 2: Your Kitchen (admin only) ────────────── */}
      {isOrgAdmin && (
        <AccordionSection
          title="Your Kitchen"
          subtitle="Equipment, default servings, constraints"
          icon={UtensilsCrossed}
          isOpen={openSections.has("kitchen")}
          onToggle={() => toggleSection("kitchen")}
          hasData={hasKitchenData}
        >
          {/* Kitchen Equipment */}
          <div>
            <label className="block text-xs font-medium text-[#999999] uppercase tracking-wider mb-2">
              Kitchen Equipment
            </label>
            <div className="flex flex-wrap gap-2">
              {equipmentOpts.map((opt) => (
                <button
                  key={opt.optionValue}
                  type="button"
                  onClick={() => toggleChip("kitchenEquipment", opt.optionLabel)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150 ${
                    form.kitchenEquipment.includes(opt.optionLabel)
                      ? "bg-[#D4A574]/15 text-[#D4A574] border-[#D4A574]/30 shadow-[0_0_8px_rgba(212,165,116,0.1)]"
                      : "bg-[#1E1E1E] text-[#999999] border-[#2A2A2A] hover:border-[#3A3A3A] hover:text-[#E5E5E5]"
                  }`}
                >
                  {opt.optionLabel}
                </button>
              ))}
            </div>
          </div>

          {/* Default Servings */}
          <div>
            <label className="block text-xs font-medium text-[#999999] uppercase tracking-wider mb-1">
              Default Servings
            </label>
            <p className="text-[10px] text-[#666666] mb-2">
              How many portions should recipes default to?
            </p>
            <input
              type="number"
              min={1}
              max={100}
              value={form.servingsDefault}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  servingsDefault: Math.max(1, Math.min(100, parseInt(e.target.value) || 1)),
                }))
              }
              className={`w-24 ${inputClass}`}
            />
          </div>

          {/* Kitchen Constraints */}
          <div>
            <label className="block text-xs font-medium text-[#999999] uppercase tracking-wider mb-2">
              Kitchen Constraints
              <span className="text-[#444444] font-normal ml-1 normal-case tracking-normal">(optional)</span>
            </label>
            <ChipSelect
              options={KITCHEN_CONSTRAINTS_OPTIONS}
              selected={form.kitchenConstraints}
              onToggle={(v) => toggleArrayField("kitchenConstraints", v)}
            />
          </div>
        </AccordionSection>
      )}

      {/* ─── Section 3: Your Restaurant (admin only) ─────────── */}
      {isOrgAdmin && (
        <AccordionSection
          title="Your Restaurant"
          subtitle="Business name, type, cuisine identity, pricing"
          icon={Building2}
          isOpen={openSections.has("restaurant")}
          onToggle={() => toggleSection("restaurant")}
          hasData={hasRestaurantData}
        >
          {/* Restaurant Name */}
          <div>
            <label className="block text-xs font-medium text-[#999999] uppercase tracking-wider mb-1">
              Restaurant or Business Name
            </label>
            <TextInputWithCounter
              value={form.restaurantName}
              onChange={(v) => setForm((prev) => ({ ...prev, restaurantName: v }))}
              maxLength={200}
              placeholder="e.g., The Blue Knife, Sourdough & Co."
              helperText="For students: your training venue or concept"
            />
          </div>

          {/* Establishment Type */}
          <div>
            <label className="block text-xs font-medium text-[#999999] uppercase tracking-wider mb-2">
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
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    establishmentTypeOther: e.target.value.slice(0, 50),
                  }))
                }
                placeholder="Describe your establishment type"
                className={`mt-2 ${inputClass}`}
              />
            )}
          </div>

          {/* Cuisine Identity */}
          <div>
            <label className="block text-xs font-medium text-[#999999] uppercase tracking-wider mb-1">
              Cuisine Identity of Your Menu
            </label>
            <TextInputWithCounter
              value={form.cuisineIdentity}
              onChange={(v) => setForm((prev) => ({ ...prev, cuisineIdentity: v }))}
              maxLength={200}
              placeholder="e.g., Modern Australian with Japanese influence"
              helperText="How your menu is positioned, not personal preference"
            />
          </div>

          {/* Target Diner */}
          <div>
            <label className="block text-xs font-medium text-[#999999] uppercase tracking-wider mb-1">
              Who is Your Target Diner?
            </label>
            <TextInputWithCounter
              value={form.targetDiner}
              onChange={(v) => setForm((prev) => ({ ...prev, targetDiner: v }))}
              maxLength={200}
              placeholder="e.g., Inner-city professionals aged 28-45"
            />
          </div>

          {/* Price Point */}
          <div>
            <label className="block text-xs font-medium text-[#999999] uppercase tracking-wider mb-2">
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
            <label className="block text-xs font-medium text-[#999999] uppercase tracking-wider mb-1">
              Your Restaurant's Voice or Personality
            </label>
            <TextInputWithCounter
              value={form.restaurantVoice}
              onChange={(v) => setForm((prev) => ({ ...prev, restaurantVoice: v }))}
              maxLength={200}
              placeholder="e.g., Relaxed but precise. Nothing on the plate that doesn't earn its place."
              helperText="Shapes the tone of AI-generated menu copy"
            />
          </div>
        </AccordionSection>
      )}

      {/* ─── Section 4: Menu & Sourcing (admin only) ─────────── */}
      {isOrgAdmin && (
        <AccordionSection
          title="Menu & Sourcing"
          subtitle="Sourcing values, plating style, menu priorities"
          icon={Leaf}
          isOpen={openSections.has("menu")}
          onToggle={() => toggleSection("menu")}
          hasData={hasMenuData}
        >
          {/* Sourcing Values */}
          <div>
            <label className="block text-xs font-medium text-[#999999] uppercase tracking-wider mb-2">
              Sourcing Values
              <span className="text-[#444444] font-normal ml-1 normal-case tracking-normal">(optional)</span>
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
              className={`mt-2 ${inputClass}`}
            />
          </div>

          {/* Plating Style */}
          <div>
            <label className="block text-xs font-medium text-[#999999] uppercase tracking-wider mb-2">
              Plating Style That Fits Your Menu
            </label>
            <RadioSelect
              options={PLATING_STYLES}
              selected={form.platingStyle}
              onSelect={(v) => setForm((prev) => ({ ...prev, platingStyle: v }))}
            />
          </div>

          {/* Menu Needs */}
          <div>
            <label className="block text-xs font-medium text-[#999999] uppercase tracking-wider mb-2">
              What Does Your Menu Need Right Now?
              <span className="text-[#444444] font-normal ml-1 normal-case tracking-normal">(pick up to 3)</span>
            </label>
            <ChipSelect
              options={MENU_NEEDS}
              selected={form.menuNeeds}
              onToggle={(v) => toggleArrayField("menuNeeds", v)}
              max={3}
            />
          </div>
        </AccordionSection>
      )}
    </div>
  );
}

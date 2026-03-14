/**
 * @module components/onboarding/KitchenWizard
 *
 * My Kitchen onboarding wizard — a 4-step modal shown to newly registered
 * users when their kitchen_profile is empty.
 *
 * Steps:
 *  1. Skill level (Home Cook → Head Chef)
 *  2. Cuisine style preferences (multi-select)
 *  3. Dietary restrictions to always respect (multi-select)
 *  4. Available kitchen equipment (multi-select)
 *
 * Skippable at any step. Also completable from Profile → My Kitchen tab.
 */

import { useState } from "react";
import { ChefHat, X, ArrowRight, ArrowLeft, Check } from "lucide-react";

// ---------------------------------------------------------------------------
// Option data
// ---------------------------------------------------------------------------

const SKILL_LEVELS = [
  { value: "home_cook", label: "Home Cook", desc: "I cook for pleasure and family" },
  { value: "culinary_student", label: "Culinary Student", desc: "Studying the craft" },
  { value: "line_cook", label: "Line Cook", desc: "Working in a professional kitchen" },
  { value: "sous_chef", label: "Sous Chef", desc: "Leading a kitchen team" },
  { value: "head_chef", label: "Head Chef / Executive Chef", desc: "Running the show" },
];

const CUISINE_OPTIONS = [
  "French Classical", "Contemporary French", "Italian", "Spanish",
  "Japanese", "Chinese", "Korean", "Thai", "Vietnamese",
  "Indian", "Middle Eastern", "Mexican", "American BBQ",
  "Pastry & Baking", "Plant-Based / Vegan", "Seafood-Focused",
];

const DIETARY_OPTIONS = [
  "Vegetarian", "Vegan", "Gluten-Free", "Dairy-Free",
  "Nut-Free", "Kosher", "Halal", "Low-Carb / Keto",
  "Diabetic-Friendly", "Low-FODMAP",
];

const EQUIPMENT_OPTIONS = [
  "Home Oven (Conventional)", "Convection Oven", "Combi Oven",
  "Stand Mixer (e.g. KitchenAid)", "Food Processor",
  "Immersion Circulator (Sous Vide)", "Immersion Blender",
  "High-Speed Blender (e.g. Vitamix)", "Thermomix",
  "Induction Cooktop", "Gas Burner", "Carbon Steel Wok",
  "Cast Iron Pan", "Dutch Oven / Cocotte",
  "Chocolate Tempering Equipment", "Pasta Machine",
  "Ice Cream Machine", "Dehydrator", "Smoke Gun",
  "Whipping Siphon (ISI)",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WizardData {
  skillLevel: string;
  cuisinePreferences: string[];
  dietaryRestrictions: string[];
  kitchenEquipment: string[];
}

interface KitchenWizardProps {
  onComplete: (data: WizardData) => Promise<void>;
  onSkip: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KitchenWizard({ onComplete, onSkip }: KitchenWizardProps) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<WizardData>({
    skillLevel: "",
    cuisinePreferences: [],
    dietaryRestrictions: [],
    kitchenEquipment: [],
  });

  const TOTAL_STEPS = 4;

  function toggleArrayItem(arr: string[], item: string): string[] {
    return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
  }

  async function handleFinish() {
    setSaving(true);
    try {
      await onComplete(data);
    } finally {
      setSaving(false);
    }
  }

  const canAdvance = (): boolean => {
    if (step === 0) return data.skillLevel !== "";
    return true; // steps 1-3 are optional multi-selects
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="bg-stone-800 px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ChefHat className="size-6 text-amber-400" />
            <div>
              <h2 className="text-white font-semibold text-lg">My Kitchen Setup</h2>
              <p className="text-stone-400 text-xs">Step {step + 1} of {TOTAL_STEPS}</p>
            </div>
          </div>
          <button
            onClick={onSkip}
            className="text-stone-400 hover:text-white transition-colors"
            aria-label="Skip onboarding"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-stone-200">
          <div
            className="h-1 bg-amber-500 transition-all duration-300"
            style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
          />
        </div>

        {/* Step content */}
        <div className="px-6 py-6 min-h-[320px]">
          {/* Step 0: Skill level */}
          {step === 0 && (
            <div>
              <h3 className="font-semibold text-stone-800 text-base mb-1">
                What best describes your skill level?
              </h3>
              <p className="text-stone-500 text-sm mb-4">
                CulinAIre will tailor explanations and technique depth to match you.
              </p>
              <div className="space-y-2">
                {SKILL_LEVELS.map((level) => (
                  <button
                    key={level.value}
                    onClick={() => setData((d) => ({ ...d, skillLevel: level.value }))}
                    className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-colors ${
                      data.skillLevel === level.value
                        ? "border-amber-500 bg-amber-50"
                        : "border-stone-200 hover:border-stone-300 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-stone-800 text-sm">{level.label}</p>
                        <p className="text-stone-500 text-xs">{level.desc}</p>
                      </div>
                      {data.skillLevel === level.value && (
                        <Check className="size-4 text-amber-600 shrink-0" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 1: Cuisine preferences */}
          {step === 1 && (
            <div>
              <h3 className="font-semibold text-stone-800 text-base mb-1">
                What cuisine styles interest you most?
              </h3>
              <p className="text-stone-500 text-sm mb-4">
                Select all that apply — CulinAIre will lean towards these when generating recipes.
              </p>
              <div className="flex flex-wrap gap-2">
                {CUISINE_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() =>
                      setData((d) => ({
                        ...d,
                        cuisinePreferences: toggleArrayItem(d.cuisinePreferences, opt),
                      }))
                    }
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      data.cuisinePreferences.includes(opt)
                        ? "bg-amber-500 border-amber-500 text-white"
                        : "bg-white border-stone-300 text-stone-700 hover:border-amber-400"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Dietary restrictions */}
          {step === 2 && (
            <div>
              <h3 className="font-semibold text-stone-800 text-base mb-1">
                Any dietary restrictions to always respect?
              </h3>
              <p className="text-stone-500 text-sm mb-4">
                CulinAIre will factor these into every recipe and suggestion.
              </p>
              <div className="flex flex-wrap gap-2">
                {DIETARY_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() =>
                      setData((d) => ({
                        ...d,
                        dietaryRestrictions: toggleArrayItem(d.dietaryRestrictions, opt),
                      }))
                    }
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      data.dietaryRestrictions.includes(opt)
                        ? "bg-amber-500 border-amber-500 text-white"
                        : "bg-white border-stone-300 text-stone-700 hover:border-amber-400"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Equipment */}
          {step === 3 && (
            <div>
              <h3 className="font-semibold text-stone-800 text-base mb-1">
                What equipment do you have access to?
              </h3>
              <p className="text-stone-500 text-sm mb-4">
                CulinAIre will only suggest techniques your kitchen can execute.
              </p>
              <div className="flex flex-wrap gap-2">
                {EQUIPMENT_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() =>
                      setData((d) => ({
                        ...d,
                        kitchenEquipment: toggleArrayItem(d.kitchenEquipment, opt),
                      }))
                    }
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      data.kitchenEquipment.includes(opt)
                        ? "bg-amber-500 border-amber-500 text-white"
                        : "bg-white border-stone-300 text-stone-700 hover:border-amber-400"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 pb-6 flex items-center justify-between">
          <button
            onClick={step === 0 ? onSkip : () => setStep((s) => s - 1)}
            className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-700 transition-colors"
          >
            {step === 0 ? (
              "Skip for now"
            ) : (
              <>
                <ArrowLeft className="size-4" />
                Back
              </>
            )}
          </button>

          {step < TOTAL_STEPS - 1 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance()}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
              <ArrowRight className="size-4" />
            </button>
          ) : (
            <button
              onClick={handleFinish}
              disabled={saving}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Finish Setup"}
              {!saving && <Check className="size-4" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

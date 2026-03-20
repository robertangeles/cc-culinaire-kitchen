/**
 * @module components/recipes/RecipeEditor
 *
 * Full inline recipe editor that replaces the read-only RecipeCard view.
 * Editable sections: title/meta, ingredients, method steps, pro tips,
 * storage/safety, allergen note, and a change description field.
 */

import { useState, useCallback } from "react";
import {
  Plus,
  X,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Save,
  Loader2,
  ImagePlus,
} from "lucide-react";
import type { RecipeData } from "./RecipeCard.js";

interface RecipeEditorProps {
  recipeData: RecipeData;
  recipeId: string;
  onSave: (updatedData: RecipeData, changeDescription: string) => void;
  onCancel: () => void;
  onOpenRefine: () => void;
  onImageUpdate?: (imageUrl: string) => void;
}

const INPUT_CLS =
  "w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl px-4 py-3 text-white placeholder-[#444444] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 transition-shadow text-sm";
const LABEL_CLS = "block text-xs font-medium text-[#999999] mb-1.5";
const SECTION_TITLE_CLS = "text-[#FAFAFA] font-semibold text-lg mb-3";
const ADD_BTN_CLS =
  "flex items-center gap-1 text-[#D4A574] hover:text-[#C4956A] text-sm font-medium transition-colors mt-2";
const DEL_BTN_CLS =
  "text-[#666666] hover:text-red-400 transition-colors shrink-0 p-1";

const DIFFICULTY_OPTIONS = ["beginner", "intermediate", "advanced", "expert"];

export function RecipeEditor({
  recipeData,
  recipeId: _recipeId,
  onSave,
  onCancel,
  onOpenRefine,
  onImageUpdate,
}: RecipeEditorProps) {
  const [data, setData] = useState<RecipeData>(() => ({
    ...recipeData,
    ingredients: recipeData.ingredients?.map((i) => ({ ...i })) ?? [],
    steps: recipeData.steps?.map((s) => ({ ...s })) ?? [],
    proTips: recipeData.proTips ? [...recipeData.proTips] : [],
  }));
  const [changeDescription, setChangeDescription] = useState("");
  const [showAdditional, setShowAdditional] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regeneratingImage, setRegeneratingImage] = useState(false);
  const [imageRegenerated, setImageRegenerated] = useState(false);

  /* ---------- field helpers ---------- */

  const updateField = useCallback(
    <K extends keyof RecipeData>(key: K, value: RecipeData[K]) => {
      setData((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  /* ---------- ingredients ---------- */

  const updateIngredient = useCallback(
    (idx: number, field: string, value: string) => {
      setData((prev) => {
        const ingredients = prev.ingredients.map((ing, i) =>
          i === idx ? { ...ing, [field]: value } : ing,
        );
        return { ...prev, ingredients };
      });
    },
    [],
  );

  const addIngredient = useCallback(() => {
    setData((prev) => ({
      ...prev,
      ingredients: [
        ...prev.ingredients,
        { amount: "", unit: "", name: "", note: "" },
      ],
    }));
  }, []);

  const removeIngredient = useCallback((idx: number) => {
    setData((prev) => ({
      ...prev,
      ingredients: prev.ingredients.filter((_, i) => i !== idx),
    }));
  }, []);

  /* ---------- steps ---------- */

  const updateStep = useCallback((idx: number, instruction: string) => {
    setData((prev) => {
      const steps = prev.steps.map((s, i) =>
        i === idx ? { ...s, instruction } : s,
      );
      return { ...prev, steps };
    });
  }, []);

  const addStep = useCallback(() => {
    setData((prev) => ({
      ...prev,
      steps: [
        ...prev.steps,
        { step: prev.steps.length + 1, instruction: "" },
      ],
    }));
  }, []);

  const removeStep = useCallback((idx: number) => {
    setData((prev) => ({
      ...prev,
      steps: prev.steps
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, step: i + 1 })),
    }));
  }, []);

  const moveStep = useCallback((idx: number, direction: "up" | "down") => {
    setData((prev) => {
      const steps = [...prev.steps];
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= steps.length) return prev;
      [steps[idx], steps[target]] = [steps[target], steps[idx]];
      return {
        ...prev,
        steps: steps.map((s, i) => ({ ...s, step: i + 1 })),
      };
    });
  }, []);

  /* ---------- pro tips ---------- */

  const updateTip = useCallback((idx: number, value: string) => {
    setData((prev) => {
      const proTips = [...(prev.proTips ?? [])];
      proTips[idx] = value;
      return { ...prev, proTips };
    });
  }, []);

  const addTip = useCallback(() => {
    setData((prev) => ({
      ...prev,
      proTips: [...(prev.proTips ?? []), ""],
    }));
  }, []);

  const removeTip = useCallback((idx: number) => {
    setData((prev) => ({
      ...prev,
      proTips: (prev.proTips ?? []).filter((_, i) => i !== idx),
    }));
  }, []);

  /* ---------- save ---------- */

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(data, changeDescription);
    } finally {
      setSaving(false);
    }
  }, [data, changeDescription, onSave]);

  return (
    <div className="bg-[#161616] rounded-2xl border border-[#2A2A2A] p-6 space-y-8">
      {/* ── Title & Meta ── */}
      <section>
        <h2 className={SECTION_TITLE_CLS}>Title & Details</h2>
        <div className="space-y-4">
          <div>
            <label className={LABEL_CLS}>Recipe Name</label>
            <input
              className={INPUT_CLS}
              value={data.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="Recipe name"
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Description</label>
            <textarea
              className={`${INPUT_CLS} min-h-[80px] resize-y`}
              value={data.description}
              onChange={(e) => updateField("description", e.target.value)}
              placeholder="A brief description of the dish..."
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className={LABEL_CLS}>Yield</label>
              <input
                className={INPUT_CLS}
                value={data.yield}
                onChange={(e) => updateField("yield", e.target.value)}
                placeholder="e.g. 4 servings"
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Prep Time</label>
              <input
                className={INPUT_CLS}
                value={data.prepTime}
                onChange={(e) => updateField("prepTime", e.target.value)}
                placeholder="e.g. 15 minutes"
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Cook Time</label>
              <input
                className={INPUT_CLS}
                value={data.cookTime}
                onChange={(e) => updateField("cookTime", e.target.value)}
                placeholder="e.g. 30 minutes"
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Difficulty</label>
              <select
                className={INPUT_CLS}
                value={data.difficulty}
                onChange={(e) => updateField("difficulty", e.target.value)}
              >
                {DIFFICULTY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* ── Ingredients ── */}
      <section>
        <h2 className={SECTION_TITLE_CLS}>Ingredients</h2>
        <div className="space-y-3">
          {data.ingredients.map((ing, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <div className="grid grid-cols-4 gap-2 flex-1 min-w-0">
                <input
                  className={INPUT_CLS}
                  value={ing.amount}
                  onChange={(e) =>
                    updateIngredient(idx, "amount", e.target.value)
                  }
                  placeholder="Amt"
                />
                <input
                  className={INPUT_CLS}
                  value={ing.unit}
                  onChange={(e) =>
                    updateIngredient(idx, "unit", e.target.value)
                  }
                  placeholder="Unit"
                />
                <input
                  className={INPUT_CLS}
                  value={ing.name}
                  onChange={(e) =>
                    updateIngredient(idx, "name", e.target.value)
                  }
                  placeholder="Ingredient"
                />
                <input
                  className={INPUT_CLS}
                  value={ing.note ?? ""}
                  onChange={(e) =>
                    updateIngredient(idx, "note", e.target.value)
                  }
                  placeholder="Note"
                />
              </div>
              <button
                onClick={() => removeIngredient(idx)}
                className={DEL_BTN_CLS}
                aria-label="Remove ingredient"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <button onClick={addIngredient} className={ADD_BTN_CLS}>
          <Plus className="size-4" />
          Add Ingredient
        </button>
      </section>

      {/* ── Method Steps ── */}
      <section>
        <h2 className={SECTION_TITLE_CLS}>Method</h2>
        <div className="space-y-3">
          {data.steps.map((step, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <div className="flex flex-col items-center gap-0.5 pt-3">
                <button
                  onClick={() => moveStep(idx, "up")}
                  disabled={idx === 0}
                  className={`${DEL_BTN_CLS} ${idx === 0 ? "opacity-30 cursor-not-allowed" : ""}`}
                  aria-label="Move step up"
                >
                  <ChevronUp className="size-4" />
                </button>
                <span className="text-xs font-semibold text-[#D4A574] w-6 text-center">
                  {step.step}
                </span>
                <button
                  onClick={() => moveStep(idx, "down")}
                  disabled={idx === data.steps.length - 1}
                  className={`${DEL_BTN_CLS} ${idx === data.steps.length - 1 ? "opacity-30 cursor-not-allowed" : ""}`}
                  aria-label="Move step down"
                >
                  <ChevronDown className="size-4" />
                </button>
              </div>
              <textarea
                className={`${INPUT_CLS} flex-1 min-h-[72px] resize-y`}
                value={step.instruction}
                onChange={(e) => updateStep(idx, e.target.value)}
                placeholder={`Step ${step.step} instruction...`}
                rows={2}
              />
              <button
                onClick={() => removeStep(idx)}
                className={`${DEL_BTN_CLS} pt-3`}
                aria-label="Remove step"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <button onClick={addStep} className={ADD_BTN_CLS}>
          <Plus className="size-4" />
          Add Step
        </button>
      </section>

      {/* ── Pro Tips ── */}
      <section>
        <h2 className={SECTION_TITLE_CLS}>Pro Tips</h2>
        <div className="space-y-3">
          {(data.proTips ?? []).map((tip, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <input
                className={`${INPUT_CLS} flex-1`}
                value={tip}
                onChange={(e) => updateTip(idx, e.target.value)}
                placeholder="Enter a pro tip..."
              />
              <button
                onClick={() => removeTip(idx)}
                className={DEL_BTN_CLS}
                aria-label="Remove tip"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <button onClick={addTip} className={ADD_BTN_CLS}>
          <Plus className="size-4" />
          Add Tip
        </button>
      </section>

      {/* ── Additional (collapsible) ── */}
      <section>
        <button
          onClick={() => setShowAdditional(!showAdditional)}
          className="flex items-center gap-2 text-[#FAFAFA] font-semibold text-lg hover:text-[#D4A574] transition-colors"
        >
          <ChevronRight
            className={`size-5 transition-transform ${showAdditional ? "rotate-90" : ""}`}
          />
          Additional Details
        </button>
        {showAdditional && (
          <div className="mt-4 space-y-4">
            <div>
              <label className={LABEL_CLS}>Storage & Food Safety</label>
              <textarea
                className={`${INPUT_CLS} min-h-[80px] resize-y`}
                value={data.storageAndSafety ?? ""}
                onChange={(e) =>
                  updateField("storageAndSafety", e.target.value)
                }
                placeholder="Storage instructions, food safety notes..."
                rows={3}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Allergen Note</label>
              <textarea
                className={`${INPUT_CLS} min-h-[80px] resize-y`}
                value={data.allergenNote}
                onChange={(e) => updateField("allergenNote", e.target.value)}
                placeholder="Allergen information..."
                rows={3}
              />
            </div>
          </div>
        )}
      </section>

      {/* ── Change Description ── */}
      <section>
        <label className={LABEL_CLS}>
          Briefly describe your changes (optional)
        </label>
        <input
          className={INPUT_CLS}
          value={changeDescription}
          onChange={(e) => setChangeDescription(e.target.value)}
          placeholder="e.g. Adjusted seasoning, added garnish step"
        />
      </section>

      {/* ── Sticky Actions Bar ── */}
      <div className="sticky bottom-0 bg-[#161616] border-t border-[#2A2A2A] -mx-6 px-6 py-4 flex items-center justify-between gap-3 rounded-b-2xl">
        <button
          onClick={onCancel}
          className="px-5 py-3 text-sm text-[#999999] hover:text-white transition-colors rounded-xl"
        >
          Cancel
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              setRegeneratingImage(true);
              try {
                const res = await fetch(`/api/recipes/${_recipeId}/regenerate-image`, {
                  method: "POST",
                  credentials: "include",
                });
                if (res.ok) {
                  const data = await res.json();
                  if (data.imageUrl) onImageUpdate?.(data.imageUrl);
                  setImageRegenerated(true);
                  setTimeout(() => setImageRegenerated(false), 3000);
                }
              } catch { /* silent */ } finally {
                setRegeneratingImage(false);
              }
            }}
            disabled={regeneratingImage}
            className="flex items-center gap-2 px-5 py-3 text-sm font-medium text-[#999999] border border-[#2A2A2A] hover:border-[#3A3A3A] hover:text-white rounded-xl transition-colors disabled:opacity-50"
          >
            {regeneratingImage ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            {imageRegenerated ? "Image Updated!" : "New Image"}
          </button>
          <button
            onClick={onOpenRefine}
            className="flex items-center gap-2 px-5 py-3 text-sm font-medium text-[#D4A574] border border-[#D4A574]/30 hover:border-[#D4A574]/60 hover:bg-[#D4A574]/10 rounded-xl transition-colors"
          >
            <Sparkles className="size-4" />
            AI Refine
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 text-sm font-semibold bg-[#D4A574] hover:bg-[#C4956A] text-[#0A0A0A] rounded-xl transition-colors disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

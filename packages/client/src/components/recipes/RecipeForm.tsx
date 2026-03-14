/**
 * @module components/recipes/RecipeForm
 *
 * Domain-aware recipe generation form. Renders different fields based
 * on the active domain (recipe / patisserie / spirits).
 */

import { useState, type FormEvent } from "react";
import { Loader2, Sparkles } from "lucide-react";

export type RecipeDomain = "recipe" | "patisserie" | "spirits";

export interface RecipeFormData {
  request: string;
  servings?: number;
  difficulty?: string;
  dietary?: string[];
  cuisine?: string;
  mainIngredients?: string;
  pastryType?: string;
  keyTechnique?: string;
  occasion?: string;
  spiritBase?: string;
  flavourProfile?: string;
  alcoholic?: boolean;
}

interface RecipeFormProps {
  domain: RecipeDomain;
  onSubmit: (data: RecipeFormData) => void;
  loading: boolean;
}

const DIETARY_OPTIONS = ["Vegetarian", "Vegan", "Gluten-Free", "Dairy-Free", "Nut-Free", "Halal", "Kosher"];

const DIFFICULTY_OPTIONS = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
  { value: "expert", label: "Expert" },
];

const PLACEHOLDERS: Record<RecipeDomain, string> = {
  recipe: "e.g. French chicken thigh braise with cider and shallot confit",
  patisserie: "e.g. Dark chocolate and raspberry tart with almond cream",
  spirits: "e.g. A smoky mezcal sour with honey and fresh lime",
};

export function RecipeForm({ domain, onSubmit, loading }: RecipeFormProps) {
  const [request, setRequest] = useState("");
  const [servings, setServings] = useState("4");
  const [difficulty, setDifficulty] = useState("");
  const [dietary, setDietary] = useState<string[]>([]);
  const [cuisine, setCuisine] = useState("");
  const [mainIngredients, setMainIngredients] = useState("");
  const [pastryType, setPastryType] = useState("");
  const [keyTechnique, setKeyTechnique] = useState("");
  const [occasion, setOccasion] = useState("");
  const [spiritBase, setSpiritBase] = useState("");
  const [flavourProfile, setFlavourProfile] = useState("");
  const [alcoholic, setAlcoholic] = useState(true);

  function toggleDietary(item: string) {
    setDietary((prev) =>
      prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!request.trim()) return;

    onSubmit({
      request: request.trim(),
      servings: parseInt(servings) || 4,
      difficulty: difficulty || undefined,
      dietary: dietary.length > 0 ? dietary : undefined,
      cuisine: domain === "recipe" ? cuisine || undefined : undefined,
      mainIngredients: domain === "recipe" ? mainIngredients || undefined : undefined,
      pastryType: domain === "patisserie" ? pastryType || undefined : undefined,
      keyTechnique: domain === "patisserie" ? keyTechnique || undefined : undefined,
      occasion: occasion || undefined,
      spiritBase: domain === "spirits" ? spiritBase || undefined : undefined,
      flavourProfile: domain === "spirits" ? flavourProfile || undefined : undefined,
      alcoholic: domain === "spirits" ? alcoholic : undefined,
    });
  }

  const accentClass = {
    recipe: "focus:border-amber-500 focus:ring-amber-500",
    patisserie: "focus:border-pink-400 focus:ring-pink-400",
    spirits: "focus:border-amber-700 focus:ring-amber-700",
  }[domain];

  const btnClass = {
    recipe: "bg-amber-600 hover:bg-amber-700",
    patisserie: "bg-pink-500 hover:bg-pink-600",
    spirits: "bg-amber-800 hover:bg-amber-900",
  }[domain];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Main request */}
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">
          What would you like to create?
        </label>
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder={PLACEHOLDERS[domain]}
          rows={2}
          className={`w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 resize-none focus:outline-none focus:ring-1 ${accentClass}`}
          required
        />
      </div>

      {/* Domain-specific fields */}
      {domain === "recipe" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Cuisine style</label>
              <input
                type="text"
                value={cuisine}
                onChange={(e) => setCuisine(e.target.value)}
                placeholder="e.g. French, Japanese"
                className={`w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 ${accentClass}`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Key ingredients</label>
              <input
                type="text"
                value={mainIngredients}
                onChange={(e) => setMainIngredients(e.target.value)}
                placeholder="e.g. chicken, cider, shallots"
                className={`w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 ${accentClass}`}
              />
            </div>
          </div>
        </>
      )}

      {domain === "patisserie" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">Pastry type</label>
            <select
              value={pastryType}
              onChange={(e) => setPastryType(e.target.value)}
              className={`w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 ${accentClass}`}
            >
              <option value="">Any</option>
              <option>Tart / Tartlet</option>
              <option>Cake / Entremets</option>
              <option>Bread / Enriched Dough</option>
              <option>Chocolate Work</option>
              <option>Confectionery / Candy</option>
              <option>Choux / Éclair</option>
              <option>Viennoiserie</option>
              <option>Cookie / Petit Four</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">Key technique</label>
            <input
              type="text"
              value={keyTechnique}
              onChange={(e) => setKeyTechnique(e.target.value)}
              placeholder="e.g. lamination, tempering"
              className={`w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 ${accentClass}`}
            />
          </div>
        </div>
      )}

      {domain === "spirits" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">Spirit base</label>
            <input
              type="text"
              value={spiritBase}
              onChange={(e) => setSpiritBase(e.target.value)}
              placeholder="e.g. rum, gin, whisky"
              className={`w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 ${accentClass}`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">Flavour profile</label>
            <input
              type="text"
              value={flavourProfile}
              onChange={(e) => setFlavourProfile(e.target.value)}
              placeholder="e.g. smoky, citrus-forward"
              className={`w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 ${accentClass}`}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-stone-600 mb-1">Type</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="alcoholic"
                  checked={alcoholic}
                  onChange={() => setAlcoholic(true)}
                  className="accent-amber-700"
                />
                Alcoholic
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="alcoholic"
                  checked={!alcoholic}
                  onChange={() => setAlcoholic(false)}
                  className="accent-amber-700"
                />
                Non-Alcoholic (Mocktail)
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Shared fields: servings, difficulty, dietary */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1">Servings</label>
          <input
            type="number"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            min={1}
            max={100}
            className={`w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 ${accentClass}`}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1">Difficulty</label>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
            className={`w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 ${accentClass}`}
          >
            <option value="">Any</option>
            {DIFFICULTY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Occasion */}
      <div>
        <label className="block text-xs font-medium text-stone-600 mb-1">Occasion (optional)</label>
        <input
          type="text"
          value={occasion}
          onChange={(e) => setOccasion(e.target.value)}
          placeholder="e.g. dinner party, weeknight, holiday"
          className={`w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 ${accentClass}`}
        />
      </div>

      {/* Dietary */}
      <div>
        <label className="block text-xs font-medium text-stone-600 mb-2">Dietary restrictions</label>
        <div className="flex flex-wrap gap-2">
          {DIETARY_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => toggleDietary(opt)}
              className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                dietary.includes(opt)
                  ? "bg-stone-700 border-stone-700 text-white"
                  : "bg-white border-stone-300 text-stone-600 hover:border-stone-400"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={loading || !request.trim()}
        className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${btnClass}`}
      >
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Sparkles className="size-4" />
            Generate{" "}
            {domain === "recipe"
              ? "Recipe"
              : domain === "patisserie"
              ? "Pastry Recipe"
              : "Drink Recipe"}
          </>
        )}
      </button>
    </form>
  );
}

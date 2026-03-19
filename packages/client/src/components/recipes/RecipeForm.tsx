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
  // Patisserie
  pastryType?: string;
  pastryStyle?: string;
  keyTechnique?: string;
  componentCount?: string;
  occasion?: string;
  // Spirits
  spiritBase?: string;
  flavourProfile?: string;
  alcoholic?: boolean;
  venueType?: string;
  drinkStyle?: string;
  season?: string;
}

interface RecipeFormProps {
  domain: RecipeDomain;
  onSubmit: (data: RecipeFormData) => void;
  loading: boolean;
}

const DIETARY_OPTIONS = ["Vegetarian", "Vegan", "Gluten-Free", "Dairy-Free", "Nut-Free", "Halal", "Kosher"];

/**
 * Difficulty levels — domain-aware, aligned with industry progression.
 * Culinary: CIA ProChef levels / Le Cordon Bleu
 * Patisserie: ACF CMPC / Le Cordon Bleu pastry progression
 * Spirits: Professional bartender career ladder
 */
const DIFFICULTY_OPTIONS: Record<RecipeDomain, { value: string; label: string }[]> = {
  recipe: [
    { value: "beginner", label: "Home Cook" },
    { value: "intermediate", label: "Skilled Home Cook / Culinary Student" },
    { value: "advanced", label: "Professional / Line Cook" },
    { value: "expert", label: "Chef de Partie / Master Level" },
  ],
  patisserie: [
    { value: "beginner", label: "Home Baker" },
    { value: "intermediate", label: "Skilled Home Baker / Pastry Student" },
    { value: "advanced", label: "Professional Pastry Cook" },
    { value: "expert", label: "Pastry Chef / Master Pâtissier" },
  ],
  spirits: [
    { value: "beginner", label: "Home Bartender" },
    { value: "intermediate", label: "Enthusiast / Hobbyist" },
    { value: "advanced", label: "Professional Bartender" },
    { value: "expert", label: "Head Bartender / Bar Manager" },
  ],
};

const PLACEHOLDERS: Record<RecipeDomain, string> = {
  recipe: "e.g. French chicken thigh braise with cider and shallot confit",
  patisserie: "e.g. Dark chocolate and raspberry tart with hazelnut praline and mirror glaze",
  spirits: "e.g. A smoky mezcal sour with honey, fresh lime, and mole bitters",
};

/**
 * Spirit base options. Covers the major spirit categories recognized
 * by the IBA (International Bartenders Association) and professional
 * bar programs worldwide.
 */
const SPIRIT_OPTIONS = [
  "Gin", "Vodka", "Rum (Light)", "Rum (Dark / Aged)", "Tequila", "Mezcal",
  "Bourbon", "Rye Whiskey", "Scotch", "Irish Whiskey", "Japanese Whisky",
  "Brandy / Cognac", "Amaro / Bitter Liqueur", "Wine / Vermouth / Aperitivo",
  "Sake / Soju", "Cachaça", "Pisco", "Aquavit", "Absinthe", "Dealer's Choice",
];

const VENUE_OPTIONS = [
  { value: "high-volume", label: "High-Volume Casual" },
  { value: "craft", label: "Craft Cocktail Bar" },
  { value: "hotel", label: "Hotel / Fine Dining" },
  { value: "restaurant", label: "Restaurant / Casual Dining" },
  { value: "nightclub", label: "Nightclub / Lounge" },
];

/**
 * Drink style options based on classic cocktail families recognized
 * by the IBA and professional bartending literature (Difford's Guide,
 * Dave Arnold's Liquid Intelligence, Gary Regan's Joy of Mixology).
 */
const DRINK_STYLE_OPTIONS = [
  "Sour (Spirit + Citrus + Sweet)",
  "Old Fashioned (Spirit + Sugar + Bitters)",
  "Highball (Spirit + Carbonated Mixer)",
  "Martini / Manhattan (Spirit + Vermouth)",
  "Fizz / Collins (Spirit + Citrus + Soda)",
  "Daisy / Margarita (Spirit + Citrus + Liqueur)",
  "Flip (Spirit + Sugar + Whole Egg)",
  "Julep / Smash (Spirit + Herb + Sugar)",
  "Punch (Multi-Serve, Citrus + Spirit)",
  "Tiki / Tropical",
  "Aperitivo / Spritz",
  "Hot Cocktail",
  "Dealer's Choice",
];

const SEASON_OPTIONS = ["Spring", "Summer", "Autumn", "Winter", "Year-Round"];

/** Pastry style reflects the culinary tradition / school of thought. */
const PASTRY_STYLE_OPTIONS = [
  "French Classical", "Modern / Contemporary", "Asian-Inspired", "American", "Nordic", "Middle Eastern",
];

/**
 * Pastry type follows the French professional classification used by
 * Le Cordon Bleu, ACF (CMPC), and the classical pastry disciplines.
 */
const PASTRY_TYPE_OPTIONS = [
  "Pâtisserie (Tarts, Cakes, Mille-Feuille)",
  "Viennoiserie (Croissant, Brioche, Danish)",
  "Boulangerie (Breads, Enriched Doughs)",
  "Entremets (Multi-Layered Mousse Cakes)",
  "Confiserie (Sugar Work, Caramels, Candies)",
  "Chocolaterie (Tempering, Truffles, Bonbons)",
  "Glacerie (Ice Cream, Sorbet, Frozen)",
  "Choux (Éclairs, Profiteroles, Paris-Brest)",
  "Petits Fours (Sec, Glacé, Frais)",
  "Meringue (Pavlova, Dacquoise, Macarons)",
];

export function RecipeForm({ domain, onSubmit, loading }: RecipeFormProps) {
  const [request, setRequest] = useState("");
  const [servings, setServings] = useState("4");
  const [difficulty, setDifficulty] = useState("");
  const [dietary, setDietary] = useState<string[]>([]);
  const [cuisine, setCuisine] = useState("");
  const [mainIngredients, setMainIngredients] = useState("");
  // Patisserie
  const [pastryType, setPastryType] = useState("");
  const [pastryStyle, setPastryStyle] = useState("");
  const [keyTechnique, setKeyTechnique] = useState("");
  const [componentCount, setComponentCount] = useState("");
  // Spirits
  const [spiritBase, setSpiritBase] = useState("");
  const [flavourProfile, setFlavourProfile] = useState("");
  const [alcoholic, setAlcoholic] = useState(true);
  const [venueType, setVenueType] = useState("");
  const [drinkStyle, setDrinkStyle] = useState("");
  const [season, setSeason] = useState("");
  // Shared
  const [occasion, setOccasion] = useState("");

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
      // Patisserie
      pastryType: domain === "patisserie" ? pastryType || undefined : undefined,
      pastryStyle: domain === "patisserie" ? pastryStyle || undefined : undefined,
      keyTechnique: domain === "patisserie" ? keyTechnique || undefined : undefined,
      componentCount: domain === "patisserie" ? componentCount || undefined : undefined,
      occasion: occasion || undefined,
      // Spirits
      spiritBase: domain === "spirits" ? spiritBase || undefined : undefined,
      flavourProfile: domain === "spirits" ? flavourProfile || undefined : undefined,
      alcoholic: domain === "spirits" ? alcoholic : undefined,
      venueType: domain === "spirits" ? venueType || undefined : undefined,
      drinkStyle: domain === "spirits" ? drinkStyle || undefined : undefined,
      season: domain === "spirits" ? season || undefined : undefined,
    });
  }

  const accentClass = "focus:border-[#D4A574] focus:ring-[#D4A574]/50";

  const btnClass = "bg-[#D4A574] hover:bg-[#C4956A]";

  const selectClass = `w-full rounded-xl border border-[#2A2A2A] bg-[#0A0A0A] px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 ${accentClass}`;
  const inputClass = selectClass;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Main request */}
      <div>
        <label className="block text-sm font-medium text-[#999999] mb-2">
          {domain === "spirits" ? "What drink would you like to create?" : "What would you like to create?"}
        </label>
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder={PLACEHOLDERS[domain]}
          rows={2}
          className={`w-full rounded-xl border border-[#2A2A2A] bg-[#0A0A0A] px-4 py-3 text-sm text-white placeholder-[#444444] resize-none focus:outline-none focus:ring-2 ${accentClass}`}
          required
        />
      </div>

      {/* ===== Recipe Lab fields ===== */}
      {domain === "recipe" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#999999] mb-2">Cuisine style</label>
            <input type="text" value={cuisine} onChange={(e) => setCuisine(e.target.value)}
              placeholder="e.g. French, Japanese" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#999999] mb-2">Key ingredients</label>
            <input type="text" value={mainIngredients} onChange={(e) => setMainIngredients(e.target.value)}
              placeholder="e.g. chicken, cider, shallots" className={inputClass} />
          </div>
        </div>
      )}

      {/* ===== Patisserie Lab fields ===== */}
      {domain === "patisserie" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#999999] mb-2">Pastry style</label>
              <select value={pastryStyle} onChange={(e) => setPastryStyle(e.target.value)} className={selectClass}>
                <option value="">Any style</option>
                {PASTRY_STYLE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#999999] mb-2">Pastry type</label>
              <select value={pastryType} onChange={(e) => setPastryType(e.target.value)} className={selectClass}>
                <option value="">Any type</option>
                {PASTRY_TYPE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#999999] mb-2">Key technique</label>
              <input type="text" value={keyTechnique} onChange={(e) => setKeyTechnique(e.target.value)}
                placeholder="e.g. lamination, tempering" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#999999] mb-2">Time commitment</label>
              <select value={componentCount} onChange={(e) => setComponentCount(e.target.value)} className={selectClass}>
                <option value="">Any</option>
                <option value="quick">Quick (under 2 hours active)</option>
                <option value="half-day">Half-Day (2-4 hours active + passive)</option>
                <option value="full-day">Full-Day (4+ hours active)</option>
                <option value="multi-day">Multi-Day (overnight resting/proofing)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* ===== Spirits Lab fields ===== */}
      {domain === "spirits" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#999999] mb-2">Venue type</label>
              <select value={venueType} onChange={(e) => setVenueType(e.target.value)} className={selectClass}>
                <option value="">Any venue</option>
                {VENUE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#999999] mb-2">Spirit base</label>
              <select value={spiritBase} onChange={(e) => setSpiritBase(e.target.value)} className={selectClass}>
                <option value="">Any spirit</option>
                {SPIRIT_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#999999] mb-2">Drink family</label>
              <select value={drinkStyle} onChange={(e) => setDrinkStyle(e.target.value)} className={selectClass}>
                <option value="">Any style</option>
                {DRINK_STYLE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#999999] mb-2">Season</label>
              <select value={season} onChange={(e) => setSeason(e.target.value)} className={selectClass}>
                <option value="">Any season</option>
                {SEASON_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#999999] mb-2">Drink type</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-[#E5E5E5] cursor-pointer">
                <input type="radio" name="alcoholic" checked={alcoholic} onChange={() => setAlcoholic(true)} className="accent-[#D4A574]" />
                Full Strength
              </label>
              <label className="flex items-center gap-2 text-sm text-[#E5E5E5] cursor-pointer">
                <input type="radio" name="alcoholic" checked={!alcoholic} onChange={() => setAlcoholic(false)} className="accent-[#D4A574]" />
                Non-Alcoholic / Mocktail
              </label>
            </div>
          </div>
        </div>
      )}

      {/* ===== Shared fields ===== */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[#999999] mb-2">
            {domain === "spirits" ? "Yield" : "Servings"}
          </label>
          <input type="number" value={servings} onChange={(e) => setServings(e.target.value)}
            min={1} max={100} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#999999] mb-2">Difficulty</label>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className={selectClass}>
            <option value="">Any</option>
            {DIFFICULTY_OPTIONS[domain].map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Occasion */}
      <div>
        <label className="block text-xs font-medium text-[#999999] mb-2">Occasion (optional)</label>
        <input type="text" value={occasion} onChange={(e) => setOccasion(e.target.value)}
          placeholder="e.g. dinner party, weeknight, holiday" className={inputClass} />
      </div>

      {/* Dietary */}
      <div>
        <label className="block text-xs font-medium text-[#999999] mb-2">Dietary restrictions</label>
        <div className="flex flex-wrap gap-2">
          {DIETARY_OPTIONS.map((opt) => (
            <button key={opt} type="button" onClick={() => toggleDietary(opt)}
              className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                dietary.includes(opt)
                  ? "bg-[#D4A574] border-[#D4A574] text-[#0A0A0A]"
                  : "bg-[#1E1E1E] border-[#2A2A2A] text-[#999999] hover:border-[#3A3A3A]"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Submit */}
      <button type="submit" disabled={loading || !request.trim()}
        className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-[#0A0A0A] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${btnClass}`}
      >
        {loading ? (
          <><Loader2 className="size-4 animate-spin" /> Generating...</>
        ) : (
          <><Sparkles className="size-4" /> Generate {domain === "recipe" ? "Recipe" : domain === "patisserie" ? "Pastry Recipe" : "Drink Recipe"}</>
        )}
      </button>
    </form>
  );
}

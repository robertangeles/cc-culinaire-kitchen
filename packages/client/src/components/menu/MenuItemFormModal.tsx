/**
 * @module components/menu/MenuItemFormModal
 *
 * Modal overlay for adding or editing a menu item.
 * Includes an ingredients sub-section with auto-calculated costs.
 * Supports "Import from Recipe" mode that pre-fills from saved recipes.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { X, Plus, Trash2, Loader2, DollarSign, Search, BookOpen, PenTool } from "lucide-react";
import type { MenuItem, MenuIngredient } from "../../hooks/useMenuItems.js";
import { IngredientPickerInline } from "../inventory/IngredientPickerInline.js";
import { convertToBaseUnit, normalizeUnit, type BaseUnit } from "@culinaire/shared";

const API = import.meta.env.VITE_API_URL ?? "";

/* ---- Default categories ---- */

const DEFAULT_CATEGORIES = [
  "Appetizers",
  "Soups & Salads",
  "Entrees",
  "Seafood",
  "Pasta",
  "Grilled",
  "Sides",
  "Desserts",
  "Beverages",
  "Cocktails",
  "Brunch",
];

const UNITS = [
  "kg", "g", "mg",
  "L", "mL", "tsp", "tbsp", "cup", "fl oz",
  "each", "dozen", "portion",
  "bottle", "can", "bag", "box", "case", "bunch",
];

/* ---- Unit mapping from recipe units to menu-compatible units ---- */

const UNIT_MAP: Record<string, string> = {
  g: "g",
  kg: "kg",
  ml: "ml",
  L: "L",
  each: "each",
  portion: "portion",
  cups: "ml",
  cup: "ml",
  tbsp: "ml",
  tsp: "ml",
  oz: "g",
  lb: "kg",
  bunch: "each",
};

/* ---- Quantity sanitizer ----
   Server expects /^\d+(\.\d{1,3})?$/. Recipe amounts can be "1/2", "to taste",
   "" — coerce to a numeric string, defaulting to "0" when no number is found. */
function sanitizeQuantity(raw: string): string {
  const m = String(raw ?? "").match(/(\d+(?:\.\d{1,3})?)/);
  return m ? m[1] : "0";
}

function parseServingsFromYield(yieldStr: string | undefined): number {
  if (!yieldStr) return 1;
  const match = yieldStr.match(/(\d+)/);
  return match ? Math.max(1, parseInt(match[1], 10)) : 1;
}

/* ---- Domain → category mapping ---- */

const DOMAIN_CATEGORY_MAP: Record<string, string> = {
  recipe: "Entrees",
  patisserie: "Desserts",
  spirits: "Beverages",
};

/* ---- Domain badge styling ---- */

const DOMAIN_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  recipe: { label: "Recipe Lab", bg: "bg-[#D4A574]/20", text: "text-[#D4A574]" },
  patisserie: { label: "Patisserie", bg: "bg-pink-500/20", text: "text-pink-400" },
  spirits: { label: "Spirits", bg: "bg-blue-500/20", text: "text-blue-400" },
};

/* ---- Import recipe types ---- */

interface ImportIngredient {
  name: string;
  amount: string;
  unit: string;
  note?: string;
}

interface ImportRecipe {
  recipeId: string;
  title: string;
  domain: string;
  ownerName?: string;
  yield?: string;
  ingredients: ImportIngredient[];
}

/* ---- Ingredient row type ---- */

interface IngredientRow {
  tempId: number;
  existingId?: number;
  ingredientId?: string | null;
  ingredientName: string;
  note?: string | null;
  quantity: string;
  unit: string;
  /** The catalog ingredient's KITCHEN unit (what unitCost is denominated in). */
  baseUnit?: string;
  /** Content equivalence: 1 kitchen unit contains contentQty contentUnit (1 bottle = 750 ml). */
  contentQty?: string | null;
  contentUnit?: string | null;
  unitCost: string;
  yieldPct: string;
  costStaleInd?: boolean;
}

/**
 * Convert a recipe-line qty to the ingredient's KITCHEN unit (client mirror of
 * the server resolver's relevant steps): exact match → content equivalence
 * ("150 ml of a bottle-counted wine" → 0.2 bottle) → same-family standard
 * conversion. Returns null when no path exists (unit mismatch).
 */
function toKitchenQty(row: IngredientRow, qty: number): number | null {
  if (!row.baseUnit || row.unit === row.baseUnit) return qty;
  // Content equivalence: measured entry against a counted kitchen unit.
  const contentQty = row.contentQty ? parseFloat(row.contentQty) : 0;
  if (contentQty > 0 && row.contentUnit) {
    const from = normalizeUnit(row.unit);
    const content = normalizeUnit(row.contentUnit);
    if (from && content) {
      try {
        return convertToBaseUnit(qty, from as BaseUnit, content as BaseUnit) / contentQty;
      } catch {
        // different family than the content unit — fall through
      }
    }
  }
  // Same-family standard conversion straight to the kitchen unit.
  const from = normalizeUnit(row.unit);
  const to = normalizeUnit(row.baseUnit);
  if (from && to) {
    try {
      return convertToBaseUnit(qty, from as BaseUnit, to as BaseUnit);
    } catch {
      return null;
    }
  }
  return null;
}

function calcLineCost(row: IngredientRow): number {
  const qty = parseFloat(row.quantity) || 0;
  const cost = parseFloat(row.unitCost) || 0;
  const yld = parseFloat(row.yieldPct) || 100;
  if (yld === 0) return 0;

  const qtyInBase = toKitchenQty(row, qty);
  if (qtyInBase === null) return 0;
  const raw = (qtyInBase * cost) / (yld / 100);
  return Math.round(raw * 100) / 100;
}

function hasUnitMismatch(row: IngredientRow): boolean {
  if (!row.baseUnit || !row.ingredientId || row.unit === row.baseUnit) return false;
  return toKitchenQty(row, 1) === null;
}

function buildConversionText(row: IngredientRow): string | null {
  if (!row.ingredientId || !row.baseUnit) return null;
  const qty = parseFloat(row.quantity) || 0;
  const cost = parseFloat(row.unitCost) || 0;
  const yld = parseFloat(row.yieldPct) || 100;
  if (qty === 0 && cost === 0) return null;

  const resolved = toKitchenQty(row, qty);
  const qtyInBase = resolved ?? qty;
  const converted = resolved !== null && row.unit !== row.baseUnit;

  const qtyStr = converted
    ? `${qty}${row.unit} = ${Number(qtyInBase.toFixed(4))} ${row.baseUnit}`
    : `${Number(qtyInBase.toFixed(4))} ${row.baseUnit}`;
  const costStr = `$${cost.toFixed(4)}/${row.baseUnit}`;
  const lineCost = yld > 0 ? (qtyInBase * cost) / (yld / 100) : 0;

  if (yld !== 100) {
    return `${qtyStr} × ${costStr} / ${yld}% yield = $${lineCost.toFixed(2)}`;
  }
  return `${qtyStr} × ${costStr} = $${lineCost.toFixed(2)}`;
}

/* ---- Component ---- */

interface MenuItemFormModalProps {
  editItem: MenuItem | null;
  existingIngredients: MenuIngredient[];
  categories: string[];
  onSave: (data: {
    name: string;
    category: string;
    sellingPrice: string;
    servings: number;
    qFactorPct: string;
    unitsSold: number;
  }) => Promise<string | void>;
  onSaveIngredients: (
    itemId: string,
    ingredients: {
      ingredientId?: string | null;
      ingredientName: string;
      note?: string | null;
      quantity: string;
      unit: string;
      unitCost?: string;
      yieldPct: string;
    }[]
  ) => Promise<void>;
  /**
   * Phase 3: refresh a Catalog-linked row's cost from the Catalog. Optional;
   * the chip's Refresh affordance only renders when this is provided.
   */
  onRefreshIngredientCost?: (itemId: string, rowId: number) => Promise<MenuIngredient>;
  onClose: () => void;
}

let nextTempId = 1;

export function MenuItemFormModal({
  editItem,
  existingIngredients,
  categories,
  onSave,
  onSaveIngredients,
  onRefreshIngredientCost,
  onClose,
}: MenuItemFormModalProps) {
  const isEdit = !!editItem;

  // Mode toggle: "import" or "scratch"
  const [mode, setMode] = useState<"import" | "scratch">(isEdit ? "scratch" : "import");
  const [importedFromRecipe, setImportedFromRecipe] = useState(false);

  // Import state
  const [importRecipes, setImportRecipes] = useState<ImportRecipe[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [importSearch, setImportSearch] = useState("");

  // Item fields
  const [name, setName] = useState(editItem?.name ?? "");
  const [category, setCategory] = useState(editItem?.category ?? "");
  const [customCategory, setCustomCategory] = useState("");
  const [sellingPrice, setSellingPrice] = useState(
    editItem ? editItem.sellingPrice.toFixed(2) : ""
  );
  const [servings, setServings] = useState(editItem?.servings ?? 1);
  const [qFactorPct, setQFactorPct] = useState(editItem?.qFactorPct?.toString() ?? "0");
  const [unitsSold, setUnitsSold] = useState(editItem?.unitsSold ?? 0);
  const [expandedCostRow, setExpandedCostRow] = useState<number | null>(null);

  // Ingredients
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // All categories (merged defaults + existing + custom)
  const allCategories = useMemo(() => {
    const set = new Set([...DEFAULT_CATEGORIES, ...categories]);
    return Array.from(set).sort();
  }, [categories]);

  // Initialize ingredients from existing data when editing
  useEffect(() => {
    if (existingIngredients.length > 0) {
      setIngredients(
        existingIngredients.map((ing) => ({
          tempId: nextTempId++,
          existingId: ing.id,
          ingredientId: ing.ingredientId ?? null,
          ingredientName: ing.ingredientName,
          note: ing.note ?? null,
          quantity: ing.quantity,
          unit: ing.unit,
          baseUnit: ing.baseUnit ?? ing.unit,
          contentQty: ing.contentQty ?? null,
          contentUnit: ing.contentUnit ?? null,
          // A linked row with a stored cost of 0 means "no override yet" —
          // show the catalog's current cost instead of a frozen $0.
          unitCost:
            (parseFloat(ing.unitCost) || 0) > 0
              ? ing.unitCost
              : ing.ingredientId && ing.catalogUnitCost
                ? ing.catalogUnitCost
                : ing.unitCost,
          yieldPct: ing.yieldPct ? String(parseFloat(ing.yieldPct)) : "100",
          costStaleInd: ing.costStaleInd ?? false,
        }))
      );
    }
  }, [existingIngredients]);

  // Fetch recipes for import when switching to import mode
  const fetchRecipesForImport = useCallback(async () => {
    setImportLoading(true);
    setImportError("");
    try {
      const res = await fetch(`${API}/api/recipes/for-import`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load recipes");
      const data = await res.json();
      setImportRecipes(data.recipes ?? []);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to load recipes");
    } finally {
      setImportLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "import" && importRecipes.length === 0 && !importLoading) {
      fetchRecipesForImport();
    }
  }, [mode, importRecipes.length, importLoading, fetchRecipesForImport]);

  // Filter recipes by search term
  const filteredRecipes = useMemo(() => {
    if (!importSearch.trim()) return importRecipes;
    const q = importSearch.toLowerCase();
    return importRecipes.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.domain.toLowerCase().includes(q) ||
        (r.ownerName && r.ownerName.toLowerCase().includes(q))
    );
  }, [importRecipes, importSearch]);

  // Group recipes by domain
  const groupedRecipes = useMemo(() => {
    const groups: Record<string, ImportRecipe[]> = {};
    for (const r of filteredRecipes) {
      const key = r.domain;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    // Sort domains in a fixed order
    const order = ["recipe", "patisserie", "spirits"];
    const sorted: [string, ImportRecipe[]][] = [];
    for (const d of order) {
      if (groups[d]) sorted.push([d, groups[d]]);
    }
    // Any other domains
    for (const [k, v] of Object.entries(groups)) {
      if (!order.includes(k)) sorted.push([k, v]);
    }
    return sorted;
  }, [filteredRecipes]);

  // Handle recipe selection for import.
  // Ingredients import as-is with ingredientId: null. The chef manually
  // links each one to a Catalog item via the IngredientPicker on the row.
  function handleSelectRecipe(recipe: ImportRecipe) {
    setName(recipe.title);
    setCategory(DOMAIN_CATEGORY_MAP[recipe.domain] ?? "");
    setSellingPrice("");
    setServings(parseServingsFromYield(recipe.yield));

    const mapped: IngredientRow[] = recipe.ingredients.map((ing) => {
      const mappedUnit = UNIT_MAP[ing.unit.toLowerCase()] ?? UNIT_MAP[ing.unit] ?? "each";

      return {
        tempId: nextTempId++,
        ingredientId: null,
        ingredientName: ing.name,
        note: ing.note ?? null,
        quantity: sanitizeQuantity(ing.amount),
        unit: mappedUnit,
        unitCost: "",
        yieldPct: "100",
      };
    });

    setIngredients(mapped);
    setImportedFromRecipe(true);
    setMode("scratch");
  }

  // Auto-calculated totals
  const totalBatchCost = useMemo(
    () => ingredients.reduce((sum, row) => sum + calcLineCost(row), 0),
    [ingredients]
  );
  const perServingCost = servings > 1 ? totalBatchCost / servings : totalBatchCost;
  const qPct = parseFloat(qFactorPct) || 0;
  const foodCostWithQ = qPct > 0 ? perServingCost * (1 + qPct / 100) : perServingCost;

  const price = parseFloat(sellingPrice) || 0;
  const foodCostPct = price > 0 ? (foodCostWithQ / price) * 100 : 0;
  const contributionMargin = price - foodCostWithQ;

  function addIngredientRow() {
    setIngredients((prev) => [
      ...prev,
      {
        tempId: nextTempId++,
        ingredientId: null,
        ingredientName: "",
        note: null,
        quantity: "",
        unit: "kg",
        unitCost: "",
        yieldPct: "100",
      },
    ]);
  }

  function removeIngredientRow(tempId: number) {
    setIngredients((prev) => prev.filter((r) => r.tempId !== tempId));
  }

  function updateIngredient(
    tempId: number,
    field: keyof IngredientRow,
    value: string
  ) {
    setIngredients((prev) =>
      prev.map((r) => (r.tempId === tempId ? { ...r, [field]: value } : r))
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const finalCategory =
      category === "__custom" ? customCategory.trim() : category;
    if (!name.trim() || !finalCategory || !sellingPrice) {
      setError("Please fill in all required fields.");
      return;
    }

    setSaving(true);
    try {
      const result = await onSave({
        name: name.trim(),
        category: finalCategory,
        sellingPrice,
        servings,
        qFactorPct: qFactorPct || "0",
        unitsSold,
      });

      // Save ingredients if we have any
      const validIngredients = ingredients.filter(
        (r) => r.ingredientName.trim() && r.quantity
      );
      if (validIngredients.length > 0) {
        const itemId = editItem?.menuItemId ?? (result as string);
        if (itemId) {
          await onSaveIngredients(
            itemId,
            validIngredients.map((r) => ({
              ingredientId: r.ingredientId ?? null,
              ingredientName: r.ingredientName.trim(),
              note: r.note ?? null,
              quantity: r.quantity,
              unit: r.unit,
              unitCost: r.unitCost || undefined,
              yieldPct: r.yieldPct || "100",
            }))
          );
        }
      }

      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save menu item."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-[#161616] rounded-2xl border border-[#2A2A2A] shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[#161616] border-b border-[#2A2A2A] px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-lg font-bold text-[#FAFAFA]">
            {isEdit ? "Edit Menu Item" : "Add Menu Item"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-[#2A2A2A] text-[#666666] hover:text-[#FAFAFA] transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Mode toggle — only for new items */}
          {!isEdit && !importedFromRecipe && (
            <div className="flex gap-1 p-1 bg-[#0A0A0A] rounded-xl border border-[#2A2A2A]">
              <button
                type="button"
                onClick={() => setMode("import")}
                className={`flex items-center gap-2 flex-1 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                  mode === "import"
                    ? "bg-[#D4A574] text-[#0A0A0A]"
                    : "bg-[#1E1E1E] text-[#999999] hover:text-[#FAFAFA]"
                }`}
              >
                <BookOpen className="size-4" />
                Import from Recipe
              </button>
              <button
                type="button"
                onClick={() => setMode("scratch")}
                className={`flex items-center gap-2 flex-1 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                  mode === "scratch"
                    ? "bg-[#D4A574] text-[#0A0A0A]"
                    : "bg-[#1E1E1E] text-[#999999] hover:text-[#FAFAFA]"
                }`}
              >
                <PenTool className="size-4" />
                Create from Scratch
              </button>
            </div>
          )}

          {/* Import mode UI */}
          {mode === "import" && !isEdit && (
            <div className="space-y-4">
              {/* Search bar */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#666666]" />
                <input
                  type="text"
                  value={importSearch}
                  onChange={(e) => setImportSearch(e.target.value)}
                  placeholder="Search recipes..."
                  className="w-full pl-10 pr-4 py-2.5 text-sm bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574]/50 min-h-[44px]"
                />
              </div>

              {/* Recipe list */}
              {importLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-[#D4A574]" />
                  <span className="ml-2 text-sm text-[#999999]">Loading recipes...</span>
                </div>
              )}

              {importError && (
                <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
                  {importError}
                </div>
              )}

              {!importLoading && !importError && filteredRecipes.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-sm text-[#666666]">
                    {importRecipes.length === 0
                      ? "No saved recipes found. Create recipes in the Recipe Lab first."
                      : "No recipes match your search."}
                  </p>
                </div>
              )}

              {!importLoading && groupedRecipes.length > 0 && (
                <div className="bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl max-h-[300px] overflow-y-auto">
                  {groupedRecipes.map(([domain, recipes]) => {
                    const badge = DOMAIN_BADGE[domain] ?? {
                      label: domain,
                      bg: "bg-[#2A2A2A]",
                      text: "text-[#999999]",
                    };
                    return (
                      <div key={domain}>
                        {/* Domain header */}
                        <div className="sticky top-0 bg-[#0A0A0A] px-4 py-2 border-b border-[#2A2A2A]">
                          <span
                            className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${badge.bg} ${badge.text}`}
                          >
                            {badge.label}
                          </span>
                        </div>
                        {/* Recipe items */}
                        {recipes.map((recipe) => (
                          <button
                            key={recipe.recipeId}
                            type="button"
                            onClick={() => handleSelectRecipe(recipe)}
                            className="w-full text-left hover:bg-[#1E1E1E] px-4 py-3 cursor-pointer transition-colors border-b border-[#2A2A2A]/50 last:border-b-0"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-[#FAFAFA] font-medium truncate">
                                  {recipe.title}
                                  {recipe.ownerName && (
                                    <span className="text-[#666666] font-normal ml-1.5">
                                      (by {recipe.ownerName})
                                    </span>
                                  )}
                                </p>
                              </div>
                              <span className="ml-3 text-xs text-[#666666] whitespace-nowrap">
                                {recipe.ingredients.length} ingredient{recipe.ingredients.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Form (scratch mode or after import selection) */}
          {(mode === "scratch" || isEdit) && (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Import banner */}
              {importedFromRecipe && (
                <div className="bg-[#D4A574]/10 border border-[#D4A574]/20 text-[#D4A574] rounded-xl p-3 text-sm">
                  Ingredients imported — link each to a Catalog item, then set your selling price
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
                  {error}
                </div>
              )}

              {/* Basic fields */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#999999] mb-1.5">
                    Item Name *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Pan-Seared Salmon"
                    required
                    className="w-full px-4 py-2.5 text-sm bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574]/50 min-h-[44px]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#999999] mb-1.5">
                      Category *
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      required
                      className="w-full px-4 py-2.5 text-sm bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl text-[#FAFAFA] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574]/50 min-h-[44px]"
                    >
                      <option value="">Select category...</option>
                      {allCategories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                      <option value="__custom">+ Custom category</option>
                    </select>
                    {category === "__custom" && (
                      <input
                        type="text"
                        value={customCategory}
                        onChange={(e) => setCustomCategory(e.target.value)}
                        placeholder="Enter category name"
                        className="mt-2 w-full px-4 py-2.5 text-sm bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574]/50 min-h-[44px]"
                      />
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#999999] mb-1.5">
                      Selling Price ($) *
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={sellingPrice}
                      onChange={(e) => setSellingPrice(e.target.value)}
                      placeholder="0.00"
                      required
                      className="w-full px-4 py-2.5 text-sm bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574]/50 min-h-[44px]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#999999] mb-1.5">
                      Servings per Recipe
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={servings}
                      onChange={(e) => setServings(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full px-4 py-2.5 text-sm bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574]/50 min-h-[44px]"
                    />
                    <p className="mt-1 text-[10px] text-[#666666]">
                      How many plates does this recipe produce?
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#999999] mb-1.5">
                      Q Factor %
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="50"
                      step="0.5"
                      value={qFactorPct}
                      onChange={(e) => setQFactorPct(e.target.value)}
                      placeholder="0"
                      className="w-full px-4 py-2.5 text-sm bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574]/50 min-h-[44px]"
                    />
                    <p className="mt-1 text-[10px] text-[#666666]">
                      Waste, condiments, disposables buffer (typically 5-10%)
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#999999] mb-1.5">
                      Units Sold
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={unitsSold}
                      onChange={(e) => setUnitsSold(parseInt(e.target.value) || 0)}
                      placeholder="0"
                      className="w-full px-4 py-2.5 text-sm bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574]/50 min-h-[44px]"
                    />
                    <p className="mt-1 text-[10px] text-[#666666]">
                      From POS or manual entry
                    </p>
                  </div>
                </div>
              </div>

              {/* Ingredients sub-section */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-[#FAFAFA]">
                    Ingredients
                  </h3>
                  <button
                    type="button"
                    onClick={addIngredientRow}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#D4A574] bg-[#D4A574]/10 rounded-lg border border-[#D4A574]/20 hover:bg-[#D4A574]/20 transition-colors min-h-[36px]"
                  >
                    <Plus className="size-3" />
                    Add Ingredient
                  </button>
                </div>

                {ingredients.length > 0 && (
                  <div className="space-y-2">
                    {/* Header row */}
                    <div
                      className="grid gap-2 text-[10px] uppercase text-[#666666] font-medium px-1"
                      style={{ gridTemplateColumns: "1fr 80px 70px 85px 65px 80px 36px" }}
                    >
                      <div>Name</div>
                      <div>Qty</div>
                      <div>Unit</div>
                      <div>Cost</div>
                      <div>Yield %</div>
                      <div className="text-right">Line Cost</div>
                      <div />
                    </div>

                    {ingredients.map((row) => {
                      const lineCost = calcLineCost(row);
                      const unitMismatch = hasUnitMismatch(row);
                      const breakdown = expandedCostRow === row.tempId ? buildConversionText(row) : null;
                      return (
                        <div key={row.tempId}>
                        <div
                          className="grid gap-2 items-start"
                          style={{ gridTemplateColumns: "1fr 80px 70px 85px 65px 80px 36px" }}
                        >
                          <div className="min-w-0">
                            <IngredientPickerInline
                              linkedId={row.ingredientId}
                              displayName={row.ingredientName}
                              costStale={row.costStaleInd}
                              onRefresh={
                                row.existingId && onRefreshIngredientCost && editItem
                                  ? async () => {
                                      try {
                                        const updated = await onRefreshIngredientCost(
                                          editItem.menuItemId,
                                          row.existingId!,
                                        );
                                        setIngredients((prev) =>
                                          prev.map((r) =>
                                            r.tempId === row.tempId
                                              ? {
                                                  ...r,
                                                  unitCost: updated.unitCost,
                                                  costStaleInd: false,
                                                }
                                              : r,
                                          ),
                                        );
                                      } catch (e) {
                                        setError(
                                          e instanceof Error
                                            ? e.message
                                            : "Failed to refresh cost",
                                        );
                                      }
                                    }
                                  : undefined
                              }
                              onPick={(picked) => {
                                setIngredients((prev) =>
                                  prev.map((r) =>
                                    r.tempId === row.tempId
                                      ? {
                                          ...r,
                                          ingredientId: picked.ingredientId,
                                          ingredientName: picked.ingredientName,
                                          baseUnit: picked.baseUnit || r.unit,
                                          contentQty: picked.contentQty ?? null,
                                          contentUnit: picked.contentUnit ?? null,
                                          // Recipes default to the MEASURED unit when the item
                                          // has a content equivalence (pour wine in mL even
                                          // though it's counted in bottles); else the kitchen unit.
                                          unit: picked.contentUnit || picked.baseUnit || r.unit,
                                          unitCost: picked.preferredUnitCost || r.unitCost,
                                          costStaleInd: false,
                                        }
                                      : r,
                                  ),
                                );
                              }}
                              onTextChange={(text) =>
                                updateIngredient(row.tempId, "ingredientName", text)
                              }
                            />
                            {row.note && (
                              <div className="mt-1 px-2 py-1 text-[10px] text-[#999] italic truncate" title={row.note}>
                                {row.note}
                              </div>
                            )}
                          </div>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            max="999.99"
                            value={row.quantity}
                            onChange={(e) =>
                              updateIngredient(
                                row.tempId,
                                "quantity",
                                e.target.value
                              )
                            }
                            placeholder="0"
                            className="w-full px-2 py-2 text-xs bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:ring-1 focus:ring-[#D4A574]/50 min-h-[36px]"
                          />
                          <select
                            value={row.unit}
                            onChange={(e) =>
                              updateIngredient(
                                row.tempId,
                                "unit",
                                e.target.value
                              )
                            }
                            className="w-full px-1.5 py-2 text-xs bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg text-[#FAFAFA] focus:outline-none focus:ring-1 focus:ring-[#D4A574]/50 min-h-[36px]"
                          >
                            {UNITS.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                          <div className="relative">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={row.unitCost}
                              onChange={(e) =>
                                updateIngredient(
                                  row.tempId,
                                  "unitCost",
                                  e.target.value
                                )
                              }
                              placeholder="0.00"
                              className="w-full px-2 py-2 text-xs bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:ring-1 focus:ring-[#D4A574]/50 min-h-[36px]"
                            />
                          </div>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            max="100"
                            value={row.yieldPct}
                            onChange={(e) =>
                              updateIngredient(
                                row.tempId,
                                "yieldPct",
                                e.target.value
                              )
                            }
                            className="w-full px-1.5 py-2 text-xs bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg text-[#FAFAFA] focus:outline-none focus:ring-1 focus:ring-[#D4A574]/50 min-h-[36px] text-center"
                          />
                          <button
                            type="button"
                            onClick={() => setExpandedCostRow(expandedCostRow === row.tempId ? null : row.tempId)}
                            className="text-xs text-[#999999] font-mono min-h-[36px] flex items-center justify-end hover:text-[#D4A574] transition-colors cursor-pointer"
                            title={row.ingredientId ? "Tap to see cost breakdown" : undefined}
                          >
                            ${lineCost.toFixed(2)}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeIngredientRow(row.tempId)}
                            className="p-1.5 rounded-lg hover:bg-[#2A2A2A] text-[#666666] hover:text-red-400 transition-colors flex items-center justify-center min-h-[36px]"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        {breakdown && (
                          <div className="px-2 pb-1 text-[10px] text-[#D4A574]/80 font-mono">
                            {breakdown}
                          </div>
                        )}
                        {unitMismatch && (
                          <div className="px-2 pb-1 text-[10px] text-red-400">
                            Unit mismatch: {row.unit} cannot convert to {row.baseUnit}. Change the unit to calculate cost.
                          </div>
                        )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {ingredients.length === 0 && (
                  <p className="text-xs text-[#666666] py-4 text-center">
                    No ingredients added yet. Click "Add Ingredient" to build the
                    cost breakdown.
                  </p>
                )}
              </div>

              {/* Cost summary */}
              <div className="bg-[#0A0A0A] rounded-xl border border-[#2A2A2A] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <DollarSign className="size-4 text-[#D4A574]" />
                  <h4 className="text-sm font-semibold text-[#FAFAFA]">
                    Cost Summary
                  </h4>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-[10px] uppercase text-[#666666] mb-0.5">
                      Food Cost / Serving
                    </p>
                    <p className="text-lg font-bold text-[#FAFAFA]">
                      ${foodCostWithQ.toFixed(2)}
                    </p>
                    {(servings > 1 || qPct > 0) && (
                      <p className="text-[10px] text-[#666666]">
                        {servings > 1 && <>Batch: ${totalBatchCost.toFixed(2)} ({servings} servings)</>}
                        {servings > 1 && qPct > 0 && " · "}
                        {qPct > 0 && <>+{qPct}% Q Factor</>}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-[#666666] mb-0.5">
                      Food Cost %
                    </p>
                    <p
                      className={`text-lg font-bold ${
                        foodCostPct > 35 ? "text-red-400" : "text-[#FAFAFA]"
                      }`}
                    >
                      {foodCostPct.toFixed(1)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-[#666666] mb-0.5">
                      Contribution Margin
                    </p>
                    <p
                      className={`text-lg font-bold ${
                        contributionMargin < 0 ? "text-red-400" : "text-green-400"
                      }`}
                    >
                      ${contributionMargin.toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 text-sm font-medium text-[#999999] bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl hover:bg-[#1E1E1E] hover:text-[#FAFAFA] transition-colors min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium bg-[#D4A574] hover:bg-[#C4956A] text-white rounded-xl transition-colors disabled:opacity-50 min-h-[44px]"
                >
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  {isEdit ? "Update Item" : "Save Item"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

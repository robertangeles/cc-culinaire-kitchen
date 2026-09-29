/**
 * @module components/menu/MenuItemFormModal
 *
 * Modal overlay for adding or editing a menu item.
 * Includes an ingredients sub-section with auto-calculated costs.
 * Supports "Import from Recipe" mode that pre-fills from saved recipes.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { X, Loader2 } from "lucide-react";
import type { MenuItem, MenuIngredient } from "../../hooks/useMenuItems.js";
import type { CustomConversion } from "@culinaire/shared";
import { CostSummary } from "./CostSummary.js";
import { RecipeImportPanel, type ImportRecipe } from "./RecipeImportPanel.js";
import { IngredientsSection, type IngredientRow, calcLineCost } from "./IngredientsSection.js";

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

/* ---- Domain → category mapping ---- */

const DOMAIN_CATEGORY_MAP: Record<string, string> = {
  recipe: "Entrees",
  patisserie: "Desserts",
  spirits: "Beverages",
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
    servingsPerSale: number;
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
  // Sales-unit size (meez: yield ≠ portion): price covers this many servings.
  const [servingsPerSale, setServingsPerSale] = useState(editItem?.servingsPerSale ?? 1);
  const [qFactorPct, setQFactorPct] = useState(editItem?.qFactorPct?.toString() ?? "0");
  const [unitsSold, setUnitsSold] = useState(editItem?.unitsSold ?? 0);
  const [expandedCostRow, setExpandedCostRow] = useState<number | null>(null);

  // Ingredients
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);

  // Per-ingredient custom unit_conversion rows (resolver step 3), fetched
  // lazily once per ingredient per form session. "loading" marks an in-flight
  // fetch; a failed fetch deletes the key so the next dropdown open retries.
  const conversionsCache = useRef(new Map<string, CustomConversion[] | "loading">());
  const [conversionsVersion, setConversionsVersion] = useState(0);
  const ensureConversions = useCallback((ingredientId?: string | null) => {
    if (!ingredientId) return;
    const cache = conversionsCache.current;
    if (cache.has(ingredientId)) return;
    cache.set(ingredientId, "loading");
    setConversionsVersion((v) => v + 1);
    fetch(`${API}/api/inventory/ingredients/${ingredientId}/conversions`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { conversions?: Array<{ fromUnit: string; toBaseFactor: string }> }) => {
        cache.set(
          ingredientId,
          (body.conversions ?? []).map((c) => ({ fromUnit: c.fromUnit, toBaseFactor: c.toBaseFactor })),
        );
      })
      .catch(() => {
        cache.delete(ingredientId); // safe subset now; retry on next open
      })
      .finally(() => setConversionsVersion((v) => v + 1));
  }, []);
  const conversionsFor = (ingredientId?: string | null): CustomConversion[] => {
    if (!ingredientId) return [];
    const entry = conversionsCache.current.get(ingredientId);
    return Array.isArray(entry) ? entry : [];
  };
  const conversionsLoading = (ingredientId?: string | null): boolean =>
    Boolean(ingredientId) && conversionsCache.current.get(ingredientId!) === "loading";

  // Prefetch custom conversions for every linked row as soon as rows exist.
  useEffect(() => {
    for (const row of ingredients) ensureConversions(row.ingredientId);
  }, [ingredients, ensureConversions]);

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
          densityGPerMl: ing.densityGPerMl ?? null,
          purchaseUnit: ing.purchaseUnit ?? null,
          packQty: ing.packQty ?? null,
          costUpdatedAt: ing.costUpdatedAt ?? null,
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
    if (mode === "import" && importRecipes.length === 0 && !importLoading && !importError) {
      fetchRecipesForImport();
    }
  }, [mode, importRecipes.length, importLoading, importError, fetchRecipesForImport]);

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
    const order = ["recipe", "patisserie", "spirits"];
    const sorted: [string, ImportRecipe[]][] = [];
    for (const d of order) {
      if (groups[d]) sorted.push([d, groups[d]]);
    }
    for (const [k, v] of Object.entries(groups)) {
      if (!order.includes(k)) sorted.push([k, v]);
    }
    return sorted;
  }, [filteredRecipes]);

  // Handle recipe selection for import.
  function handleSelectRecipe(recipe: ImportRecipe) {
    setName(recipe.title);
    setCategory(DOMAIN_CATEGORY_MAP[recipe.domain] ?? "");
    setSellingPrice("");
    setServings(parseServingsFromYield(recipe.yield));
    setServingsPerSale(1);

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

  // Ingredient row helpers
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

  function updateIngredient(tempId: number, field: keyof IngredientRow, value: string) {
    setIngredients((prev) =>
      prev.map((r) => (r.tempId === tempId ? { ...r, [field]: value } : r))
    );
  }

  // Auto-calculated totals
  const totalBatchCost = useMemo(
    () => ingredients.reduce((sum, row) => sum + calcLineCost(row, conversionsFor(row.ingredientId)), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- conversionsVersion invalidates when a conversions fetch lands
    [ingredients, conversionsVersion]
  );
  const perServingCost = servings > 1 ? totalBatchCost / servings : totalBatchCost;
  const qPct = parseFloat(qFactorPct) || 0;
  const foodCostWithQ = qPct > 0 ? perServingCost * (1 + qPct / 100) : perServingCost;

  const price = parseFloat(sellingPrice) || 0;
  const salePack = Math.max(1, servingsPerSale || 1);
  const foodCostPerSale = foodCostWithQ * salePack;
  const foodCostPct = price > 0 ? (foodCostPerSale / price) * 100 : 0;
  const contributionMargin = price - foodCostPerSale;

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
    let savedItemId: string | undefined;
    try {
      const result = await onSave({
        name: name.trim(),
        category: finalCategory,
        sellingPrice,
        servings,
        servingsPerSale,
        qFactorPct: qFactorPct || "0",
        unitsSold,
      });
      savedItemId = editItem?.menuItemId ?? (result as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save menu item.");
      setSaving(false);
      return;
    }

    const validIngredients = ingredients.filter(
      (r) => r.ingredientName.trim() && r.quantity
    );
    if (validIngredients.length > 0 && savedItemId) {
      try {
        await onSaveIngredients(
          savedItemId,
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
      } catch {
        // Item was created but ingredients failed — keep modal open; user can retry ingredients.
        setError("Item saved, but ingredients failed to save. Edit the item to add them.");
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-dark-50 rounded-2xl border border-dark-200 shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-dark-50 border-b border-dark-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-lg font-bold text-[#FAFAFA]">
            {isEdit ? "Edit Menu Item" : "Add Menu Item"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-dark-200 text-dark-500 hover:text-[#FAFAFA] transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          <RecipeImportPanel
            isEdit={isEdit}
            mode={mode}
            importedFromRecipe={importedFromRecipe}
            recipes={importRecipes}
            loading={importLoading}
            error={importError}
            search={importSearch}
            groupedRecipes={groupedRecipes}
            filteredRecipes={filteredRecipes}
            onModeChange={setMode}
            onSearchChange={setImportSearch}
            onSelectRecipe={handleSelectRecipe}
          />

          {/* Form (scratch mode or after import selection) */}
          {(mode === "scratch" || isEdit) && (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Import banner */}
              {importedFromRecipe && (
                <div className="bg-gold/10 border border-gold/20 text-gold rounded-xl p-3 text-sm">
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
                  <label className="block text-xs font-medium text-dark-600 mb-1.5">
                    Item Name *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Pan-Seared Salmon"
                    required
                    className="w-full px-4 py-2.5 text-sm bg-dark border border-dark-200 rounded-xl text-[#FAFAFA] placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50 min-h-[44px]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1.5">
                      Category *
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      required
                      className="w-full px-4 py-2.5 text-sm bg-dark border border-dark-200 rounded-xl text-[#FAFAFA] focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50 min-h-[44px]"
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
                        className="mt-2 w-full px-4 py-2.5 text-sm bg-dark border border-dark-200 rounded-xl text-[#FAFAFA] placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50 min-h-[44px]"
                      />
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1.5">
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
                      className="w-full px-4 py-2.5 text-sm bg-dark border border-dark-200 rounded-xl text-[#FAFAFA] placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50 min-h-[44px]"
                    />
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] text-dark-500">Price covers</span>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        max="999"
                        value={servingsPerSale}
                        onChange={(e) =>
                          setServingsPerSale(Math.max(1, parseInt(e.target.value, 10) || 1))
                        }
                        className="w-14 px-2 py-1 text-xs bg-dark border border-dark-200 rounded-lg text-[#FAFAFA] text-center focus:outline-none focus:ring-1 focus:ring-gold/50"
                      />
                      <span className="text-[10px] text-dark-500">
                        serving{servingsPerSale === 1 ? "" : "s"}
                        {servingsPerSale > 1 ? " (pack pricing)" : " (sold singly)"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1.5">
                      Servings per Recipe
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={servings}
                      onChange={(e) => setServings(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full px-4 py-2.5 text-sm bg-dark border border-dark-200 rounded-xl text-[#FAFAFA] placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50 min-h-[44px]"
                    />
                    <p className="mt-1 text-[10px] text-dark-500">
                      How many plates does this recipe produce?
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1.5">
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
                      className="w-full px-4 py-2.5 text-sm bg-dark border border-dark-200 rounded-xl text-[#FAFAFA] placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50 min-h-[44px]"
                    />
                    <p className="mt-1 text-[10px] text-dark-500">
                      Waste, condiments, disposables buffer (typically 5-10%)
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-dark-600 mb-1.5">
                      Units Sold
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={unitsSold}
                      onChange={(e) => setUnitsSold(parseInt(e.target.value) || 0)}
                      placeholder="0"
                      className="w-full px-4 py-2.5 text-sm bg-dark border border-dark-200 rounded-xl text-[#FAFAFA] placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50 min-h-[44px]"
                    />
                    <p className="mt-1 text-[10px] text-dark-500">From POS or manual entry</p>
                  </div>
                </div>
              </div>

              <IngredientsSection
                ingredients={ingredients}
                expandedCostRow={expandedCostRow}
                editItem={editItem}
                onRefreshIngredientCost={onRefreshIngredientCost}
                setIngredients={setIngredients}
                setExpandedCostRow={setExpandedCostRow}
                setError={setError}
                conversionsFor={conversionsFor}
                conversionsLoading={conversionsLoading}
                ensureConversions={ensureConversions}
                onAdd={addIngredientRow}
                onRemove={removeIngredientRow}
                onUpdate={updateIngredient}
              />

              <CostSummary
                totalBatchCost={totalBatchCost}
                ingredientCount={ingredients.length}
                servings={servings}
                qPct={qPct}
                foodCostWithQ={foodCostWithQ}
                salePack={salePack}
                foodCostPerSale={foodCostPerSale}
                foodCostPct={foodCostPct}
                contributionMargin={contributionMargin}
              />

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 text-sm font-medium text-dark-600 bg-dark border border-dark-200 rounded-xl hover:bg-dark-100 hover:text-[#FAFAFA] transition-colors min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium bg-gold hover:bg-gold-hover text-white rounded-xl transition-colors disabled:opacity-50 min-h-[44px]"
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

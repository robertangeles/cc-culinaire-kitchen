/**
 * @module components/menu/MenuItemFormModal
 *
 * Modal overlay for adding or editing a menu item.
 * Includes an ingredients sub-section with auto-calculated costs.
 */

import { useState, useEffect, useMemo } from "react";
import { X, Plus, Trash2, Loader2, DollarSign } from "lucide-react";
import type { MenuItem, MenuIngredient } from "../../hooks/useMenuItems.js";

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

const UNITS = ["kg", "g", "L", "ml", "each", "portion"];

/* ---- Ingredient row type ---- */

interface IngredientRow {
  tempId: number;
  existingId?: number;
  ingredientName: string;
  quantity: string;
  unit: string;
  unitCost: string;
  yieldPct: string;
}

function calcLineCost(row: IngredientRow): number {
  const qty = parseFloat(row.quantity) || 0;
  const cost = parseFloat(row.unitCost) || 0;
  const yld = parseFloat(row.yieldPct) || 100;
  if (yld === 0) return 0;
  return (qty * cost) / (yld / 100);
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
    unitsSold: number;
  }) => Promise<string | void>;
  onSaveIngredients: (
    itemId: string,
    ingredients: {
      ingredientName: string;
      quantity: string;
      unit: string;
      unitCost: string;
      yieldPct: string;
    }[]
  ) => Promise<void>;
  onClose: () => void;
}

let nextTempId = 1;

export function MenuItemFormModal({
  editItem,
  existingIngredients,
  categories,
  onSave,
  onSaveIngredients,
  onClose,
}: MenuItemFormModalProps) {
  const isEdit = !!editItem;

  // Item fields
  const [name, setName] = useState(editItem?.name ?? "");
  const [category, setCategory] = useState(editItem?.category ?? "");
  const [customCategory, setCustomCategory] = useState("");
  const [sellingPrice, setSellingPrice] = useState(
    editItem ? editItem.sellingPrice.toFixed(2) : ""
  );
  const [unitsSold, setUnitsSold] = useState(editItem?.unitsSold ?? 0);

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
          ingredientName: ing.ingredientName,
          quantity: ing.quantity,
          unit: ing.unit,
          unitCost: ing.unitCost,
          yieldPct: ing.yieldPct || "100",
        }))
      );
    }
  }, [existingIngredients]);

  // Auto-calculated totals
  const totalFoodCost = useMemo(
    () => ingredients.reduce((sum, row) => sum + calcLineCost(row), 0),
    [ingredients]
  );

  const price = parseFloat(sellingPrice) || 0;
  const foodCostPct = price > 0 ? (totalFoodCost / price) * 100 : 0;
  const contributionMargin = price - totalFoodCost;

  function addIngredientRow() {
    setIngredients((prev) => [
      ...prev,
      {
        tempId: nextTempId++,
        ingredientName: "",
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
        unitsSold,
      });

      // Save ingredients if we have any
      const validIngredients = ingredients.filter(
        (r) => r.ingredientName.trim() && r.quantity && r.unitCost
      );
      if (validIngredients.length > 0) {
        const itemId = editItem?.menuItemId ?? (result as string);
        if (itemId) {
          await onSaveIngredients(
            itemId,
            validIngredients.map((r) => ({
              ingredientName: r.ingredientName.trim(),
              quantity: r.quantity,
              unit: r.unit,
              unitCost: r.unitCost,
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
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#161616] rounded-2xl border border-[#2A2A2A] shadow-2xl">
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

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6">
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
                  step="0.01"
                  min="0"
                  value={sellingPrice}
                  onChange={(e) => setSellingPrice(e.target.value)}
                  placeholder="0.00"
                  required
                  className="w-full px-4 py-2.5 text-sm bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574]/50 min-h-[44px]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#999999] mb-1.5">
                Units Sold (from POS or manual entry)
              </label>
              <input
                type="number"
                min="0"
                value={unitsSold}
                onChange={(e) => setUnitsSold(parseInt(e.target.value) || 0)}
                placeholder="0"
                className="w-full sm:w-48 px-4 py-2.5 text-sm bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574]/50 min-h-[44px]"
              />
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
                <div className="grid grid-cols-12 gap-2 text-[10px] uppercase text-[#666666] font-medium px-1">
                  <div className="col-span-3">Name</div>
                  <div className="col-span-2">Quantity</div>
                  <div className="col-span-2">Unit</div>
                  <div className="col-span-2">Unit Cost ($)</div>
                  <div className="col-span-1">Yield %</div>
                  <div className="col-span-1 text-right">Line Cost</div>
                  <div className="col-span-1" />
                </div>

                {ingredients.map((row) => {
                  const lineCost = calcLineCost(row);
                  return (
                    <div
                      key={row.tempId}
                      className="grid grid-cols-12 gap-2 items-center"
                    >
                      <input
                        type="text"
                        value={row.ingredientName}
                        onChange={(e) =>
                          updateIngredient(
                            row.tempId,
                            "ingredientName",
                            e.target.value
                          )
                        }
                        placeholder="Ingredient"
                        className="col-span-3 px-3 py-2 text-xs bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:ring-1 focus:ring-[#D4A574]/50 min-h-[36px]"
                      />
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={row.quantity}
                        onChange={(e) =>
                          updateIngredient(
                            row.tempId,
                            "quantity",
                            e.target.value
                          )
                        }
                        placeholder="0"
                        className="col-span-2 px-3 py-2 text-xs bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:ring-1 focus:ring-[#D4A574]/50 min-h-[36px]"
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
                        className="col-span-2 px-3 py-2 text-xs bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg text-[#FAFAFA] focus:outline-none focus:ring-1 focus:ring-[#D4A574]/50 min-h-[36px]"
                      >
                        {UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        step="0.01"
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
                        className="col-span-2 px-3 py-2 text-xs bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:ring-1 focus:ring-[#D4A574]/50 min-h-[36px]"
                      />
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
                        className="col-span-1 px-2 py-2 text-xs bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg text-[#FAFAFA] focus:outline-none focus:ring-1 focus:ring-[#D4A574]/50 min-h-[36px] text-center"
                      />
                      <div className="col-span-1 text-right text-xs text-[#999999] font-mono">
                        ${lineCost.toFixed(2)}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeIngredientRow(row.tempId)}
                        className="col-span-1 p-1.5 rounded-lg hover:bg-[#2A2A2A] text-[#666666] hover:text-red-400 transition-colors flex items-center justify-center min-h-[36px]"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
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
                  Total Food Cost
                </p>
                <p className="text-lg font-bold text-[#FAFAFA]">
                  ${totalFoodCost.toFixed(2)}
                </p>
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
      </div>
    </div>
  );
}

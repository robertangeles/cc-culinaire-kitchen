/**
 * Slide-over panel showing menu item details:
 * ingredients, costs, classification, and AI recommendations.
 */

import { useState, useEffect } from "react";
import { X, Plus, Trash2, Loader2, Sparkles, Star, TrendingDown, HelpCircle, XCircle, ChefHat } from "lucide-react";
import { useNavigate } from "react-router";
import type { MenuItem, MenuIngredient } from "../../hooks/useMenuItems.js";
import { useMenuRecommendations } from "../../hooks/useMenuRecommendations.js";

const API = import.meta.env.VITE_API_URL ?? "";

const CLASS_INFO: Record<string, { label: string; color: string; icon: typeof Star; desc: string }> = {
  star: { label: "Star", color: "bg-amber-100 text-amber-800", icon: Star, desc: "High profit, high popularity — protect this item" },
  plowhorse: { label: "Plowhorse", color: "bg-blue-100 text-blue-800", icon: TrendingDown, desc: "High popularity but low profit — optimise costs or raise price" },
  puzzle: { label: "Puzzle", color: "bg-purple-100 text-purple-800", icon: HelpCircle, desc: "Good profit but low popularity — promote or reprice" },
  dog: { label: "Dog", color: "bg-red-100 text-red-800", icon: XCircle, desc: "Low profit, low popularity — rework or replace" },
  unclassified: { label: "Unclassified", color: "bg-stone-100 text-stone-600", icon: HelpCircle, desc: "Add sales data to classify" },
};

const ACTION_LABELS: Record<string, string> = {
  protect: "Protect",
  swap_ingredient: "Swap Ingredient",
  adjust_portion: "Adjust Portion",
  raise_price: "Raise Price",
  lower_price: "Lower Price",
  rename: "Rename",
  rewrite_description: "Rewrite Description",
  promote: "Promote",
  remove: "Remove",
  generate_replacement: "Generate Replacement",
};

interface MenuItemDetailProps {
  item: MenuItem;
  onClose: () => void;
  onAddIngredient: (itemId: string, data: { ingredientName: string; quantity: string; unit: string; unitCost: string; yieldPct?: string }) => Promise<void>;
  onRemoveIngredient: (itemId: string, ingredientId: number) => Promise<void>;
  getIngredients: (itemId: string) => Promise<MenuIngredient[]>;
}

export function MenuItemDetail({ item, onClose, onAddIngredient, onRemoveIngredient, getIngredients }: MenuItemDetailProps) {
  const navigate = useNavigate();
  const [ingredients, setIngredients] = useState<MenuIngredient[]>([]);
  const [loadingIng, setLoadingIng] = useState(true);
  const { recommendations, loading: recLoading, fetchRecommendations, generateReplacement } = useMenuRecommendations();

  // Ingredient form
  const [ingName, setIngName] = useState("");
  const [ingQty, setIngQty] = useState("");
  const [ingUnit, setIngUnit] = useState("kg");
  const [ingCost, setIngCost] = useState("");
  const [ingYield, setIngYield] = useState("100");
  const [addingIng, setAddingIng] = useState(false);

  const cls = CLASS_INFO[item.classification] ?? CLASS_INFO.unclassified;
  const ClsIcon = cls.icon;

  useEffect(() => {
    async function load() {
      setLoadingIng(true);
      const ings = await getIngredients(item.menuItemId);
      setIngredients(ings);
      setLoadingIng(false);
    }
    load();
  }, [item.menuItemId, getIngredients]);

  async function handleAddIngredient(e: React.FormEvent) {
    e.preventDefault();
    if (!ingName.trim() || !ingQty || !ingCost) return;
    setAddingIng(true);
    try {
      await onAddIngredient(item.menuItemId, {
        ingredientName: ingName.trim(),
        quantity: ingQty,
        unit: ingUnit,
        unitCost: ingCost,
        yieldPct: ingYield,
      });
      const ings = await getIngredients(item.menuItemId);
      setIngredients(ings);
      setIngName(""); setIngQty(""); setIngCost("");
    } finally {
      setAddingIng(false);
    }
  }

  async function handleRemoveIng(id: number) {
    await onRemoveIngredient(item.menuItemId, id);
    const ings = await getIngredients(item.menuItemId);
    setIngredients(ings);
  }

  async function handleGenerateReplacement() {
    const context = await generateReplacement(item.menuItemId);
    if (context) {
      navigate("/recipes", { state: { prefill: context.request } });
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white shadow-xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-bold text-stone-800">{item.name}</h2>
            <span className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls.color}`}>
              <ClsIcon className="size-3" /> {cls.label}
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-stone-100 text-stone-500">
            <X className="size-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-6">
          {/* Classification info */}
          <p className="text-sm text-stone-500 italic">{cls.desc}</p>

          {/* Key metrics */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-stone-50 rounded-lg p-3 text-center">
              <p className="text-xs text-stone-500">Selling Price</p>
              <p className="text-lg font-bold text-stone-800">${item.sellingPrice.toFixed(2)}</p>
            </div>
            <div className="bg-stone-50 rounded-lg p-3 text-center">
              <p className="text-xs text-stone-500">Food Cost</p>
              <p className={`text-lg font-bold ${item.foodCostPct > 35 ? "text-red-600" : "text-stone-800"}`}>
                {item.foodCostPct.toFixed(1)}%
              </p>
            </div>
            <div className="bg-stone-50 rounded-lg p-3 text-center">
              <p className="text-xs text-stone-500">CM</p>
              <p className="text-lg font-bold text-stone-800">${item.contributionMargin.toFixed(2)}</p>
            </div>
          </div>

          {/* Ingredients */}
          <div>
            <h3 className="text-sm font-semibold text-stone-800 mb-2">Ingredients</h3>
            {loadingIng ? (
              <Loader2 className="size-4 animate-spin text-stone-400" />
            ) : (
              <>
                {ingredients.length > 0 && (
                  <div className="space-y-1 mb-3">
                    {ingredients.map((ing) => (
                      <div key={ing.id} className="flex items-center justify-between text-sm bg-stone-50 rounded-lg px-3 py-2">
                        <div>
                          <span className="font-medium text-stone-700">{ing.ingredientName}</span>
                          <span className="text-stone-400 ml-2">{ing.quantity} {ing.unit} @ ${ing.unitCost}/{ing.unit}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-stone-500">${ing.lineCost}</span>
                          <button onClick={() => handleRemoveIng(ing.id)} className="text-stone-400 hover:text-red-500">
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add ingredient form */}
                <form onSubmit={handleAddIngredient} className="grid grid-cols-6 gap-2">
                  <input type="text" value={ingName} onChange={(e) => setIngName(e.target.value)} placeholder="Ingredient" required
                    className="col-span-2 px-2 py-1.5 text-xs border border-stone-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400" />
                  <input type="number" step="0.001" value={ingQty} onChange={(e) => setIngQty(e.target.value)} placeholder="Qty" required
                    className="px-2 py-1.5 text-xs border border-stone-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400" />
                  <select value={ingUnit} onChange={(e) => setIngUnit(e.target.value)}
                    className="px-2 py-1.5 text-xs border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-amber-400">
                    <option value="kg">kg</option><option value="g">g</option><option value="l">l</option>
                    <option value="ml">ml</option><option value="each">each</option><option value="bunch">bunch</option>
                  </select>
                  <input type="number" step="0.01" value={ingCost} onChange={(e) => setIngCost(e.target.value)} placeholder="$/unit" required
                    className="px-2 py-1.5 text-xs border border-stone-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400" />
                  <button type="submit" disabled={addingIng}
                    className="flex items-center justify-center px-2 py-1.5 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">
                    {addingIng ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                  </button>
                </form>
              </>
            )}
          </div>

          {/* AI Recommendations */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-stone-800">AI Recommendations</h3>
              <button
                onClick={() => fetchRecommendations(item.menuItemId)}
                disabled={recLoading}
                className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 disabled:opacity-50"
              >
                {recLoading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                {recommendations ? "Refresh" : "Get Recommendations"}
              </button>
            </div>

            {recLoading && (
              <div className="flex items-center gap-2 py-4 text-stone-400 text-sm">
                <Loader2 className="size-4 animate-spin" /> Analysing this item...
              </div>
            )}

            {recommendations && !recLoading && (
              <div className="space-y-3">
                <p className="text-sm text-stone-600 bg-stone-50 rounded-lg p-3">{recommendations.summary}</p>

                {recommendations.actions.map((action, i) => (
                  <div key={i} className="border border-stone-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                        {ACTION_LABELS[action.type] ?? action.type}
                      </span>
                    </div>
                    <p className="text-sm text-stone-700">{action.description}</p>
                    {action.impact && <p className="text-xs text-stone-500 mt-1">{action.impact}</p>}
                    {action.type === "generate_replacement" && (
                      <button
                        onClick={handleGenerateReplacement}
                        className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700"
                      >
                        <ChefHat className="size-3" /> Generate Replacement Recipe
                      </button>
                    )}
                  </div>
                ))}

                {recommendations.menuDescription && (
                  <div className="border border-purple-200 bg-purple-50 rounded-lg p-3">
                    <p className="text-xs font-medium text-purple-700 mb-1">Suggested Menu Description</p>
                    <p className="text-sm text-purple-900 italic">"{recommendations.menuDescription}"</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

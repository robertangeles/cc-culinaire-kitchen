/**
 * Slide-over panel showing menu item details:
 * ingredients, costs, classification, and AI recommendations.
 * Dark theme variant matching the Menu Intelligence page.
 */

import { useState, useEffect } from "react";
import { X, Plus, Trash2, Loader2, Sparkles, Star, TrendingDown, HelpCircle, XCircle, ChefHat } from "lucide-react";
import { useNavigate } from "react-router";
import type { MenuItem, MenuIngredient } from "../../hooks/useMenuItems.js";
import { useMenuRecommendations } from "../../hooks/useMenuRecommendations.js";

const API = import.meta.env.VITE_API_URL ?? "";

const CLASS_INFO: Record<string, { label: string; bg: string; text: string; icon: typeof Star; desc: string }> = {
  star: { label: "Star", bg: "bg-[#D4A574]/15", text: "text-[#D4A574]", icon: Star, desc: "High profit, high popularity \u2014 protect this item" },
  plowhorse: { label: "Plowhorse", bg: "bg-blue-500/15", text: "text-blue-400", icon: TrendingDown, desc: "High popularity but low profit \u2014 optimise costs or raise price" },
  puzzle: { label: "Puzzle", bg: "bg-purple-500/15", text: "text-purple-400", icon: HelpCircle, desc: "Good profit but low popularity \u2014 promote or reprice" },
  dog: { label: "Dog", bg: "bg-[#2A2A2A]", text: "text-[#666666]", icon: XCircle, desc: "Low profit, low popularity \u2014 rework or replace" },
  unclassified: { label: "Unclassified", bg: "bg-[#2A2A2A]", text: "text-[#666666]", icon: HelpCircle, desc: "Add sales data to classify" },
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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[#161616] shadow-2xl overflow-y-auto border-l border-[#2A2A2A]">
        {/* Header */}
        <div className="sticky top-0 bg-[#161616] border-b border-[#2A2A2A] px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-bold text-[#FAFAFA]">{item.name}</h2>
            <span className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls.bg} ${cls.text}`}>
              <ClsIcon className="size-3" /> {cls.label}
            </span>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#2A2A2A] text-[#666666] hover:text-[#FAFAFA] transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
            <X className="size-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-6">
          {/* Classification info */}
          <p className="text-sm text-[#999999] italic">{cls.desc}</p>

          {/* Key metrics */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#0A0A0A] rounded-xl p-3 text-center border border-[#2A2A2A]">
              <p className="text-xs text-[#666666]">Selling Price</p>
              <p className="text-lg font-bold text-[#FAFAFA]">${item.sellingPrice.toFixed(2)}</p>
            </div>
            <div className="bg-[#0A0A0A] rounded-xl p-3 text-center border border-[#2A2A2A]">
              <p className="text-xs text-[#666666]">Food Cost</p>
              <p className={`text-lg font-bold ${item.foodCostPct > 35 ? "text-red-400" : "text-[#FAFAFA]"}`}>
                {item.foodCostPct.toFixed(1)}%
              </p>
            </div>
            <div className="bg-[#0A0A0A] rounded-xl p-3 text-center border border-[#2A2A2A]">
              <p className="text-xs text-[#666666]">CM</p>
              <p className="text-lg font-bold text-[#FAFAFA]">${item.contributionMargin.toFixed(2)}</p>
            </div>
          </div>

          {/* Ingredients */}
          <div>
            <h3 className="text-sm font-semibold text-[#FAFAFA] mb-2">Ingredients</h3>
            {loadingIng ? (
              <Loader2 className="size-4 animate-spin text-[#666666]" />
            ) : (
              <>
                {ingredients.length > 0 && (
                  <div className="space-y-1 mb-3">
                    {ingredients.map((ing) => (
                      <div key={ing.id} className="flex items-center justify-between text-sm bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2">
                        <div>
                          <span className="font-medium text-[#FAFAFA]">{ing.ingredientName}</span>
                          <span className="text-[#666666] ml-2">{ing.quantity} {ing.unit} @ ${ing.unitCost}/{ing.unit}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[#999999]">${ing.lineCost}</span>
                          <button onClick={() => handleRemoveIng(ing.id)} className="text-[#666666] hover:text-red-400 transition-colors p-1 min-h-[36px] min-w-[36px] flex items-center justify-center">
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
                    className="col-span-2 px-2 py-1.5 text-xs bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:ring-1 focus:ring-[#D4A574]/50 min-h-[36px]" />
                  <input type="number" step="0.001" value={ingQty} onChange={(e) => setIngQty(e.target.value)} placeholder="Qty" required
                    className="px-2 py-1.5 text-xs bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:ring-1 focus:ring-[#D4A574]/50 min-h-[36px]" />
                  <select value={ingUnit} onChange={(e) => setIngUnit(e.target.value)}
                    className="px-2 py-1.5 text-xs bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg text-[#FAFAFA] focus:outline-none focus:ring-1 focus:ring-[#D4A574]/50 min-h-[36px]">
                    <option value="kg">kg</option><option value="g">g</option><option value="l">l</option>
                    <option value="ml">ml</option><option value="each">each</option><option value="bunch">bunch</option>
                  </select>
                  <input type="number" step="0.01" value={ingCost} onChange={(e) => setIngCost(e.target.value)} placeholder="$/unit" required
                    className="px-2 py-1.5 text-xs bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:ring-1 focus:ring-[#D4A574]/50 min-h-[36px]" />
                  <button type="submit" disabled={addingIng}
                    className="flex items-center justify-center px-2 py-1.5 text-xs bg-[#D4A574] text-white rounded-lg hover:bg-[#C4956A] disabled:opacity-50 transition-colors min-h-[36px]">
                    {addingIng ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                  </button>
                </form>
              </>
            )}
          </div>

          {/* AI Recommendations */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-[#FAFAFA]">AI Recommendations</h3>
              <button
                onClick={() => fetchRecommendations(item.menuItemId)}
                disabled={recLoading}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[#D4A574] bg-[#D4A574]/10 rounded-lg border border-[#D4A574]/20 hover:bg-[#D4A574]/20 disabled:opacity-50 transition-colors min-h-[36px]"
              >
                {recLoading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                {recommendations ? "Refresh" : "Get Recommendations"}
              </button>
            </div>

            {recLoading && (
              <div className="flex items-center gap-2 py-4 text-[#666666] text-sm">
                <Loader2 className="size-4 animate-spin" /> Analysing this item...
              </div>
            )}

            {recommendations && !recLoading && (
              <div className="space-y-3">
                <p className="text-sm text-[#999999] bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl p-3">{recommendations.summary}</p>

                {recommendations.actions.map((action, i) => (
                  <div key={i} className="border border-[#2A2A2A] rounded-xl p-3 bg-[#0A0A0A]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-[#D4A574] bg-[#D4A574]/10 px-2 py-0.5 rounded-full">
                        {ACTION_LABELS[action.type] ?? action.type}
                      </span>
                    </div>
                    <p className="text-sm text-[#FAFAFA]">{action.description}</p>
                    {action.impact && <p className="text-xs text-[#666666] mt-1">{action.impact}</p>}
                    {action.type === "generate_replacement" && (
                      <button
                        onClick={handleGenerateReplacement}
                        className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] transition-colors min-h-[36px]"
                      >
                        <ChefHat className="size-3" /> Generate Replacement Recipe
                      </button>
                    )}
                  </div>
                ))}

                {recommendations.menuDescription && (
                  <div className="border border-purple-500/20 bg-purple-500/10 rounded-xl p-3">
                    <p className="text-xs font-medium text-purple-400 mb-1">Suggested Menu Description</p>
                    <p className="text-sm text-purple-300 italic">"{recommendations.menuDescription}"</p>
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

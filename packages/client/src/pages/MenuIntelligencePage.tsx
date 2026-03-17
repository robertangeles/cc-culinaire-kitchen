/**
 * @module MenuIntelligencePage
 *
 * Menu Intelligence dashboard — the menu engineering matrix,
 * item management, and AI recommendations.
 */

import { useState, useMemo } from "react";
import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import { useMenuItems, type MenuItem } from "../hooks/useMenuItems.js";
import { useMenuAnalysis } from "../hooks/useMenuAnalysis.js";
import { MenuItemForm } from "../components/menu/MenuItemForm.js";
import { MenuSummaryCards } from "../components/menu/MenuSummaryCards.js";
import { MenuItemsTable } from "../components/menu/MenuItemsTable.js";
import { MenuMatrix } from "../components/menu/MenuMatrix.js";
import { MenuItemDetail } from "../components/menu/MenuItemDetail.js";
import { MenuCsvUpload } from "../components/menu/MenuCsvUpload.js";
import { MenuCategorySettings } from "../components/menu/MenuCategorySettings.js";

export function MenuIntelligencePage() {
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);

  const { items, loading: itemsLoading, createItem, updateItem, deleteItem, addIngredient, removeIngredient, getIngredients } = useMenuItems(categoryFilter || undefined);
  const { analysis, loading: analysisLoading, recalculate } = useMenuAnalysis(categoryFilter || undefined);

  // Derive unique categories
  const categories = useMemo(() => {
    const cats = new Set(items.map((i) => i.category));
    return Array.from(cats).sort();
  }, [items]);

  const loading = itemsLoading || analysisLoading;

  async function handleUpdateSales(id: string, unitsSold: number) {
    await updateItem(id, { unitsSold });
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <BarChart3 className="size-7 text-amber-600" />
            <div>
              <h1 className="text-2xl font-bold text-stone-800">Menu Intelligence</h1>
              <p className="text-sm text-stone-500">Analyse your menu performance and optimise profitability</p>
            </div>
          </div>
          <button
            onClick={recalculate}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Recalculate
          </button>
        </div>

        {/* Category filter */}
        <div className="flex gap-1 bg-stone-100 rounded-lg p-1 mb-6 w-fit">
          <button
            onClick={() => setCategoryFilter("")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              !categoryFilter ? "bg-white text-stone-800 shadow-sm" : "text-stone-500 hover:text-stone-700"
            }`}
          >
            All Categories
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                categoryFilter === cat ? "bg-white text-stone-800 shadow-sm" : "text-stone-500 hover:text-stone-700"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {loading && !analysis ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 animate-spin text-amber-600" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary cards */}
            {analysis && <MenuSummaryCards analysis={analysis} />}

            {/* Matrix chart */}
            {analysis && <MenuMatrix items={analysis.items} onSelect={setSelectedItem} />}

            {/* Add item form */}
            <MenuItemForm onSubmit={createItem} categories={categories} />

            {/* Items table */}
            <MenuItemsTable
              items={analysis?.items ?? items}
              onSelect={setSelectedItem}
              onDelete={deleteItem}
              onUpdateSales={handleUpdateSales}
            />

            {/* CSV upload + category settings */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <MenuCsvUpload onComplete={recalculate} />
              <MenuCategorySettings categories={categories} />
            </div>
          </div>
        )}
      </div>

      {/* Item detail slide-over */}
      {selectedItem && (
        <MenuItemDetail
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onAddIngredient={addIngredient}
          onRemoveIngredient={removeIngredient}
          getIngredients={getIngredients}
        />
      )}
    </div>
  );
}

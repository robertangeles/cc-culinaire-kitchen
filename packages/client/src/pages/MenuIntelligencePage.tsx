/**
 * @module MenuIntelligencePage
 *
 * Menu Intelligence dashboard — the menu engineering matrix,
 * item management, category settings, and AI recommendations.
 *
 * Four tabs: Dashboard | Menu Items | Engineering Matrix | Category Settings
 * Guest users see a sign-up prompt.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { BarChart3, LogIn, Loader2, RefreshCw } from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "../context/AuthContext.js";
import { useMenuItems, type MenuItem, type MenuIngredient } from "../hooks/useMenuItems.js";
import { useMenuAnalysis } from "../hooks/useMenuAnalysis.js";
import { MenuDashboard } from "../components/menu/MenuDashboard.js";
import { MenuItemList, type WasteImpact } from "../components/menu/MenuItemList.js";
import { MenuItemFormModal } from "../components/menu/MenuItemFormModal.js";
import { MenuEngineeringMatrix } from "../components/menu/MenuEngineeringMatrix.js";
import { CategorySettings } from "../components/menu/CategorySettings.js";
import { MenuItemDetail } from "../components/menu/MenuItemDetail.js";
import { MenuCsvUpload } from "../components/menu/MenuCsvUpload.js";

/* ---- Tab config ---- */

type MenuTab = "dashboard" | "items" | "matrix" | "categories";

const TABS: { key: MenuTab; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "items", label: "Menu Items" },
  { key: "matrix", label: "Engineering Matrix" },
  { key: "categories", label: "Category Settings" },
];

/* ---- Page ---- */

const API = import.meta.env.VITE_API_URL ?? "";

export function MenuIntelligencePage() {
  const { user, isGuest } = useAuth();
  const [activeTab, setActiveTab] = useState<MenuTab>("dashboard");

  // Data hooks
  const {
    items,
    loading: itemsLoading,
    refresh: refreshItems,
    createItem,
    updateItem,
    deleteItem,
    addIngredient,
    removeIngredient,
    getIngredients,
  } = useMenuItems();
  const {
    analysis,
    loading: analysisLoading,
    refresh: refreshAnalysis,
    recalculate,
  } = useMenuAnalysis();

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<MenuItem | null>(null);
  const [editIngredients, setEditIngredients] = useState<MenuIngredient[]>([]);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);

  // Category targets
  const [categoryTargets, setCategoryTargets] = useState<
    Record<string, number>
  >({});

  // Waste impact data (Connection 3: Waste -> Menu Intelligence)
  const [wasteImpacts, setWasteImpacts] = useState<WasteImpact[]>([]);

  // Classification filter for menu items (used by Dogs card link)
  const [dogFilter, setDogFilter] = useState(false);

  // Derive unique categories
  const categories = useMemo(() => {
    const cats = new Set(items.map((i) => i.category));
    return Array.from(cats).sort();
  }, [items]);

  // Fetch category targets
  useEffect(() => {
    if (isGuest || !user) return;
    (async () => {
      try {
        const res = await fetch(`${API}/api/menu/categories`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const data: { categoryName: string; targetFoodCostPct: string }[] =
          await res.json();
        const map: Record<string, number> = {};
        for (const s of data) {
          map[s.categoryName] = parseFloat(s.targetFoodCostPct);
        }
        setCategoryTargets(map);
      } catch {
        // silent
      }
    })();
  }, [user, isGuest, items]);

  // Fetch waste impact data
  useEffect(() => {
    if (isGuest || !user) return;
    (async () => {
      try {
        const res = await fetch(`${API}/api/menu/waste-impact`, {
          credentials: "include",
        });
        if (!res.ok) return;
        setWasteImpacts(await res.json());
      } catch {
        // silent — waste data is supplementary
      }
    })();
  }, [user, isGuest, items]);

  const loading = itemsLoading || analysisLoading;

  // Item form handlers
  const handleOpenAdd = useCallback(() => {
    setEditItem(null);
    setEditIngredients([]);
    setFormOpen(true);
  }, []);

  const handleOpenEdit = useCallback(
    async (item: MenuItem) => {
      setEditItem(item);
      try {
        const ings = await getIngredients(item.menuItemId);
        setEditIngredients(ings);
      } catch {
        setEditIngredients([]);
      }
      setFormOpen(true);
    },
    [getIngredients]
  );

  const handleSaveItem = useCallback(
    async (data: {
      name: string;
      category: string;
      sellingPrice: string;
      unitsSold: number;
    }): Promise<string | void> => {
      if (editItem) {
        await updateItem(editItem.menuItemId, {
          name: data.name,
          category: data.category,
          sellingPrice: data.sellingPrice,
          unitsSold: data.unitsSold,
        });
        return editItem.menuItemId;
      } else {
        const created = await createItem({
          name: data.name,
          category: data.category,
          sellingPrice: data.sellingPrice,
        });
        return created.menuItemId;
      }
    },
    [editItem, createItem, updateItem]
  );

  const handleSaveIngredients = useCallback(
    async (
      itemId: string,
      ingredients: {
        ingredientName: string;
        quantity: string;
        unit: string;
        unitCost: string;
        yieldPct: string;
      }[]
    ) => {
      // Remove old ingredients first, then add new ones
      const existing = await getIngredients(itemId);
      for (const ing of existing) {
        await removeIngredient(itemId, ing.id);
      }
      for (const ing of ingredients) {
        await addIngredient(itemId, ing);
      }
    },
    [addIngredient, removeIngredient, getIngredients]
  );

  const handleCloseForm = useCallback(() => {
    setFormOpen(false);
    setEditItem(null);
    setEditIngredients([]);
    // Refresh data after form close
    refreshItems();
    refreshAnalysis();
  }, [refreshItems, refreshAnalysis]);

  const handleDeleteItem = useCallback(
    async (id: string) => {
      await deleteItem(id);
      refreshAnalysis();
    },
    [deleteItem, refreshAnalysis]
  );

  const handleRecalculate = useCallback(async () => {
    await recalculate();
    await refreshItems();
  }, [recalculate, refreshItems]);

  // Guest users see sign-up prompt
  if (isGuest || !user) {
    return (
      <div className="flex-1 overflow-y-auto bg-[#0A0A0A]">
        <div className="min-h-full flex flex-col items-center justify-center p-6 md:p-10">
          <BarChart3 className="size-12 mx-auto mb-4 text-[#D4A574]" />
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">
            Menu Intelligence
          </h1>
          <p className="text-[#999999] mb-6 text-center max-w-md">
            Sign up to analyze your menu performance, find your Stars, and fix
            your Dogs.
          </p>
          <Link
            to="/register"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#D4A574] hover:bg-[#C4956A] text-white font-medium rounded-lg transition-colors min-h-[44px]"
          >
            <LogIn className="size-4" />
            Sign Up to Analyze Your Menu
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#0A0A0A]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <BarChart3 className="size-7 text-[#D4A574]" />
            <div>
              <h1 className="text-2xl font-bold text-[#FAFAFA]">
                Menu Intelligence
              </h1>
              <p className="text-sm text-[#999999]">
                Analyze your menu. Find your Stars. Fix your Dogs.
              </p>
            </div>
          </div>
          <button
            onClick={handleRecalculate}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-[#D4A574] bg-[#D4A574]/10 rounded-xl border border-[#D4A574]/20 hover:bg-[#D4A574]/20 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            <RefreshCw
              className={`size-4 ${loading ? "animate-spin" : ""}`}
            />
            Recalculate
          </button>
        </div>

        {/* Tab navigation */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); if (tab.key !== "items") setDogFilter(false); }}
              className={`px-5 py-2.5 rounded-full text-sm font-medium transition-colors min-h-[44px] ${
                activeTab === tab.key
                  ? "bg-[#D4A574] text-white"
                  : "bg-[#161616] text-[#999999] hover:text-white hover:bg-[#1E1E1E]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            <MenuDashboard
              analysis={analysis}
              loading={analysisLoading}
              onFilterDogs={() => {
                setDogFilter(true);
                setActiveTab("items");
              }}
            />
            {/* CSV upload below dashboard */}
            <div className="bg-[#161616] rounded-2xl border border-[#2A2A2A] p-5">
              <MenuCsvUpload onComplete={handleRecalculate} />
            </div>
          </div>
        )}

        {activeTab === "items" && (
          <MenuItemList
            items={analysis?.items ?? items}
            loading={itemsLoading}
            categoryTargets={categoryTargets}
            wasteImpacts={wasteImpacts}
            classificationFilter={dogFilter ? "dog" : undefined}
            onAdd={handleOpenAdd}
            onEdit={handleOpenEdit}
            onDelete={handleDeleteItem}
            onSelect={setSelectedItem}
          />
        )}

        {activeTab === "matrix" && (
          <MenuEngineeringMatrix
            items={analysis?.items ?? items}
            loading={analysisLoading}
            onSelect={setSelectedItem}
          />
        )}

        {activeTab === "categories" && (
          <CategorySettings categories={categories} items={items} />
        )}
      </div>

      {/* Menu item form modal */}
      {formOpen && (
        <MenuItemFormModal
          editItem={editItem}
          existingIngredients={editIngredients}
          categories={categories}
          onSave={handleSaveItem}
          onSaveIngredients={handleSaveIngredients}
          onClose={handleCloseForm}
        />
      )}

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

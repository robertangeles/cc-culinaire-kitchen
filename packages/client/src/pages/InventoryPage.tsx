/**
 * @module pages/InventoryPage
 *
 * Main inventory page with tabs: Dashboard, Stock Take, and Ingredients.
 * Location-scoped — shows data for the user's selected location.
 */

import { useState, useMemo, useEffect } from "react";
import { useAuth } from "../context/AuthContext.js";
import { useLocation } from "../context/LocationContext.js";
import { useGuide } from "../context/GuideContext.js";
import { usePendingReviews } from "../hooks/useInventory.js";
import { INVENTORY_TAB_GUIDES } from "@culinaire/shared";
import { LocationDashboard } from "../components/inventory/LocationDashboard.js";
import { StockTakeSession } from "../components/inventory/StockTakeSession.js";
import { IngredientCatalog } from "../components/inventory/IngredientCatalog.js";
import { StockTakeReviewQueue } from "../components/inventory/StockTakeReviewQueue.js";
import { SupplierManager } from "../components/inventory/SupplierManager.js";
import { ActivationWizard } from "../components/inventory/ActivationWizard.js";
import { OpeningInventory } from "../components/inventory/OpeningInventory.js";
import { CatalogRequestQueue } from "../components/inventory/CatalogRequestQueue.js";
import ConsumptionLogger from "../components/inventory/ConsumptionLogger.js";
import { Tooltip } from "../components/ui/Tooltip.js";
import { Package, ClipboardCheck, Utensils, ShieldCheck, Truck, Settings, FileQuestion, FileEdit } from "lucide-react";

type InventoryTab = "dashboard" | "setup" | "stock-take" | "log" | "review" | "ingredients" | "suppliers" | "requests";

export function InventoryPage() {
  const { user, isGuest } = useAuth();
  const { selectedLocationId, locations, isOrgAdmin } = useLocation();
  const { sessions: pendingReviews, refresh: refreshReviews } = usePendingReviews();
  const [activeTab, setActiveTab] = useState<InventoryTab>("dashboard");
  const { setGuideKeyOverride } = useGuide();

  // Sync active tab to GuideSidebar guide key
  useEffect(() => {
    const tabKey = activeTab.replace("-", "_"); // "stock-take" → "stock_take"
    setGuideKeyOverride(`inventory_${tabKey}`);
    return () => setGuideKeyOverride(null);
  }, [activeTab, setGuideKeyOverride]);

  const tabs = useMemo(() => {
    const t: { key: InventoryTab; label: string; icon: typeof Package }[] = [
      { key: "dashboard", label: "Dashboard", icon: Package },
      { key: "setup", label: "Setup", icon: Settings },
      { key: "stock-take", label: "Stock Take", icon: ClipboardCheck },
      { key: "log", label: "Stock Transfer", icon: FileEdit },
    ];
    if (isOrgAdmin) {
      t.push({ key: "review", label: "Review", icon: ShieldCheck });
      t.push({ key: "requests", label: "Requests", icon: FileQuestion });
      t.push({ key: "ingredients", label: "Catalog", icon: Utensils });
      t.push({ key: "suppliers", label: "Suppliers", icon: Truck });
    }
    return t;
  }, [isOrgAdmin]);

  if (isGuest || !user) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0A0A0A]">
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#1E1E1E] flex items-center justify-center">
            <Package className="size-8 text-[#D4A574]" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Inventory System</h2>
          <p className="text-[#999] text-sm">Sign in to manage your kitchen inventory.</p>
        </div>
      </div>
    );
  }

  const currentLocation = locations.find((l) => l.storeLocationId === selectedLocationId);

  return (
    <div className="flex-1 flex flex-col bg-[#0A0A0A] overflow-hidden">
      {/* Sticky header + tabs */}
      <div className="flex-shrink-0 bg-[#0A0A0A] border-b border-[#1A1A1A] z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-4">
          {/* Header */}
          <div className="mb-4 animate-[fadeInUp_200ms_ease-out]">
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#D4A574] to-[#C4956A] flex items-center justify-center shadow-[0_0_12px_rgba(212,165,116,0.2)]">
                <Package className="size-5 text-[#0A0A0A]" />
              </div>
              Inventory
            </h1>
          </div>

          {/* Tab bar + help button */}
          <div className="flex items-center gap-3">
            <div
              className="flex gap-1 p-1 rounded-xl bg-[#161616] border border-[#2A2A2A] w-fit"
              role="tablist"
            >
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.key;
                const pendingCount = tab.key === "review" ? pendingReviews.length : 0;
                const guide = INVENTORY_TAB_GUIDES[tab.key];
                return (
                  <Tooltip key={tab.key} text={guide?.tooltip ?? tab.label} position="bottom">
                    <button
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActiveTab(tab.key)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        isActive
                          ? "bg-[#1E1E1E] text-white shadow-[0_0_8px_rgba(212,165,116,0.1)]"
                          : "text-[#999] hover:text-white hover:bg-[#1E1E1E]/50"
                      }`}
                    >
                      <Icon className="size-4" />
                      {tab.label}
                      {pendingCount > 0 && (
                        <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold min-w-[18px] text-center leading-none">
                          {pendingCount}
                        </span>
                      )}
                    </button>
                  </Tooltip>
                );
              })}
            </div>

          </div>
        </div>
      </div>

      {/* Scrollable tab content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 animate-[fadeIn_150ms_ease-out]">
          {activeTab === "dashboard" && (
            <LocationDashboard
              locationId={selectedLocationId}
              onTabChange={(tab) => setActiveTab(tab as InventoryTab)}
            />
          )}
          {activeTab === "setup" && (
            <div className="space-y-6">
              <ActivationWizard />
              <OpeningInventory />
            </div>
          )}
          {activeTab === "stock-take" && (
            <StockTakeSession />
          )}
          {activeTab === "log" && (
            <ConsumptionLogger />
          )}
          {activeTab === "review" && (
            <StockTakeReviewQueue sessions={pendingReviews} refresh={refreshReviews} />
          )}
          {activeTab === "ingredients" && (
            <IngredientCatalog />
          )}
          {activeTab === "suppliers" && (
            <SupplierManager />
          )}
          {activeTab === "requests" && isOrgAdmin && <CatalogRequestQueue />}
        </div>
      </div>

    </div>
  );
}

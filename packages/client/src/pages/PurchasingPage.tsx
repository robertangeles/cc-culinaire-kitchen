/**
 * @module pages/PurchasingPage
 *
 * Purchasing workflow: Orders, Receive deliveries, Suppliers.
 * Separated from Stock Room so chefs see the right context immediately.
 */

import { useState, useMemo, useEffect } from "react";
import { useAuth } from "../context/AuthContext.js";
import { useLocation } from "../context/LocationContext.js";
import { useGuide } from "../context/GuideContext.js";
import { usePurchaseOrders } from "../hooks/useInventory.js";
import PurchaseOrderList from "../components/inventory/PurchaseOrderList.js";
import { SupplierManager } from "../components/inventory/SupplierManager.js";
import ReceiveQueue from "../components/purchasing/ReceiveQueue.js";
import ApprovalQueue from "../components/purchasing/ApprovalQueue.js";
import SpendThresholdSettings from "../components/purchasing/SpendThresholdSettings.js";
import { AutoPoSuggestionsTable } from "../components/purchasing/AutoPoSuggestionsTable.js";
import { Tooltip } from "../components/ui/Tooltip.js";
import { ShoppingCart, Package, Truck, ClipboardCheck, Settings, FileText, Sparkles } from "lucide-react";

type PurchasingTab = "orders" | "suggestions" | "receive" | "suppliers" | "approvals" | "settings";

export function PurchasingPage() {
  const { user, isGuest } = useAuth();
  const { selectedLocationId, locations, isOrgAdmin } = useLocation();
  const [activeTab, setActiveTab] = useState<PurchasingTab>("orders");
  const { setGuideKeyOverride } = useGuide();
  const { pos } = usePurchaseOrders(selectedLocationId);

  // Count pending approvals for badge
  const pendingApprovalCount = useMemo(
    () => pos.filter((p) => p.status === "PENDING_APPROVAL").length,
    [pos],
  );

  // Count deliveries awaiting receipt
  const awaitingReceiptCount = useMemo(
    () => pos.filter((p) => p.status === "SENT").length,
    [pos],
  );

  useEffect(() => {
    setGuideKeyOverride(`purchasing_${activeTab}`);
    return () => setGuideKeyOverride(null);
  }, [activeTab, setGuideKeyOverride]);

  const tabs = useMemo(() => {
    const t: { key: PurchasingTab; label: string; icon: typeof ShoppingCart; badge?: number }[] = [
      { key: "orders", label: "Orders", icon: FileText },
      { key: "suggestions", label: "Suggestions", icon: Sparkles },
      { key: "receive", label: "Receive", icon: Package, badge: awaitingReceiptCount },
      { key: "suppliers", label: "Suppliers", icon: Truck },
    ];
    if (isOrgAdmin) {
      t.push({ key: "approvals", label: "Approvals", icon: ClipboardCheck, badge: pendingApprovalCount });
      t.push({ key: "settings", label: "Settings", icon: Settings });
    }
    return t;
  }, [isOrgAdmin, pendingApprovalCount, awaitingReceiptCount]);

  if (isGuest || !user) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0A0A0A]">
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#1E1E1E] flex items-center justify-center">
            <ShoppingCart className="size-8 text-[#D4A574]" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Purchasing</h2>
          <p className="text-[#999] text-sm">Sign in to manage orders and deliveries.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#0A0A0A] overflow-hidden">
      {/* Sticky header + tabs */}
      <div className="flex-shrink-0 bg-[#0A0A0A] border-b border-[#1A1A1A] z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-4">
          <div className="mb-4 animate-[fadeInUp_200ms_ease-out]">
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#D4A574] to-[#C4956A] flex items-center justify-center shadow-[0_0_12px_rgba(212,165,116,0.2)]">
                <ShoppingCart className="size-5 text-[#0A0A0A]" />
              </div>
              Purchasing
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div
              className="flex gap-1 p-1 rounded-xl bg-[#161616] border border-[#2A2A2A] w-fit"
              role="tablist"
            >
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.key;
                return (
                  <Tooltip key={tab.key} text={tab.label} position="bottom">
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
                      {(tab.badge ?? 0) > 0 && (
                        <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold min-w-[18px] text-center leading-none ${
                          tab.key === "approvals" ? "bg-amber-500 text-[#0A0A0A]" : "bg-emerald-500 text-white"
                        }`}>
                          {tab.badge}
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
          {activeTab === "orders" && <PurchaseOrderList />}
          {activeTab === "suggestions" && <AutoPoSuggestionsTable />}
          {activeTab === "receive" && <ReceiveQueue />}
          {activeTab === "suppliers" && <SupplierManager />}
          {activeTab === "approvals" && <ApprovalQueue />}
          {activeTab === "settings" && <SpendThresholdSettings />}
        </div>
      </div>
    </div>
  );
}

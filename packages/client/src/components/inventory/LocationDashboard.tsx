/**
 * @module components/inventory/LocationDashboard
 *
 * Location-scoped dashboard showing stock status by category,
 * active stock take session info, and last count date.
 */

import { useDashboard, type LocationIngredient } from "../../hooks/useInventory.js";
import { Package, Clock, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  proteins: "Proteins",
  produce: "Produce",
  dairy: "Dairy",
  dry_goods: "Dry Goods",
  beverages: "Beverages",
  spirits: "Spirits",
  frozen: "Frozen",
  bakery: "Bakery",
  condiments: "Condiments",
  other: "Other",
};

function getStockStatus(item: LocationIngredient): "healthy" | "low" | "critical" | "unknown" {
  if (!item.currentQty || !item.parLevel) return "unknown";
  const qty = Number(item.currentQty);
  const par = Number(item.parLevel);
  if (par === 0) return "healthy";
  const ratio = qty / par;
  if (ratio <= 0.25) return "critical";
  if (ratio <= 0.75) return "low";
  return "healthy";
}

const STATUS_STYLES = {
  healthy: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400", icon: CheckCircle2 },
  low: { bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-400", icon: AlertTriangle },
  critical: { bg: "bg-red-500/10", border: "border-red-500/20", text: "text-red-400", icon: AlertTriangle },
  unknown: { bg: "bg-[#1E1E1E]", border: "border-[#2A2A2A]", text: "text-[#666]", icon: Package },
};

export function LocationDashboard({ locationId }: { locationId: string | null }) {
  const { data, isLoading } = useDashboard(locationId);

  if (!locationId) {
    return (
      <div className="text-center py-16">
        <Package className="size-12 mx-auto text-[#666] mb-3" />
        <p className="text-[#999]">Select a location to view inventory</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 text-[#D4A574] animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  // Group stock levels by category
  const byCategory = new Map<string, LocationIngredient[]>();
  for (const item of data.stockLevels) {
    const cat = item.categoryOverride || item.ingredientCategory;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(item);
  }

  // Calculate category health
  const categoryHealth = Array.from(byCategory.entries()).map(([cat, items]) => {
    const statuses = items.map(getStockStatus);
    const critical = statuses.filter((s) => s === "critical").length;
    const low = statuses.filter((s) => s === "low").length;
    const overall = critical > 0 ? "critical" : low > 0 ? "low" : "healthy";
    return { category: cat, items, overall, critical, low, healthy: items.length - critical - low };
  });

  return (
    <div className="space-y-6 animate-[fadeInUp_200ms_ease-out]">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          label="Total Items"
          value={data.stockLevels.length}
          icon={Package}
          accent="text-[#D4A574]"
        />
        <SummaryCard
          label="Low Stock"
          value={data.stockLevels.filter((i) => getStockStatus(i) === "low").length}
          icon={AlertTriangle}
          accent="text-amber-400"
        />
        <SummaryCard
          label="Critical"
          value={data.stockLevels.filter((i) => getStockStatus(i) === "critical").length}
          icon={AlertTriangle}
          accent="text-red-400"
        />
      </div>

      {/* Active session banner */}
      {data.activeSession && (
        <div className="p-4 rounded-xl bg-[#D4A574]/10 border border-[#D4A574]/20">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#D4A574]/20 flex items-center justify-center">
              <Clock className="size-4 text-[#D4A574]" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Stock take in progress</p>
              <p className="text-xs text-[#999]">
                {data.activeSession.categories.filter((c) => c.categoryStatus === "SUBMITTED").length}
                {" / "}
                {data.activeSession.categories.length} categories submitted
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Last count info */}
      {data.lastCompletedSession && (
        <p className="text-xs text-[#666] flex items-center gap-1.5">
          <Clock className="size-3" />
          Last completed count: {new Date(data.lastCompletedSession.closedDttm!).toLocaleDateString()}
        </p>
      )}

      {/* Category grid */}
      {categoryHealth.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categoryHealth.map(({ category, items, overall, critical, low }) => {
            const style = STATUS_STYLES[overall as keyof typeof STATUS_STYLES];
            const Icon = style.icon;
            return (
              <div
                key={category}
                className={`p-4 rounded-xl border ${style.bg} ${style.border} transition-all hover:-translate-y-0.5 hover:shadow-lg`}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-white">
                    {CATEGORY_LABELS[category] || category}
                  </h3>
                  <Icon className={`size-4 ${style.text}`} />
                </div>
                <p className="text-2xl font-bold text-white">{items.length}</p>
                <p className="text-xs text-[#999] mt-1">
                  {critical > 0 && <span className="text-red-400">{critical} critical</span>}
                  {critical > 0 && low > 0 && " · "}
                  {low > 0 && <span className="text-amber-400">{low} low</span>}
                  {critical === 0 && low === 0 && "All healthy"}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16 rounded-xl bg-[#161616] border border-[#2A2A2A]">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#1E1E1E] flex items-center justify-center shadow-[0_0_12px_rgba(212,165,116,0.1)]">
            <Package className="size-8 text-[#D4A574]" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">No inventory data yet</h3>
          <p className="text-sm text-[#999] max-w-sm mx-auto">
            Add ingredients to your catalog and run your first stock take to see data here.
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label, value, icon: Icon, accent,
}: {
  label: string; value: number; icon: typeof Package; accent: string;
}) {
  return (
    <div className="p-4 rounded-xl bg-[#161616] border border-[#2A2A2A] hover:-translate-y-0.5 transition-all">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`size-4 ${accent}`} />
        <span className="text-xs text-[#999]">{label}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

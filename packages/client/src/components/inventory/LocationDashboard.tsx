/**
 * @module components/inventory/LocationDashboard
 *
 * Inventory dashboard with org-wide summary table (admin),
 * selected location metrics, low/critical item drill-down,
 * and inventory value breakdown.
 */

import { useState } from "react";
import {
  useDashboard,
  useOrgDashboard,
  useLocationIngredients,
  type LocationIngredient,
  type OrgLocationSummary,
} from "../../hooks/useInventory.js";
import { useLocation } from "../../context/LocationContext.js";
import { SetupProgress } from "./SetupProgress.js";
import {
  Package, Clock, AlertTriangle, CheckCircle2, Loader2,
  MapPin, ChevronDown, ChevronUp,
} from "lucide-react";
import { CATEGORY_LABELS } from "@culinaire/shared";

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

export function LocationDashboard({
  locationId,
  onTabChange,
}: {
  locationId: string | null;
  onTabChange?: (tab: string) => void;
}) {
  const { data, isLoading } = useDashboard(locationId);
  const { isOrgAdmin, locations: allLocations } = useLocation();
  const { locations: orgLocations, isLoading: orgLoading } = useOrgDashboard();
  const { items: locItems } = useLocationIngredients(locationId);
  const [drillLocationId, setDrillLocationId] = useState<string | null>(null);
  const { items: drillItems } = useLocationIngredients(drillLocationId);
  const [showCritical, setShowCritical] = useState(false);
  const [showLow, setShowLow] = useState(false);

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

  // Use drilled-down location's items when selected, otherwise current location
  const activeItems = drillLocationId && drillItems.length > 0 ? drillItems : locItems;

  // Separate low and critical items
  const lowItems = activeItems.filter((i) => getStockStatus(i) === "low");
  const criticalItems = activeItems.filter((i) => getStockStatus(i) === "critical");

  // Calculate inventory value
  let totalValue = 0;
  const valueByCat = new Map<string, number>();
  for (const item of activeItems) {
    const qty = Number(item.currentQty || 0);
    const cost = Number(item.locationUnitCost || item.orgUnitCost || 0);
    const val = qty * cost;
    if (val > 0) {
      totalValue += val;
      const cat = item.ingredientCategory;
      valueByCat.set(cat, (valueByCat.get(cat) || 0) + val);
    }
  }

  // Category health chips
  const catHealth = new Map<string, "healthy" | "low" | "critical">();
  for (const item of activeItems) {
    const cat = item.ingredientCategory;
    const status = getStockStatus(item);
    const current = catHealth.get(cat) || "healthy";
    if (status === "critical" || (status === "low" && current !== "critical")) {
      catHealth.set(cat, status === "critical" ? "critical" : status);
    } else if (!catHealth.has(cat)) {
      catHealth.set(cat, "healthy");
    }
  }

  return (
    <div className="space-y-3 animate-[fadeInUp_200ms_ease-out]">
      {/* Setup progress — shown when inventory not yet activated */}
      {data.setupProgress && !data.setupProgress.inventoryActive && (
        <SetupProgress
          setupProgress={data.setupProgress}
          onNavigate={(step) => {
            if (onTabChange) {
              if (step === "catalog" || step === "suppliers") {
                onTabChange(step === "catalog" ? "ingredients" : "suppliers");
              } else {
                onTabChange("setup");
              }
            }
          }}
        />
      )}

      {/* Org-wide summary table — admin only, clickable rows */}
      {isOrgAdmin && orgLocations.length > 1 && (
        <OrgSummaryTable
          locations={orgLocations}
          isLoading={orgLoading}
          selectedLocationId={drillLocationId}
          onSelectLocation={(id) => setDrillLocationId(drillLocationId === id ? null : id)}
        />
      )}

      {/* Drill-down: stock items for clicked location */}
      {drillLocationId && drillItems.length > 0 && (
        <DrillDownView
          locationName={allLocations.find((l) => l.storeLocationId === drillLocationId)?.locationName || "Location"}
          items={drillItems}
          onClose={() => setDrillLocationId(null)}
        />
      )}

      {/* Stock Health + Value side-by-side */}
      {(criticalItems.length > 0 || lowItems.length > 0 || totalValue > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Stock Health column */}
          {(criticalItems.length > 0 || lowItems.length > 0) && (
            <div className="space-y-2">
              {/* Critical items — collapsible */}
              {criticalItems.length > 0 && (
                <div className={`rounded-xl border border-red-500/20 bg-red-500/5 overflow-hidden`}>
                  <button
                    onClick={() => setShowCritical((v) => !v)}
                    className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-red-500/10 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="size-3.5 text-red-400" />
                      <span className="text-xs font-semibold text-red-400">Critical — Reorder Now</span>
                      <span className="text-[10px] text-[#666]">{criticalItems.length} items</span>
                    </div>
                    {showCritical ? (
                      <ChevronUp className="size-3.5 text-[#666]" />
                    ) : (
                      <ChevronDown className="size-3.5 text-[#666]" />
                    )}
                  </button>
                  {showCritical && (
                    <StockAlertList items={criticalItems} />
                  )}
                </div>
              )}

              {/* Low stock items — collapsible */}
              {lowItems.length > 0 && (
                <div className={`rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden`}>
                  <button
                    onClick={() => setShowLow((v) => !v)}
                    className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-amber-500/10 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="size-3.5 text-amber-400" />
                      <span className="text-xs font-semibold text-amber-400">Low Stock — Monitor</span>
                      <span className="text-[10px] text-[#666]">{lowItems.length} items</span>
                    </div>
                    {showLow ? (
                      <ChevronUp className="size-3.5 text-[#666]" />
                    ) : (
                      <ChevronDown className="size-3.5 text-[#666]" />
                    )}
                  </button>
                  {showLow && (
                    <StockAlertList items={lowItems} />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Value breakdown column */}
          {totalValue > 0 && (
            <ValueBreakdown valueByCat={valueByCat} total={totalValue} />
          )}
        </div>
      )}

      {/* Active session + last count — compact */}
      <div className="flex flex-wrap gap-3">
        {data.activeSession && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#D4A574]/10 border border-[#D4A574]/20 text-xs">
            <Clock className="size-3.5 text-[#D4A574]" />
            <span className="text-white font-medium">Stock take in progress</span>
            <span className="text-[#999]">
              {data.activeSession.categories.filter((c) => c.categoryStatus === "SUBMITTED").length}
              /{data.activeSession.categories.length} submitted
            </span>
          </div>
        )}
        {data.lastCompletedSession && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#161616] border border-[#2A2A2A] text-xs text-[#666]">
            <CheckCircle2 className="size-3.5" />
            Last count: {new Date(data.lastCompletedSession.closedDttm!).toLocaleDateString()}
          </div>
        )}
      </div>

      {/* Category chips — compact health indicators */}
      {catHealth.size > 0 && (
        <div className="flex flex-wrap gap-2">
          {Array.from(catHealth.entries()).map(([cat, status]) => {
            const colors = status === "critical"
              ? "bg-red-500/10 text-red-400 border-red-500/20"
              : status === "low"
              ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
              : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
            return (
              <span key={cat} className={`px-2.5 py-1 rounded-full text-xs font-medium border ${colors}`}>
                {CATEGORY_LABELS[cat] || cat}
              </span>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {data.stockLevels.length === 0 && (
        <div className="text-center py-12 rounded-xl bg-[#161616] border border-[#2A2A2A]">
          <Package className="size-10 mx-auto text-[#D4A574] mb-3" />
          <h3 className="text-base font-semibold text-white mb-1">No inventory data yet</h3>
          <p className="text-xs text-[#999]">Run your first stock take to see data here.</p>
        </div>
      )}
    </div>
  );
}

// ─── Org Summary Table ───────────────────────────────────────────

function OrgSummaryTable({
  locations,
  isLoading,
  selectedLocationId,
  onSelectLocation,
}: {
  locations: OrgLocationSummary[];
  isLoading: boolean;
  selectedLocationId: string | null;
  onSelectLocation: (id: string) => void;
}) {
  if (isLoading) return null;

  const totals = locations.reduce(
    (acc, l) => ({
      items: acc.items + l.totalItems,
      low: acc.low + l.lowStock,
      critical: acc.critical + l.critical,
      value: acc.value + l.inventoryValue,
    }),
    { items: 0, low: 0, critical: 0, value: 0 },
  );

  return (
    <div className="rounded-xl border border-[#2A2A2A] overflow-hidden">
      <div className="px-4 py-3 bg-[#161616] border-b border-[#2A2A2A] flex items-center gap-2">
        <MapPin className="size-4 text-[#D4A574]" />
        <span className="text-xs font-semibold text-white uppercase tracking-wider">All Locations</span>
      </div>
      <div className="divide-y divide-[#2A2A2A]/50">
        {/* Header */}
        <div className="hidden sm:grid grid-cols-6 gap-2 px-4 py-2 text-[10px] text-[#666] uppercase tracking-wider">
          <div className="col-span-2">Location</div>
          <div className="text-right">Items</div>
          <div className="text-right">Low</div>
          <div className="text-right">Crit</div>
          <div className="text-right">Value</div>
        </div>
        {locations.map((loc) => (
          <button
            key={loc.storeLocationId}
            onClick={() => onSelectLocation(loc.storeLocationId)}
            className={`w-full grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-2.5 transition-colors text-left ${
              selectedLocationId === loc.storeLocationId
                ? "bg-[#D4A574]/10 border-l-2 border-l-[#D4A574]"
                : "hover:bg-[#1E1E1E]/50"
            }`}
          >
            <div className="col-span-3 sm:col-span-2 flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                loc.critical > 0 ? "bg-red-400" : loc.lowStock > 0 ? "bg-amber-400" : "bg-emerald-400"
              }`} />
              <span className="text-sm text-white truncate">{loc.locationName}</span>
              {loc.lastCountDttm && (
                <span className="text-[10px] text-[#666] shrink-0 hidden sm:inline">
                  {formatTimeAgo(loc.lastCountDttm)}
                </span>
              )}
            </div>
            <div className="text-right text-sm text-white tabular-nums">{loc.totalItems}</div>
            <div className={`text-right text-sm tabular-nums ${loc.lowStock > 0 ? "text-amber-400" : "text-[#666]"}`}>
              {loc.lowStock}
            </div>
            <div className={`text-right text-sm tabular-nums ${loc.critical > 0 ? "text-red-400" : "text-[#666]"}`}>
              {loc.critical}
            </div>
            <div className="text-right text-sm text-emerald-400 tabular-nums hidden sm:block">
              ${loc.inventoryValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </button>
        ))}
        {/* Totals row */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-2.5 bg-[#161616]">
          <div className="col-span-3 sm:col-span-2 text-xs text-[#999] font-medium">Total</div>
          <div className="text-right text-xs text-white font-medium tabular-nums">{totals.items}</div>
          <div className={`text-right text-xs font-medium tabular-nums ${totals.low > 0 ? "text-amber-400" : "text-[#666]"}`}>
            {totals.low}
          </div>
          <div className={`text-right text-xs font-medium tabular-nums ${totals.critical > 0 ? "text-red-400" : "text-[#666]"}`}>
            {totals.critical}
          </div>
          <div className="text-right text-xs text-emerald-400 font-medium tabular-nums hidden sm:block">
            ${totals.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Drill-Down View ─────────────────────────────────────────────

function DrillDownView({
  locationName, items, onClose,
}: {
  locationName: string;
  items: LocationIngredient[];
  onClose: () => void;
}) {
  const lowItems = items.filter((i) => getStockStatus(i) === "low");
  const critItems = items.filter((i) => getStockStatus(i) === "critical");

  let totalValue = 0;
  for (const item of items) {
    const qty = Number(item.currentQty || 0);
    const cost = Number(item.locationUnitCost || item.orgUnitCost || 0);
    totalValue += qty * cost;
  }

  return (
    <div className="rounded-xl border border-[#D4A574]/20 bg-[#161616] overflow-hidden animate-[fadeIn_150ms_ease-out]">
      <div className="px-4 py-3 bg-[#D4A574]/5 border-b border-[#D4A574]/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="size-4 text-[#D4A574]" />
          <span className="text-sm font-semibold text-white">{locationName}</span>
          <span className="text-xs text-[#999]">
            {items.length} items · ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>
        <button onClick={onClose} className="text-xs text-[#999] hover:text-white transition-colors">
          Close
        </button>
      </div>

      {critItems.length > 0 && (
        <div className="px-4 py-2 border-b border-[#2A2A2A]/50">
          <p className="text-[10px] text-red-400 font-semibold uppercase tracking-wider mb-1">Critical</p>
          {critItems.map((item) => (
            <div key={item.ingredientId} className="flex justify-between text-xs py-0.5">
              <span className="text-white">{item.ingredientName}</span>
              <span className="text-red-400 tabular-nums">{Number(item.currentQty || 0).toFixed(1)} / par {Number(item.parLevel || 0).toFixed(0)}</span>
            </div>
          ))}
        </div>
      )}

      {lowItems.length > 0 && (
        <div className="px-4 py-2 border-b border-[#2A2A2A]/50">
          <p className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider mb-1">Low Stock</p>
          {lowItems.map((item) => (
            <div key={item.ingredientId} className="flex justify-between text-xs py-0.5">
              <span className="text-white">{item.ingredientName}</span>
              <span className="text-amber-400 tabular-nums">{Number(item.currentQty || 0).toFixed(1)} / par {Number(item.parLevel || 0).toFixed(0)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Stock table */}
      <div className="divide-y divide-[#2A2A2A]/30">
        <div className="hidden sm:grid grid-cols-5 gap-1 px-4 py-1.5 text-[10px] text-[#666] uppercase tracking-wider">
          <div className="col-span-2">Item</div>
          <div className="text-right">Stock</div>
          <div className="text-right">Par</div>
          <div className="text-right">Cost</div>
        </div>
        {items.map((item) => {
          const status = getStockStatus(item);
          const statusColor = status === "critical" ? "text-red-400" : status === "low" ? "text-amber-400" : "text-[#999]";
          return (
            <div key={item.ingredientId} className="grid grid-cols-5 gap-1 px-4 py-1.5 text-xs hover:bg-[#1E1E1E]/30 transition-colors">
              <div className="col-span-2 text-white truncate">{item.ingredientName}</div>
              <div className={`text-right tabular-nums ${statusColor}`}>
                {item.currentQty ? `${Number(item.currentQty).toFixed(1)} ${item.baseUnit}` : "—"}
              </div>
              <div className="text-right text-[#666] tabular-nums">
                {item.parLevel ? Number(item.parLevel).toFixed(0) : "—"}
              </div>
              <div className="text-right text-[#666] tabular-nums">
                {item.locationUnitCost || item.orgUnitCost
                  ? `$${Number(item.locationUnitCost || item.orgUnitCost).toFixed(2)}`
                  : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Stock Alert List (expanded items) ──────────────────────────

function StockAlertList({ items }: { items: LocationIngredient[] }) {
  return (
    <div className="divide-y divide-[#2A2A2A]/30">
      {items.map((item) => {
        const qty = Number(item.currentQty || 0);
        const par = Number(item.parLevel || 0);
        const cost = Number(item.locationUnitCost || item.orgUnitCost || 0);
        const atRisk = par > 0 ? (par - qty) * cost : 0;
        return (
          <div key={item.ingredientId} className="flex items-center justify-between px-4 py-1.5 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-white truncate">{item.ingredientName}</span>
              <span className="text-[10px] text-[#666] shrink-0">
                {qty.toFixed(1)} {item.baseUnit} / par {par}
              </span>
            </div>
            {atRisk > 0 && (
              <span className="text-[10px] text-[#999] shrink-0 ml-2">
                ${atRisk.toFixed(0)} at risk
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Value Breakdown ─────────────────────────────────────────────

function ValueBreakdown({ valueByCat, total }: { valueByCat: Map<string, number>; total: number }) {
  const sorted = Array.from(valueByCat.entries()).sort((a, b) => b[1] - a[1]);
  const maxVal = sorted[0]?.[1] || 1;

  return (
    <div className="p-4 rounded-xl bg-[#161616] border border-[#2A2A2A]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] text-[#999] uppercase tracking-wider">Value by Category</span>
        <span className="text-sm font-bold text-white">
          ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      </div>
      <div className="space-y-1.5">
        {sorted.slice(0, 6).map(([cat, val]) => {
          const pct = (val / total) * 100;
          const barWidth = (val / maxVal) * 100;
          return (
            <div key={cat} className="flex items-center gap-2">
              <span className="text-[10px] text-[#999] w-16 truncate">
                {CATEGORY_LABELS[cat] || cat}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-[#2A2A2A] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                  style={{ width: `${barWidth}%` }}
                />
              </div>
              <span className="text-[10px] text-[#666] w-16 text-right tabular-nums">
                ${val.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({pct.toFixed(0)}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────

function formatTimeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

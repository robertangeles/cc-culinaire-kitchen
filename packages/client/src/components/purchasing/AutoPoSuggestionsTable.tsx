/**
 * @module components/purchasing/AutoPoSuggestionsTable
 *
 * Phase 4c: par-vs-stock reorder suggestions, grouped by preferred supplier.
 *
 * Static read-only list. The buyer reads the page and decides what to call
 * each supplier about. No PO is created here — the existing
 * PurchaseOrderForm handles that flow.
 */

import { Loader2, Truck, AlertTriangle, RefreshCw } from "lucide-react";
import { useLocation } from "../../context/LocationContext.js";
import { useAutoPoSuggestions } from "../../hooks/useAutoPoSuggestions.js";

export function AutoPoSuggestionsTable() {
  const { selectedLocationId } = useLocation();
  const { result, loading, error, refresh } = useAutoPoSuggestions(selectedLocationId);

  if (!selectedLocationId) {
    return (
      <div className="bg-[#161616] border border-[#2A2A2A] rounded-xl p-8 text-center">
        <Truck className="size-8 mx-auto mb-2 text-[#D4A574]" />
        <p className="text-[#999]">Select a location to see reorder suggestions.</p>
      </div>
    );
  }

  if (loading && !result) {
    return (
      <div className="flex items-center justify-center py-12 text-[#999]">
        <Loader2 className="size-5 animate-spin mr-2" />
        Computing reorder suggestions…
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-3 rounded-lg bg-red-900/20 border border-red-700/40 text-red-300 inline-flex items-center gap-2">
        <AlertTriangle className="size-4" /> {error}
      </div>
    );
  }

  if (!result || result.totalLines === 0) {
    return (
      <div className="bg-[#161616] border border-[#2A2A2A] rounded-xl p-10 text-center">
        <Truck className="size-10 mx-auto mb-3 text-emerald-500" />
        <h3 className="text-white font-semibold mb-1">All stocked up</h3>
        <p className="text-[#999] text-sm">Nothing is below par at this location right now.</p>
        <button
          onClick={refresh}
          className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2A2A2A] text-[#999] text-xs hover:text-white hover:border-[#D4A574]/40 transition-colors"
        >
          <RefreshCw className="size-3" /> Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-[#999]">
          {result.totalLines} item{result.totalLines === 1 ? "" : "s"} below par
          {result.totalEstimatedCost > 0 && (
            <> · estimated total ${result.totalEstimatedCost.toFixed(2)}</>
          )}
        </p>
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2A2A2A] text-[#999] text-xs hover:text-white hover:border-[#D4A574]/40 transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {result.suppliers.map((s) => (
        <section key={s.supplierId ?? "__unassigned__"} className="bg-[#161616] border border-[#2A2A2A] rounded-xl overflow-hidden">
          <header className="flex items-baseline justify-between px-4 py-3 border-b border-[#2A2A2A] bg-gradient-to-r from-[#1E1E1E] to-[#161616]">
            <h3 className="text-white font-semibold text-sm flex items-center gap-2">
              <Truck className="size-4 text-[#D4A574]" />
              {s.supplierName}
              <span className="text-xs font-normal text-[#999]">({s.lines.length} item{s.lines.length === 1 ? "" : "s"})</span>
            </h3>
            {s.estimatedTotal > 0 && (
              <span className="text-xs text-[#999]">Est. ${s.estimatedTotal.toFixed(2)}</span>
            )}
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase text-[#777] tracking-wide">
                  <th className="text-left py-2 px-4 font-medium">Ingredient</th>
                  <th className="text-right py-2 px-4 font-medium">On hand</th>
                  <th className="text-right py-2 px-4 font-medium">Par</th>
                  <th className="text-right py-2 px-4 font-medium">Suggest</th>
                  <th className="text-right py-2 px-4 font-medium">Unit cost</th>
                  <th className="text-right py-2 px-4 font-medium">Est. total</th>
                </tr>
              </thead>
              <tbody>
                {s.lines.map((line) => (
                  <tr key={line.ingredientId} className="border-t border-[#2A2A2A] hover:bg-[#1A1A1A] transition-colors">
                    <td className="py-2 px-4 text-white">{line.ingredientName}</td>
                    <td className="py-2 px-4 text-right tabular-nums text-[#999]">
                      {line.currentQty.toFixed(2)} {line.baseUnit}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums text-[#999]">
                      {line.parLevel.toFixed(2)} {line.baseUnit}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums text-amber-400 font-medium">
                      {line.suggestedQty.toFixed(2)} {line.baseUnit}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums text-[#999]">
                      {line.preferredUnitCost != null ? `$${line.preferredUnitCost.toFixed(2)}` : "—"}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums text-white">
                      {line.estimatedCost != null ? `$${line.estimatedCost.toFixed(2)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

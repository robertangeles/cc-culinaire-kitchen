/**
 * @module components/menu/MiseEnPlaceSheet
 *
 * Phase 4b: forecast → station-grouped prep sheet for the line.
 *
 * Form: serviceDate + coversForecast → fetch /api/menu/mise-en-place.
 * Output: stations rendered top-to-bottom; each station lists its
 * ingredients with quantity + allergen icons. Print CSS hides app chrome
 * so chefs can paste the page into their kitchen book.
 */

import { useState } from "react";
import { Loader2, Printer, ChefHat, AlertTriangle } from "lucide-react";
import { useMiseEnPlace } from "../../hooks/useMiseEnPlace.js";

const ALLERGEN_LABELS: Record<string, string> = {
  dairy: "Dairy",
  gluten: "Gluten",
  nuts: "Nuts",
  shellfish: "Shellfish",
  eggs: "Eggs",
};

export function MiseEnPlaceSheet() {
  const today = new Date().toISOString().slice(0, 10);
  const [serviceDate, setServiceDate] = useState(today);
  const [coversForecast, setCoversForecast] = useState(80);
  const { result, loading, error, fetchSheet } = useMiseEnPlace();

  return (
    <div className="space-y-4">
      {/* Form (hidden in print) */}
      <div className="bg-white rounded-xl border border-stone-200 p-4 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase text-stone-500 tracking-wide">Service date</label>
            <input
              type="date"
              value={serviceDate}
              onChange={(e) => setServiceDate(e.target.value)}
              className="px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase text-stone-500 tracking-wide">Forecast covers</label>
            <input
              type="number"
              min={1}
              max={100000}
              value={coversForecast}
              onChange={(e) => setCoversForecast(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-32 px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
          </div>
          <button
            onClick={() => fetchSheet(serviceDate, coversForecast)}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 text-white text-sm font-medium hover:from-amber-600 hover:to-amber-700 disabled:opacity-60 transition-all shadow-sm"
          >
            {loading ? (
              <span className="inline-flex items-center gap-1.5"><Loader2 className="size-4 animate-spin" /> Building…</span>
            ) : (
              "Build prep sheet"
            )}
          </button>
          {result && (
            <button
              onClick={() => window.print()}
              className="px-4 py-2 rounded-lg border border-stone-300 text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors inline-flex items-center gap-1.5"
            >
              <Printer className="size-4" /> Print
            </button>
          )}
        </div>
        {error && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 inline-flex items-center gap-2">
            <AlertTriangle className="size-4" /> {error}
          </div>
        )}
      </div>

      {/* Sheet */}
      {result && (
        <div className="bg-white rounded-xl border border-stone-200 p-6 print:p-0 print:border-none">
          <div className="flex items-baseline justify-between mb-4 print:mb-2">
            <h2 className="text-xl font-semibold text-stone-800 inline-flex items-center gap-2">
              <ChefHat className="size-5 text-amber-600 print:hidden" />
              Mise en Place — {result.serviceDate}
            </h2>
            <p className="text-sm text-stone-500">
              {result.coversForecast} covers · {result.totalDishes} dishes · {result.totalIngredientLines} prep lines
            </p>
          </div>

          {result.stations.length === 0 ? (
            <p className="text-stone-500 text-sm py-8 text-center">
              No active dishes with sales data yet. Import sales first so the rollup has popularity signal.
            </p>
          ) : (
            <div className="space-y-6">
              {result.stations.map((station) => (
                <section key={station.stationName} className="station-block break-inside-avoid">
                  <h3 className="station-heading text-base font-semibold text-stone-800 border-b border-stone-300 pb-1 mb-2">
                    {station.stationName}
                  </h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase text-stone-500">
                        <th className="text-left py-1 font-medium">Ingredient</th>
                        <th className="text-right py-1 font-medium w-32">Quantity</th>
                        <th className="text-left py-1 font-medium pl-3 w-48">Allergens</th>
                        <th className="text-left py-1 font-medium pl-3 w-56">For dishes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {station.ingredients.map((line, idx) => (
                        <tr
                          key={`${line.ingredientId ?? line.ingredientName}|${idx}`}
                          className="ingredient-row border-t border-stone-100"
                        >
                          <td className="py-1.5 text-stone-800">{line.ingredientName}</td>
                          <td className="py-1.5 text-right tabular-nums text-stone-700">
                            {line.totalQty.toFixed(2)} {line.unit}
                          </td>
                          <td className="py-1.5 pl-3 text-xs text-stone-500">
                            {line.containsAllergens.length > 0
                              ? line.containsAllergens.map((a) => ALLERGEN_LABELS[a] ?? a).join(", ")
                              : "—"}
                          </td>
                          <td className="py-1.5 pl-3 text-xs text-stone-500 truncate" title={line.dishes.join(", ")}>
                            {line.dishes.slice(0, 3).join(", ")}
                            {line.dishes.length > 3 ? ` +${line.dishes.length - 3}` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Print stylesheet — hides app chrome and enforces page-break behavior */}
      <style>{`
        @media print {
          body { background: white; color: black; }
          nav, aside, header, .print\\:hidden { display: none !important; }
          .station-block { page-break-inside: avoid; margin-bottom: 16pt; }
          .ingredient-row { font-size: 11pt; line-height: 1.45; }
          .station-heading { font-size: 14pt; }
        }
      `}</style>
    </div>
  );
}

import { type Dispatch, type SetStateAction } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type { MenuItem, MenuIngredient } from "../../hooks/useMenuItems.js";
import { IngredientPickerInline } from "../inventory/IngredientPickerInline.js";
import { resolveQtyToKitchen, resolvableUnits, type CustomConversion } from "@culinaire/shared";

const UNITS = [
  "kg", "g", "mg",
  "L", "mL", "tsp", "tbsp", "cup", "fl oz",
  "each", "dozen", "portion",
  "bottle", "can", "bag", "box", "case", "bunch",
];

export interface IngredientRow {
  tempId: number;
  existingId?: number;
  ingredientId?: string | null;
  ingredientName: string;
  note?: string | null;
  quantity: string;
  unit: string;
  baseUnit?: string;
  contentQty?: string | null;
  contentUnit?: string | null;
  purchaseUnit?: string | null;
  packQty?: string | null;
  densityGPerMl?: string | null;
  costUpdatedAt?: string | null;
  unitCost: string;
  yieldPct: string;
  costStaleInd?: boolean;
}

// ─── Cost utilities ────────────────────────────────────────────────

function toKitchenQty(
  row: IngredientRow,
  qty: number,
  conversions: CustomConversion[],
): number | null {
  if (!row.baseUnit || row.unit === row.baseUnit) return qty;
  try {
    return resolveQtyToKitchen(
      {
        baseUnit: row.baseUnit,
        purchaseUnit: row.purchaseUnit ?? null,
        packQty: row.packQty ?? null,
        contentQty: row.contentQty ?? null,
        contentUnit: row.contentUnit ?? null,
        densityGPerMl: row.densityGPerMl ?? null,
      },
      qty,
      row.unit,
      conversions,
    );
  } catch {
    // IncompatibleUnitsError — no resolution path (setup issue, never a guess).
    return null;
  }
}

export function calcLineCost(row: IngredientRow, conversions: CustomConversion[]): number {
  const qty = parseFloat(row.quantity) || 0;
  const cost = parseFloat(row.unitCost) || 0;
  const yld = parseFloat(row.yieldPct) || 100;
  if (yld === 0) return 0;

  const qtyInBase = toKitchenQty(row, qty, conversions);
  if (qtyInBase === null) return 0;
  const raw = (qtyInBase * cost) / (yld / 100);
  return Math.round(raw * 100) / 100;
}

function hasUnitMismatch(row: IngredientRow, conversions: CustomConversion[]): boolean {
  if (!row.baseUnit || !row.ingredientId || row.unit === row.baseUnit) return false;
  return toKitchenQty(row, 1, conversions) === null;
}

/** Linked row with no cost anywhere (never received, no supplier cost). */
function hasNoCostData(row: IngredientRow): boolean {
  return Boolean(row.ingredientId) && !(parseFloat(row.unitCost) > 0);
}

function costAge(row: IngredientRow): string | null {
  if (!row.costUpdatedAt) return null;
  const ms = Date.now() - new Date(row.costUpdatedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "today";
  return `${days}d ago`;
}

function buildConversionText(row: IngredientRow, conversions: CustomConversion[]): string | null {
  if (!row.ingredientId || !row.baseUnit) return null;
  const qty = parseFloat(row.quantity) || 0;
  const cost = parseFloat(row.unitCost) || 0;
  const yld = parseFloat(row.yieldPct) || 100;
  if (qty === 0 && cost === 0) return null;

  const resolved = toKitchenQty(row, qty, conversions);
  const qtyInBase = resolved ?? qty;
  const converted = resolved !== null && row.unit !== row.baseUnit;

  const qtyStr = converted
    ? `${qty}${row.unit} = ${Number(qtyInBase.toFixed(4))} ${row.baseUnit}`
    : `${Number(qtyInBase.toFixed(4))} ${row.baseUnit}`;
  const costStr = `$${cost.toFixed(4)}/${row.baseUnit}`;
  const lineCost = yld > 0 ? (qtyInBase * cost) / (yld / 100) : 0;

  // Cost provenance: age from the catalog row's last update when known.
  const age = costAge(row);
  const provenance = ` · org cost${age ? `, ${age}` : ""}`;

  if (yld !== 100) {
    return `${qtyStr} × ${costStr} / ${yld}% yield = $${lineCost.toFixed(2)}${provenance}`;
  }
  return `${qtyStr} × ${costStr} = $${lineCost.toFixed(2)}${provenance}`;
}

// ─── Component ────────────────────────────────────────────────────

interface IngredientsSectionProps {
  ingredients: IngredientRow[];
  expandedCostRow: number | null;
  editItem: MenuItem | null;
  onRefreshIngredientCost?: (itemId: string, rowId: number) => Promise<MenuIngredient>;
  setIngredients: Dispatch<SetStateAction<IngredientRow[]>>;
  setExpandedCostRow: (id: number | null) => void;
  setError: (msg: string) => void;
  conversionsFor: (ingredientId?: string | null) => CustomConversion[];
  conversionsLoading: (ingredientId?: string | null) => boolean;
  ensureConversions: (ingredientId?: string | null) => void;
  onAdd: () => void;
  onRemove: (tempId: number) => void;
  onUpdate: (tempId: number, field: keyof IngredientRow, value: string) => void;
}

export function IngredientsSection({
  ingredients,
  expandedCostRow,
  editItem,
  onRefreshIngredientCost,
  setIngredients,
  setExpandedCostRow,
  setError,
  conversionsFor,
  conversionsLoading,
  ensureConversions,
  onAdd,
  onRemove,
  onUpdate,
}: IngredientsSectionProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[#FAFAFA]">Ingredients</h3>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gold bg-gold/10 rounded-lg border border-gold/20 hover:bg-gold/20 transition-colors min-h-[36px]"
        >
          <Plus className="size-3" />
          Add Ingredient
        </button>
      </div>

      {ingredients.length > 0 && (
        <div className="space-y-2">
          <div
            className="grid gap-2 text-[10px] uppercase text-dark-500 font-medium px-1"
            style={{ gridTemplateColumns: "1fr 80px 70px 85px 65px 80px 36px" }}
          >
            <div>Name</div>
            <div>Qty</div>
            <div>Unit</div>
            <div>Cost</div>
            <div>Yield %</div>
            <div className="text-right">Line Cost</div>
            <div />
          </div>

          {ingredients.map((row) => {
            const rowConversions = conversionsFor(row.ingredientId);
            const lineCost = calcLineCost(row, rowConversions);
            const unitMismatch = hasUnitMismatch(row, rowConversions);
            const breakdown =
              expandedCostRow === row.tempId ? buildConversionText(row, rowConversions) : null;
            const noCost = hasNoCostData(row);
            const rowUnits =
              row.ingredientId && row.baseUnit
                ? (() => {
                    const opts = resolvableUnits(
                      {
                        baseUnit: row.baseUnit,
                        purchaseUnit: row.purchaseUnit ?? null,
                        packQty: row.packQty ?? null,
                        contentQty: row.contentQty ?? null,
                        contentUnit: row.contentUnit ?? null,
                        densityGPerMl: row.densityGPerMl ?? null,
                      },
                      rowConversions,
                    );
                    if (!opts.some((u) => u.toLowerCase() === row.unit.toLowerCase())) {
                      opts.unshift(row.unit);
                    }
                    return opts;
                  })()
                : UNITS;

            return (
              <div key={row.tempId}>
                <div
                  className="grid gap-2 items-start"
                  style={{ gridTemplateColumns: "1fr 80px 70px 85px 65px 80px 36px" }}
                >
                  <div className="min-w-0">
                    <IngredientPickerInline
                      linkedId={row.ingredientId}
                      displayName={row.ingredientName}
                      costStale={row.costStaleInd}
                      onRefresh={
                        row.existingId && onRefreshIngredientCost && editItem
                          ? async () => {
                              try {
                                const updated = await onRefreshIngredientCost(
                                  editItem.menuItemId,
                                  row.existingId!,
                                );
                                setIngredients((prev) =>
                                  prev.map((r) =>
                                    r.tempId === row.tempId
                                      ? { ...r, unitCost: updated.unitCost, costStaleInd: false }
                                      : r,
                                  ),
                                );
                              } catch (e) {
                                setError(
                                  e instanceof Error ? e.message : "Failed to refresh cost",
                                );
                              }
                            }
                          : undefined
                      }
                      onPick={(picked) => {
                        ensureConversions(picked.ingredientId);
                        setIngredients((prev) =>
                          prev.map((r) =>
                            r.tempId === row.tempId
                              ? {
                                  ...r,
                                  ingredientId: picked.ingredientId,
                                  ingredientName: picked.ingredientName,
                                  baseUnit: picked.baseUnit || r.unit,
                                  contentQty: picked.contentQty ?? null,
                                  contentUnit: picked.contentUnit ?? null,
                                  densityGPerMl: picked.densityGPerMl ?? null,
                                  purchaseUnit: picked.purchaseUnit ?? null,
                                  packQty: picked.packQty ?? null,
                                  costUpdatedAt: picked.updatedDttm ?? null,
                                  unit: picked.contentUnit || picked.baseUnit || r.unit,
                                  unitCost: picked.preferredUnitCost || picked.unitCost || r.unitCost,
                                  costStaleInd: false,
                                }
                              : r,
                          ),
                        );
                      }}
                      onTextChange={(text) => onUpdate(row.tempId, "ingredientName", text)}
                    />
                    {row.note && (
                      <div
                        className="mt-1 px-2 py-1 text-[10px] text-dark-600 italic truncate"
                        title={row.note}
                      >
                        {row.note}
                      </div>
                    )}
                  </div>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max="999.99"
                    value={row.quantity}
                    onChange={(e) => onUpdate(row.tempId, "quantity", e.target.value)}
                    placeholder="0"
                    className="w-full px-2 py-2 text-xs bg-dark border border-dark-200 rounded-lg text-[#FAFAFA] placeholder-dark-500 focus:outline-none focus:ring-1 focus:ring-gold/50 min-h-[36px]"
                  />
                  <select
                    value={row.unit}
                    onFocus={() => ensureConversions(row.ingredientId)}
                    onChange={(e) => onUpdate(row.tempId, "unit", e.target.value)}
                    className="w-full px-1.5 py-2 text-xs bg-dark border border-dark-200 rounded-lg text-[#FAFAFA] focus:outline-none focus:ring-1 focus:ring-gold/50 min-h-[36px]"
                  >
                    {rowUnits.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                    {conversionsLoading(row.ingredientId) && (
                      <option disabled value="__loading">
                        loading units…
                      </option>
                    )}
                  </select>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={row.unitCost}
                      onChange={(e) => onUpdate(row.tempId, "unitCost", e.target.value)}
                      placeholder="0.00"
                      className="w-full px-2 py-2 text-xs bg-dark border border-dark-200 rounded-lg text-[#FAFAFA] placeholder-dark-500 focus:outline-none focus:ring-1 focus:ring-gold/50 min-h-[36px]"
                    />
                  </div>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    max="200"
                    value={row.yieldPct}
                    onChange={(e) => onUpdate(row.tempId, "yieldPct", e.target.value)}
                    onBlur={(e) => {
                      // Clamp [1,200]: 0 divides by zero; >200 is a typo, not shrinkage.
                      const v = parseInt(e.target.value, 10);
                      const clamped = Number.isFinite(v) ? Math.min(200, Math.max(1, v)) : 100;
                      if (String(clamped) !== e.target.value) {
                        onUpdate(row.tempId, "yieldPct", String(clamped));
                      }
                    }}
                    className="w-full px-1.5 py-2 text-xs bg-dark border border-dark-200 rounded-lg text-[#FAFAFA] focus:outline-none focus:ring-1 focus:ring-gold/50 min-h-[36px] text-center"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedCostRow(expandedCostRow === row.tempId ? null : row.tempId)
                    }
                    className="text-xs text-dark-600 font-mono min-h-[36px] flex items-center justify-end hover:text-gold transition-colors cursor-pointer"
                    title={
                      noCost
                        ? "No cost yet — receive a PO or set a supplier cost"
                        : row.ingredientId
                          ? "Tap to see cost breakdown"
                          : undefined
                    }
                  >
                    {noCost ? "—" : `$${lineCost.toFixed(2)}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(row.tempId)}
                    className="p-1.5 rounded-lg hover:bg-dark-200 text-dark-500 hover:text-red-400 transition-colors flex items-center justify-center min-h-[36px]"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                {breakdown && (
                  <div className="px-2 pb-1 text-[10px] text-gold/80 font-mono">{breakdown}</div>
                )}
                {unitMismatch && (
                  <div className="px-2 pb-1 text-[10px] text-red-400">
                    Unit mismatch: {row.unit} cannot convert to {row.baseUnit}. Change the unit to
                    calculate cost.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {ingredients.length === 0 && (
        <p className="text-xs text-dark-500 py-4 text-center">
          No ingredients added yet. Click "Add Ingredient" to build the cost breakdown.
        </p>
      )}
    </div>
  );
}

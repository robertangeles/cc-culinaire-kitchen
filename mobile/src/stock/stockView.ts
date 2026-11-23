/**
 * What the stock screens show, as pure functions. The blind count rule lives here: a quantity or value the server left out
 * (no `inventory:cost`) is written as a dash, never as 0, and nothing is decided on it.
 */

import { CATEGORY_LABELS, type LocationDashboard, type LocationItem } from "@culinaire/shared/schemas/storeRoom";
import type { StorageArea } from "@culinaire/shared/schemas/stockMovement";
import { rankIngredients } from "../ingredients/source";

export const DASH = "—";

const amount = (n: number) => String(Math.round(n * 100) / 100);

/** "2.5 kg"; a dash when the quantity is hidden (undefined) or not recorded (null). */
export const qtyText = (qty: number | null | undefined, unit: string) => (qty === null || qty === undefined ? DASH : `${amount(qty)}${unit ? ` ${unit}` : ""}`);

/** Whole dollars, as the web's dashboard writes them. */
export const money = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;

/** "dry_goods" -> "Dry Goods": the web's label, else the key with its words capitalised. */
export const categoryLabel = (key: string) => CATEGORY_LABELS[key] ?? (key ? key.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()) : "Other");

export interface AlertItem {
  ingredientId: string;
  name: string;
  onHand: string;
  par: string;
}

/**
 * The server's low and critical lists (`stockSummary`), with names and figures from the location's item list, else the dashboard's
 * stock rows. Everyone who may see stock gets these lists; only the quantities are hidden from a blind counter.
 */
export function alertLists(dashboard: LocationDashboard, items: LocationItem[]): { critical: AlertItem[]; low: AlertItem[] } {
  const byId = new Map<string, { ingredientName: string; baseUnit: string; currentQty?: number | null; parLevel: number | null }>(dashboard.stockLevels.map((l) => [l.ingredientId, l]));
  for (const i of items) byId.set(i.ingredientId, { ...i, currentQty: i.currentQty ?? byId.get(i.ingredientId)?.currentQty });
  const toAlerts = (ids: string[]) =>
    ids
      .map((id): AlertItem => {
        const i = byId.get(id);
        return i ? { ingredientId: id, name: i.ingredientName, onHand: qtyText(i.currentQty, i.baseUnit), par: qtyText(i.parLevel, i.baseUnit) } : { ingredientId: id, name: "An item no longer in the catalogue", onHand: DASH, par: DASH };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  return { critical: toAlerts(dashboard.stockSummary.criticalIngredientIds), low: toAlerts(dashboard.stockSummary.lowIngredientIds) };
}

/** Stock value by category, largest first, or null when the server sent no value (no `inventory:cost`): then no value is shown at all. */
export function valueRows(dashboard: LocationDashboard): { total: string; rows: { label: string; value: string; share: number }[] } | null {
  const { stockValue, valueByCategory } = dashboard.stockSummary;
  if (stockValue === undefined) return null;
  const rows = [...(valueByCategory ?? [])].sort((a, b) => b.value - a.value).map((v) => ({ label: categoryLabel(v.category), value: money(v.value), share: stockValue > 0 ? Math.round((v.value / stockValue) * 100) / 100 : 0 }));
  return { total: money(stockValue), rows };
}

/** Typed: the whole catalogue (active here or not), best match first. Empty: the items active here, A to Z. */
export function findItems(items: LocationItem[], query: string): LocationItem[] {
  if (!query.trim()) return items.filter((i) => i.activeInd).sort((a, b) => a.ingredientName.localeCompare(b.ingredientName));
  return rankIngredients(query, items.map((i) => ({ ...i, name: i.ingredientName })), 50);
}

/** The areas an item is kept in at this location, in the venue's own order; an area no longer in use is left out. */
export const areasOf = (ingredientId: string, assignments: Record<string, string[]>, areas: StorageArea[]) => {
  const ids = new Set(assignments[ingredientId] ?? []);
  return areas.filter((a) => ids.has(a.storageAreaId)).map((a) => a.areaName);
};

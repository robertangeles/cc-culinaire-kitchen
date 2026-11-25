/**
 * The order being written, as pure functions: what a line starts with, how it is priced, what is sent. The unit and cost rules are the web
 * form's: a line is ordered in the item's package when it has one, and priced per that unit, while stored costs are per kitchen unit.
 */

import { costForOrderedUnit } from "@culinaire/shared";
import type { PurchaseOrderInput } from "@culinaire/shared/schemas/purchaseOrder";
import type { OrderDetail, OrderGuideItem, OrderItem } from "@culinaire/shared/schemas/purchasing";
import { formatQty } from "../receiving/receivingFlow";

export interface DraftLine {
  ingredientId: string;
  ingredientName: string;
  /** As typed; "0" keeps a guide's item in sight without ordering it. */
  qty: string;
  unit: string;
  /** Per `unit`, as typed or as the server's cost; "" when there is none or the person may not see it. */
  cost: string;
}

export interface Draft {
  supplierId: string | null;
  supplierName: string;
  guideId: string | null;
  lines: DraftLine[];
  /** YYYY-MM-DD. */
  expectedDate: string | null;
  notes: string;
  /** The order's id, made on the phone at the first save, so a save sent again after a lost reply finds the same order. */
  poId: string | null;
}

export const emptyDraft: Draft = { supplierId: null, supplierName: "", guideId: null, lines: [], expectedDate: null, notes: "", poId: null };
export const isEmpty = (d: Draft) => d.supplierId === null && d.lines.length === 0 && d.notes === "" && d.expectedDate === null;

/** A number as the person would type it, a comma for the decimal point included; null when it is not one. */
export function typedNumber(text: string): number | null {
  const t = text.trim().replace(",", ".");
  const n = Number(t);
  return t === "" || !Number.isFinite(n) ? null : n;
}

/** What the server says an item costs per `unit`, or "" when it sent no cost. */
export function costFor(item: OrderItem, unit: string): string {
  const base = item.locationUnitCost ?? item.orgUnitCost;
  return base === null ? "" : String(costForOrderedUnit(base, item.packQty, item.purchaseUnit, unit));
}

/** The units a line may be ordered in: the package first, then the kitchen unit. */
export const unitsOf = (item: Pick<OrderItem, "purchaseUnit" | "baseUnit">) => [...new Set([item.purchaseUnit, item.baseUnit].filter((u): u is string => !!u))];

export function lineFromItem(item: OrderItem): DraftLine {
  const unit = item.purchaseUnit || item.baseUnit;
  return { ingredientId: item.ingredientId, ingredientName: item.ingredientName, qty: "1", unit, cost: costFor(item, unit) };
}

/** The order quantity that takes an item back to par: whole packages when it is bought in them. The server works it out; 0 when already there. */
export const toPar = (g: OrderGuideItem) => formatQty(g.suggestedPackages ?? g.suggestedOrderQty ?? 0);

export function lineFromGuide(g: OrderGuideItem): DraftLine {
  const cost = g.unitCost === null ? "" : String(g.packUnitCost ?? g.unitCost);
  return { ingredientId: g.ingredientId, ingredientName: g.ingredientName, qty: toPar(g), unit: g.purchaseUnit || g.baseUnit, cost };
}

/** A price is per the unit it was typed for: another unit takes the server's cost for it, or none. */
export const withUnit = (line: DraftLine, unit: string, item: OrderItem | undefined): DraftLine => (line.unit === unit ? line : { ...line, unit, cost: item ? costFor(item, unit) : "" });

export const lineTotal = (line: DraftLine): number | null => {
  const qty = typedNumber(line.qty);
  const cost = typedNumber(line.cost);
  return qty === null || cost === null ? null : Math.round(qty * cost * 100) / 100;
};

/** Lines that will be ordered: a guide's item left at 0 is not. */
export const orderable = (d: Draft) => d.lines.filter((l) => (typedNumber(l.qty) ?? 0) > 0);

/** What the order comes to so far, and how many ordered items have no price in it. */
export function draftTotal(d: Draft): { total: number; unpriced: number } {
  const lines = orderable(d);
  const priced = lines.map(lineTotal).filter((t): t is number => t !== null);
  return { total: Math.round(priced.reduce((a, b) => a + b, 0) * 100) / 100, unpriced: lines.length - priced.length };
}

/** What stops it being saved, in the order the screen shows the fields; null when nothing does. */
export function draftProblem(d: Draft): string | null {
  if (!d.supplierId) return "Choose a supplier.";
  if (d.lines.length === 0) return "Add at least one item.";
  for (const l of d.lines) {
    const qty = typedNumber(l.qty);
    if (l.qty.trim() !== "" && (qty === null || qty < 0)) return `Check the quantity of ${l.ingredientName}.`;
    const cost = typedNumber(l.cost);
    if (l.cost.trim() !== "" && (cost === null || cost < 0)) return `Check the price of ${l.ingredientName}.`;
  }
  if (orderable(d).length === 0) return "Nothing to order yet: set a quantity on at least one item.";
  return null;
}

export function toBody(d: Draft, storeLocationId: string): PurchaseOrderInput {
  return {
    storeLocationId,
    supplierId: d.supplierId!,
    lines: orderable(d).map((l) => {
      const cost = typedNumber(l.cost);
      return { ingredientId: l.ingredientId, orderedQty: String(typedNumber(l.qty)), orderedUnit: l.unit, ...(cost === null ? {} : { unitCost: String(cost) }) };
    }),
    ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
    ...(d.expectedDate ? { expectedDeliveryDate: d.expectedDate } : {}),
  };
}

/** A saved draft, to change. The server sends prices to everyone with the Orders tab, so one missing here is missing there too and saving loses none. */
export function draftFromOrder(o: OrderDetail): Draft {
  return {
    ...emptyDraft,
    poId: o.poId,
    supplierId: o.supplierId,
    supplierName: o.supplierName ?? "",
    // The server keeps the chosen day as UTC midnight.
    expectedDate: o.expectedDeliveryDate?.slice(0, 10) ?? null,
    notes: o.notes ?? "",
    lines: o.lines.map((l) => ({ ingredientId: l.ingredientId, ingredientName: l.ingredientName ?? "Item", qty: String(l.orderedQty), unit: l.orderedUnit, cost: l.unitCost === null ? "" : String(l.unitCost) })),
  };
}

/** Seven days to choose from, `week` weeks from today: the day as the server takes it and as the chip says it. */
export function weekDays(today: Date, week: number): Array<{ value: string; label: string }> {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + week * 7 + i);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { value, label: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) };
  });
}

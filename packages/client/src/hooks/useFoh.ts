/**
 * @module hooks/useFoh
 *
 * Client hooks + API calls for the Front-of-House (FOH) stock loop: view the
 * shelf, stock the fridge (BOH->FOH), record sales that deduct FOH, reconcile
 * a count, log front-shelf waste, and the sales report. Mirrors the plain-fetch
 * style of useInventory.ts (no React Query in this app).
 */

import { useState, useEffect, useCallback } from "react";

const API = "/api/inventory";
const opts = { credentials: "include" as const };
const jsonOpts = { ...opts, headers: { "Content-Type": "application/json" } };

// ─── Types ────────────────────────────────────────────────────────

export interface FohStockItem {
  ingredientId: string;
  ingredientName: string;
  ingredientCategory: string;
  baseUnit: string;
  fohParLevel: number | null;
  fohQty: number;
  bohQty: number;
  lowFoh: boolean;
}

export interface RestockSuggestion {
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  fohParLevel: number;
  fohQty: number;
  bohQty: number;
  suggestedQty: number;
}

export interface SaleLine {
  ingredientId: string;
  quantity: number;
  unitPrice?: number | null;
}

export interface RecordSalesResult {
  recorded: Array<{ fohSaleId: string; ingredientId: string; quantity: number; fohQty: number; oversold: boolean }>;
  rejected: Array<{ ingredientId: string; quantity: number; reason: string }>;
  oversoldCount: number;
}

export interface FohSaleRow {
  fohSaleId: string;
  ingredientId: string;
  ingredientName: string;
  quantity: string;
  unitPrice: string | null;
  lineTotal: string | null;
  source: string;
  oversoldInd: boolean;
  soldAt: string;
}

export interface FohSalesReport {
  startDate: string;
  endDate: string;
  items: Array<{
    ingredientId: string;
    ingredientName: string;
    unitsSold: number;
    revenue: number;
    cogs: number;
    margin: number;
    marginPct: number | null;
    oversoldLines: number;
  }>;
  totals: { revenue: number; cogs: number; margin: number };
}

// ─── Hook: FOH shelf ──────────────────────────────────────────────

export function useFohStock(locationId: string | null) {
  const [items, setItems] = useState<FohStockItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!locationId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/locations/${locationId}/foh`, opts);
      if (res.ok) setItems(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, [locationId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { items, isLoading, refresh };
}

// ─── API actions ──────────────────────────────────────────────────

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { ...jsonOpts, method: "POST", body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export function restockFoh(locationId: string, ingredientId: string, quantity: number) {
  return post(`${API}/locations/${locationId}/foh/restock`, { ingredientId, quantity });
}

export function countFoh(locationId: string, ingredientId: string, countedQty: number) {
  return post(`${API}/locations/${locationId}/foh/count`, { ingredientId, countedQty });
}

export function wasteFoh(
  locationId: string,
  ingredientId: string,
  quantity: number,
  unit: string,
  reason = "waste",
  notes?: string,
) {
  return post(`${API}/locations/${locationId}/foh/waste`, { ingredientId, quantity, unit, reason, notes });
}

export function recordSales(locationId: string, lines: SaleLine[], source: "MANUAL" | "CSV") {
  return post<RecordSalesResult>(`${API}/locations/${locationId}/sales`, { lines, source });
}

export function updateFohPar(locationId: string, ingredientId: string, fohParLevel: string | null) {
  return fetch(`${API}/locations/${locationId}/ingredients/${ingredientId}`, {
    ...jsonOpts,
    method: "PATCH",
    body: JSON.stringify({ fohParLevel }),
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to update FOH par");
    }
    return res.json();
  });
}

export async function getRestockSuggestions(locationId: string): Promise<RestockSuggestion[]> {
  const res = await fetch(`${API}/locations/${locationId}/foh/restock-suggestions`, opts);
  if (!res.ok) throw new Error("Failed to load suggestions");
  return res.json();
}

export async function getSalesReport(locationId: string): Promise<FohSalesReport> {
  const res = await fetch(`${API}/locations/${locationId}/foh/sales-report`, opts);
  if (!res.ok) throw new Error("Failed to load sales report");
  return res.json();
}

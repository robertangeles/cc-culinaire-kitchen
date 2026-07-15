/**
 * @module hooks/useSales
 *
 * Client API for recipe-based selling: record a menu-item sale (which explodes
 * the recipe and deducts stock), void a sale, list sales, and the two-phase CSV
 * import (preview → commit). Plain-fetch, matching the app's hook style.
 */

const API = "/api/menu-intelligence";
const opts = { credentials: "include" as const };
const jsonOpts = { ...opts, headers: { "Content-Type": "application/json" } };

export interface RecordSaleResult {
  saleId: string;
  alreadyExists?: boolean;
  voided?: boolean;
  depleted: Array<{ ingredientId: string; ingredientName: string; baseQty: number; baseUnit: string; fohOnHand: number; oversold: boolean }>;
  skipped: Array<{ ingredientName: string; reason: string }>;
  oversold: string[];
}

export interface CsvPreview {
  matched: Array<{ rowIndex: number; menuItemId: string; name: string; qtySold: number; soldAt?: string }>;
  unmatched: Array<{ rowIndex: number; name: string; reason: string }>;
}

async function post<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, { ...jsonOpts, headers: { ...jsonOpts.headers, ...headers }, method: "POST", body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export function recordSale(
  menuItemId: string,
  qtySold: number,
  locationId?: string,
  idempotencyKey?: string,
): Promise<RecordSaleResult> {
  return post<RecordSaleResult>(
    `${API}/items/${menuItemId}/sales`,
    { qtySold, locationId },
    idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  );
}

export function voidSale(saleId: string): Promise<{ saleId: string; restored: number }> {
  return post(`${API}/sales/${saleId}/void`, {});
}

export interface SellableConsumable {
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
}

/** FOH consumables that can be sold directly (no menu item needed). */
export async function listConsumables(): Promise<SellableConsumable[]> {
  const res = await fetch(`${API}/consumables`, opts);
  if (!res.ok) throw new Error("Failed to load consumables");
  return res.json();
}

/** Sell a FOH consumable directly: sell 3 cans → stock drops 3. */
export function recordConsumableSale(
  ingredientId: string,
  qtySold: number,
  locationId?: string,
  idempotencyKey?: string,
): Promise<RecordSaleResult> {
  return post<RecordSaleResult>(
    `${API}/consumables/${ingredientId}/sales`,
    { qtySold, locationId },
    idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  );
}

export async function listSales(locationId: string, limit = 50) {
  const res = await fetch(`${API}/locations/${locationId}/sales?limit=${limit}`, opts);
  if (!res.ok) throw new Error("Failed to load sales");
  return res.json() as Promise<Array<{
    saleId: string; menuItemName: string; qtySold: string; source: string; soldAt: string; voidedAt: string | null;
  }>>;
}

export async function previewSalesCsv(file: File): Promise<CsvPreview> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API}/sales/import/preview`, { ...opts, method: "POST", body: form });
  if (!res.ok) throw new Error("Preview failed");
  return res.json();
}

export function commitSalesCsv(lines: CsvPreview["matched"]) {
  return post<{ succeeded: unknown[]; alreadyExists: unknown[]; failed: Array<{ rowIndex: number; reason: string }> }>(
    `${API}/sales/import/commit`,
    { lines },
  );
}

import { vi } from "vitest";
import type { TransferDetail, TransferSummary } from "@culinaire/shared/schemas/transfer";
import type { LocationDashboard, LocationItem, StockAtLocation } from "@culinaire/shared/schemas/storeRoom";
import { ApiError, type ApiClient } from "../src/api/client";
import { createOutbox, type Outbox, type OutboxEntry, type OutboxStore } from "../src/outbox/outbox";
import { createRecents } from "../src/ingredients/recents";
import { createIngredientSource, type IngredientSource, type PickedIngredient } from "../src/ingredients/source";
import type { KvStore } from "../src/storage/kv";
import { transferHandlers } from "../src/transfers/transferCommands";
import type { TransferApi } from "../src/transfers/transferApi";
import { createTransferStore, type TransferStore } from "../src/transfers/transferStore";
import { catalogRequestHandlers } from "../src/stock/catalogRequestCommands";
import type { StockApi } from "../src/stock/stockApi";
import { createStockStore, type StockStore } from "../src/stock/stockStore";
import { CATALOGUE, NOW } from "./stockHarness";

/** The stores a screen test renders against; the mocked `useTransfers` and `useStock` read them from here. */
export const storeRoom = {
  transfers: null as unknown as TransferStore,
  stock: null as unknown as StockStore,
  source: null as unknown as IngredientSource,
  outbox: null as unknown as Outbox,
};

export const transfer = (over: Partial<TransferSummary> = {}): TransferSummary => ({ transferId: "t1", fromLocationId: "L1", toLocationId: "L2", status: "INITIATED", notes: null, sentDttm: null, receivedDttm: null, createdDttm: new Date(NOW - 3600_000).toISOString(), fromLocationName: "Main Kitchen", toLocationName: "Bar", initiatorName: "Sam", lineCount: 1, ...over });
export const detailOf = (t: TransferSummary, lines: TransferDetail["lines"]): TransferDetail => {
  const { initiatorName: _i, lineCount: _l, ...rest } = t;
  return { ...rest, initiatedByUserId: 2, sentByUserId: null, receivedByUserId: null, lines };
};
export const line = (over: Partial<TransferDetail["lines"][number]> = {}): TransferDetail["lines"][number] => ({ lineId: "l1", ingredientId: "i1", sentQty: 2, sentUnit: "L", receivedQty: null, lineStatus: "PENDING", ingredientName: "Gin", baseUnit: "L", ...over });
export const item = (over: Partial<LocationItem> = {}): LocationItem => ({ ingredientId: "i1", ingredientName: "Gin", ingredientCategory: "spirits", itemType: "KITCHEN_INGREDIENT", baseUnit: "L", parLevel: 6, activeInd: true, currentQty: 1, lastCountedDttm: null, supplierName: null, ...over });
export const dashboard = (over: Partial<LocationDashboard> = {}, summary: Partial<LocationDashboard["stockSummary"]> = {}): LocationDashboard => ({
  stockLevels: [{ ingredientId: "i1", ingredientName: "Gin", ingredientCategory: "spirits", baseUnit: "L", currentQty: 1, parLevel: 6 }],
  stockSummary: { lowCount: 0, criticalCount: 1, lowIngredientIds: [], criticalIngredientIds: ["i1"], ...summary },
  activeSession: null,
  lastCompletedSession: null,
  ...over,
});

interface Over {
  transfers?: TransferSummary[];
  details?: Record<string, TransferDetail>;
  items?: LocationItem[];
  dashboard?: LocationDashboard;
  elsewhere?: StockAtLocation[];
  canSeeQty?: boolean;
  send?: ReturnType<typeof vi.fn>;
  readsFail?: ApiError;
}

export async function makeStoreRoom(over: Over = {}) {
  const rows = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  const request = over.send ?? vi.fn(async () => ({}));
  let n = 0;
  const client = { request } as unknown as ApiClient;
  const outbox = createOutbox({ store, send: async () => {}, handlers: [...transferHandlers(client), ...catalogRequestHandlers(client)], now: () => NOW, newId: () => `e${String(++n).padStart(3, "0")}`, getUserId: () => 1 });
  const kvMap = new Map<string, string>();
  const kv: KvStore = { get: async (k) => kvMap.get(k) ?? null, set: async (k, v) => void kvMap.set(k, v), delete: async (k) => void kvMap.delete(k) };
  const read = <T>(value: () => T) => vi.fn(async () => { if (over.readsFail) throw over.readsFail; return value(); });
  let uuid = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`;
  const kick = vi.fn();
  const items = over.items ?? [item()];
  const visible = (rows: LocationItem[]) => (over.canSeeQty === false ? rows.map(({ currentQty: _q, ...r }) => r as LocationItem) : rows);

  const transferApi = { list: read(() => over.transfers ?? []), pending: read(() => []), detail: vi.fn(async (id: string) => { if (over.readsFail) throw over.readsFail; const d = over.details?.[id]; if (!d) throw new ApiError("not_found", "Transfer not found", 404, undefined, "NOT_FOUND"); return d; }), items: read(() => visible(items)) } as unknown as TransferApi;
  const transfers = createTransferStore({ api: transferApi, kv, outbox, userId: 1, userName: "Cook", locationId: "L1", locationName: "Main Kitchen", kick, now: () => NOW, newId });
  const stockApi = { dashboard: read(() => over.dashboard ?? dashboard()), items: read(() => visible(items)), areas: read(() => [{ storageAreaId: "a1", areaName: "Back Bar" }, { storageAreaId: "a2", areaName: "Cool Room" }]), assignments: read(() => ({ i1: ["a1"] })), elsewhere: vi.fn(async () => over.elsewhere ?? []) } as unknown as StockApi;
  const stock = createStockStore({ api: stockApi, kv, outbox, userId: 1, locationId: "L1", canSeeQty: over.canSeeQty ?? true, kick, now: () => NOW, newId });
  await Promise.all([transfers.refresh(), stock.refresh()]);
  // "You have" loads in the background: let it land before a screen reads it.
  await vi.waitFor(() => { if ((transferApi.items as ReturnType<typeof vi.fn>).mock.results.length === 0) throw new Error("on hand not asked for"); });
  await new Promise((r) => setTimeout(r, 0));

  const recents = createRecents<PickedIngredient>({ kv, key: "transfers.recents", max: 12 });
  Object.assign(storeRoom, { transfers, stock, outbox, source: createIngredientSource({ catalogue: { items: async () => CATALOGUE }, recents }) });
  return { transfers, stock, outbox, request, kick, rows, transferApi, stockApi };
}

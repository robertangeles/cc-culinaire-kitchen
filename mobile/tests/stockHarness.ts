import { vi } from "vitest";
import type { ConsumptionEntry } from "@culinaire/shared/schemas/consumption";
import type { StockMovement, StorageArea } from "@culinaire/shared/schemas/stockMovement";
import { ApiError, type ApiClient } from "../src/api/client";
import { createOutbox, type Outbox, type OutboxEntry, type OutboxStore } from "../src/outbox/outbox";
import { createRecents } from "../src/ingredients/recents";
import { createIngredientSource, type IngredientSource } from "../src/ingredients/source";
import type { KvStore } from "../src/storage/kv";
import type { ConsumptionApi } from "../src/consumption/consumptionApi";
import { consumptionHandlers } from "../src/consumption/consumptionCommands";
import { createConsumptionStore, type ConsumptionRecent, type ConsumptionStore } from "../src/consumption/consumptionStore";
import type { MovementApi } from "../src/movements/movementApi";
import { movementHandlers } from "../src/movements/movementCommands";
import { createMovementStore, type MovementRecent, type MovementStore } from "../src/movements/movementStore";

/** The stores a screen test renders against; the mocked `useConsumption` and `useMovements` read them from here. */
export const stockHarness = {
  usage: null as unknown as ConsumptionStore,
  moves: null as unknown as MovementStore,
  usageSource: null as unknown as IngredientSource,
  movesSource: null as unknown as IngredientSource,
  outbox: null as unknown as Outbox,
};

/** 2026-11-23 10:00 in the phone's own zone, so "today" is the same wherever the test runs. */
export const NOW = new Date(2026, 10, 23, 10, 0).getTime();

export const serverUsage = (over: Partial<ConsumptionEntry> = {}): ConsumptionEntry => ({ consumptionLogId: "c1", ingredientId: "i1", ingredientName: "Gin", quantity: 0.7, unit: "L", reason: "foh_operations", notes: null, shift: "evening", loggedAt: new Date(NOW - 3600_000).toISOString(), userId: 1, userName: "Cook", ...over });
export const serverMove = (over: Partial<StockMovement> = {}): StockMovement => ({ stockMovementId: "m1", ingredientId: "i1", ingredientName: "Gin", quantity: 2, unit: "bottle", fromAreaName: "Stock Room", toAreaName: "Bar", userName: "Sam", notes: null, movedAt: new Date(NOW - 3600_000).toISOString(), ...over });
export const AREAS: StorageArea[] = [{ storageAreaId: "a1", areaName: "Stock Room" }, { storageAreaId: "a2", areaName: "Bar" }, { storageAreaId: "a3", areaName: "Cool Room" }];
export const CATALOGUE = [
  { ingredientId: "i1", ingredientName: "Gin", baseUnit: "L", ingredientCategory: "Spirits", itemType: "KITCHEN_INGREDIENT" },
  { ingredientId: "i2", ingredientName: "Napkins", baseUnit: "each", ingredientCategory: "Supplies", itemType: "OPERATIONAL_SUPPLY" },
  { ingredientId: "i3", ingredientName: "Salt", baseUnit: "kg", ingredientCategory: "Dry", itemType: "KITCHEN_INGREDIENT" },
];

interface Over {
  usageOnServer?: ConsumptionEntry[];
  movesOnServer?: StockMovement[];
  areas?: StorageArea[];
  send?: ReturnType<typeof vi.fn>;
  listFails?: ApiError;
  isAdmin?: boolean;
}

export async function makeStockHarness(over: Over = {}) {
  const rows = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  const request = over.send ?? vi.fn(async () => ({}));
  let n = 0;
  const client = { request } as unknown as ApiClient;
  const outbox = createOutbox({ store, send: async () => {}, handlers: [...consumptionHandlers(client), ...movementHandlers(client)], now: () => NOW, newId: () => `e${String(++n).padStart(3, "0")}`, getUserId: () => 1 });
  const kvMap = new Map<string, string>();
  const kv: KvStore = { get: async (k) => kvMap.get(k) ?? null, set: async (k, v) => void kvMap.set(k, v), delete: async (k) => void kvMap.delete(k) };
  const fail = () => { if (over.listFails) throw over.listFails; };
  let uuid = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`;
  const kick = vi.fn();
  const catalogue = { items: async () => CATALOGUE };

  const usageRecents = createRecents<ConsumptionRecent>({ kv, key: "usage.recents", max: 12 });
  const usage = createConsumptionStore({ api: { list: vi.fn(async () => { fail(); return over.usageOnServer ?? []; }) } as unknown as ConsumptionApi, kv, outbox, recents: usageRecents, viewer: { userId: 1, userName: "Cook", isAdmin: over.isAdmin ?? false }, locationId: "L1", kick, now: () => NOW, newId });
  const moveRecents = createRecents<MovementRecent>({ kv, key: "moves.recents", max: 12 });
  const moves = createMovementStore({ api: { areas: vi.fn(async () => { fail(); return over.areas ?? AREAS; }), list: vi.fn(async () => { fail(); return over.movesOnServer ?? []; }) } as unknown as MovementApi, kv, outbox, recents: moveRecents, userId: 1, userName: "Cook", locationId: "L1", kick, now: () => NOW, newId });
  await Promise.all([usage.refresh(), moves.refresh()]);

  Object.assign(stockHarness, { usage, moves, outbox, usageSource: createIngredientSource({ catalogue, recents: usageRecents }), movesSource: createIngredientSource({ catalogue, recents: moveRecents }) });
  return { usage, moves, outbox, request, kick, rows };
}

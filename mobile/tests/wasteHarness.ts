import { vi } from "vitest";
import type { WasteEntry } from "@culinaire/shared/schemas/waste";
import { ApiError, type ApiClient } from "../src/api/client";
import { createOutbox, type Outbox, type OutboxEntry, type OutboxStore } from "../src/outbox/outbox";
import { createRecents } from "../src/ingredients/recents";
import { createIngredientSource, type IngredientSource } from "../src/ingredients/source";
import type { KvStore } from "../src/storage/kv";
import type { WasteApi } from "../src/waste/wasteApi";
import { wasteHandlers } from "../src/waste/wasteCommands";
import { createWasteStore, type WasteRecent, type WasteStore } from "../src/waste/wasteStore";

/** The one waste store a screen test renders against; the mocked `useWaste` reads it from here. */
export const wasteHarness = { store: null as unknown as WasteStore, source: null as unknown as IngredientSource, outbox: null as unknown as Outbox };

/** 2026-11-23 10:00 in the phone's own zone, so "today" is the same wherever the test runs. */
export const NOW = new Date(2026, 10, 23, 10, 0).getTime();

export const serverEntry = (over: Partial<WasteEntry> = {}): WasteEntry => ({ wasteLogId: "w1", userId: 1, storeLocationId: "L1", ingredientName: "Basil", quantity: 1, unit: "bunch", estimatedCost: null, reason: "Spoilage", notes: null, shift: "Lunch", loggedAt: new Date(NOW - 3600_000).toISOString(), loggedBy: "Rob", ...over });

export async function makeWasteHarness(over: { onServer?: WasteEntry[]; send?: ReturnType<typeof vi.fn>; catalogue?: Array<{ ingredientId: string; ingredientName: string; baseUnit: string; ingredientCategory: string }>; moreNames?: (q: string) => Promise<string[]>; listFails?: ApiError } = {}) {
  const rows = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  const request = over.send ?? vi.fn(async () => ({}));
  let n = 0;
  const outbox = createOutbox({ store, send: async () => {}, handlers: wasteHandlers({ request } as unknown as ApiClient), now: () => NOW, newId: () => `e${String(++n).padStart(3, "0")}`, getUserId: () => 1 });
  const kvMap = new Map<string, string>();
  const kv: KvStore = { get: async (k) => kvMap.get(k) ?? null, set: async (k, v) => void kvMap.set(k, v), delete: async (k) => void kvMap.delete(k) };
  const api = { list: vi.fn(async () => { if (over.listFails) throw over.listFails; return over.onServer ?? []; }), suggestions: vi.fn(async () => []) } as unknown as WasteApi;
  const recents = createRecents<WasteRecent>({ kv, key: "recents", max: 12 });
  let uuid = 0;
  const kick = vi.fn();
  const waste = createWasteStore({ api, kv, outbox, recents, getUserId: () => 1, locationId: "L1", kick, now: () => NOW, newId: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}` });
  await waste.refresh();
  wasteHarness.store = waste;
  wasteHarness.outbox = outbox;
  wasteHarness.source = createIngredientSource({ catalogue: { items: async () => over.catalogue ?? [] }, recents, moreNames: over.moreNames });
  return { waste, outbox, request, kick, recents, rows };
}

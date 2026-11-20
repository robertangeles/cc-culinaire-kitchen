import { vi } from "vitest";
import { createCountStore, type CountStore } from "../src/count/countStore";
import { createOutbox, type Outbox, type OutboxEntry, type OutboxStore } from "../src/outbox/outbox";
import type { ActiveSession, AreaSheet, CountApi } from "../src/count/countApi";
import type { KvStore } from "../src/storage/kv";

/** The one count store a screen test renders against; the mocked `useCount` reads it from here. */
export const harness = { store: null as unknown as CountStore, outbox: null as unknown as Outbox };

const cat = (name: string, over: object = {}) => ({ categoryId: `c-${name}`, categoryName: name, categoryStatus: "IN_PROGRESS", claimedByUserId: 1, claimedByUserName: "Chef", claimRevision: 2, ...over });

export const barSheet: AreaSheet = {
  categoryId: "c-Bar",
  categoryName: "Bar",
  items: [
    { ingredientId: "i1", ingredientName: "Shiraz", countUnit: "kg", alsoIn: ["Stock Room"] },
    { ingredientId: "i2", ingredientName: "Gin", countUnit: "L", alsoIn: [] },
  ],
};

export async function makeHarness(over: { api?: Partial<Record<keyof CountApi, ReturnType<typeof vi.fn>>>; session?: Partial<ActiveSession>; sendFails?: Error } = {}) {
  const session: ActiveSession = { sessionId: "S1", sessionStatus: "OPEN", countMode: "AREA", locationName: "Main", categories: [cat("Bar"), cat("Kitchen", { categoryStatus: "NOT_STARTED", claimedByUserId: null, claimedByUserName: null, claimRevision: 0 })], ...over.session };
  const api = {
    activeSession: vi.fn(async () => session),
    countSheets: vi.fn(async () => [barSheet, { categoryId: "c-Kitchen", categoryName: "Kitchen", items: [{ ingredientId: "i3", ingredientName: "Flour", countUnit: "kg", alsoIn: [] }] }]),
    areaLines: vi.fn(async () => []),
    claimArea: vi.fn(async () => ({ status: "claimed" as const, categoryId: "c-Kitchen", claimRevision: 1 })),
    submitArea: vi.fn(async () => ({ ok: true as const })),
    ...over.api,
  };
  const kvMap = new Map<string, string>();
  const kv: KvStore = { get: async (k) => kvMap.get(k) ?? null, set: async (k, v) => void kvMap.set(k, v), delete: async (k) => void kvMap.delete(k) };
  const rows = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  let n = 0;
  const send = vi.fn(async () => { if (over.sendFails) throw over.sendFails; });
  const outbox = createOutbox({ store, send, now: () => 1000 + n, newId: () => `e${String(++n).padStart(3, "0")}`, getUserId: () => 1 });
  const counts = createCountStore({ api: api as unknown as CountApi, kv, outbox, getUserId: () => 1, locationId: "L1", kick: () => {} });
  await counts.refresh();
  harness.store = counts;
  harness.outbox = outbox;
  return { counts, outbox, api, send, rows };
}

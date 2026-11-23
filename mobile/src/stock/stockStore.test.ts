import { describe, it, expect, vi } from "vitest";
import type { LocationDashboard, LocationItem } from "@culinaire/shared/schemas/storeRoom";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../outbox/outbox";
import { ApiError, type ApiClient } from "../api/client";
import type { KvStore } from "../storage/kv";
import { catalogRequestHandlers } from "./catalogRequestCommands";
import type { StockApi } from "./stockApi";
import { createStockStore } from "./stockStore";

const NOW = Date.UTC(2026, 10, 23, 1);
const dashboard: LocationDashboard = { stockLevels: [], stockSummary: { lowCount: 0, criticalCount: 1, lowIngredientIds: [], criticalIngredientIds: ["i1"] }, activeSession: null, lastCompletedSession: null };
const items: LocationItem[] = [{ ingredientId: "i1", ingredientName: "Salt", ingredientCategory: "dry_goods", itemType: "KITCHEN_INGREDIENT", baseUnit: "kg", parLevel: 10, activeInd: true, currentQty: 1, lastCountedDttm: null, supplierName: null }];

function setup(over: { fail?: ApiError; canSeeQty?: boolean; send?: ReturnType<typeof vi.fn> } = {}) {
  const rows = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt), put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  const send = over.send ?? vi.fn(async () => ({}));
  let n = 0;
  const outbox = createOutbox({ store, send: async () => {}, handlers: catalogRequestHandlers({ request: send } as unknown as ApiClient), now: () => NOW + n, newId: () => `e${++n}`, getUserId: () => 1 });
  const kvMap = new Map<string, string>();
  const kv: KvStore = { get: async (k) => kvMap.get(k) ?? null, set: async (k, v) => void kvMap.set(k, v), delete: async (k) => void kvMap.delete(k) };
  const fail = <T>(v: T) => async () => { if (over.fail) throw over.fail; return v; };
  const api = { dashboard: vi.fn(fail(dashboard)), items: vi.fn(fail(items)), areas: vi.fn(fail([{ storageAreaId: "a1", areaName: "Dry Store" }])), assignments: vi.fn(fail({ i1: ["a1"] })), elsewhere: vi.fn(async () => [{ storeLocationId: "L2", locationName: "Bar", currentQty: 4, parLevel: 6 }]) } as unknown as StockApi;
  let id = 0;
  const kick = vi.fn();
  const catalogue = { items: async () => [{ ingredientId: "i1", ingredientName: "Salt", baseUnit: "kg", ingredientCategory: "dry_goods" }, { ingredientId: "i7", ingredientName: "Yuzu", baseUnit: "L", ingredientCategory: "beverages", itemType: "KITCHEN_INGREDIENT" }], refresh: vi.fn(async () => true) };
  const make = () => createStockStore({ api, catalogue, kv, outbox, userId: 1, locationId: "L1", canSeeQty: over.canSeeQty ?? true, kick, now: () => NOW, newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}` });
  return { make, api, over, kvMap, outbox, send, kick, rows: () => [...rows.values()] };
}

describe("stock store", () => {
  it("downloads the dashboard, items and areas and keeps them on the phone with the time", async () => {
    const t = setup();
    const s = t.make();
    await s.refresh();
    expect(s.getSnapshot()).toMatchObject({ phase: "ready", offline: false, dashboard, areas: [{ areaName: "Dry Store" }], assignments: { i1: ["a1"] }, savedAt: NOW });
    expect(t.kvMap.has("stock.1.L1")).toBe(true);
  });

  it("adds the catalogue's items that are not active here (the location's list holds only active ones), with no quantity", async () => {
    const s = setup().make();
    await s.refresh();
    expect(s.getSnapshot().items).toEqual([...items, { ingredientId: "i7", ingredientName: "Yuzu", ingredientCategory: "beverages", itemType: "KITCHEN_INGREDIENT", baseUnit: "L", parLevel: null, activeInd: false, lastCountedDttm: null, supplierName: null }]);
  });

  it("shows the last download, with its time, when there is no signal", async () => {
    const t = setup();
    await t.make().refresh();
    t.over.fail = new ApiError("network");
    const s = t.make();
    await s.refresh();
    expect(s.getSnapshot()).toMatchObject({ phase: "ready", offline: true, dashboard, savedAt: NOW });
  });

  it("has no figures when nothing was downloaded yet and there is no signal, but still offers the catalogue kept for the picker", async () => {
    const s = setup({ fail: new ApiError("network") }).make();
    await s.refresh();
    expect(s.getSnapshot()).toMatchObject({ phase: "ready", offline: true, dashboard: null, savedAt: null });
    expect(s.getSnapshot().items.map((i) => [i.ingredientName, i.activeInd, i.currentQty])).toEqual([["Salt", false, undefined], ["Yuzu", false, undefined]]);
  });

  it("shows the server's refusal in its words", async () => {
    const s = setup({ fail: new ApiError("forbidden", "You do not have access to this location", 403) }).make();
    await s.refresh();
    expect(s.getSnapshot()).toMatchObject({ phase: "error", error: "You do not have access to this location" });
  });

  it("reads other locations' stock, a dash for a quantity this person may not see (the route does not hide it)", async () => {
    expect(await setup().make().elsewhere("i1")).toEqual([{ storeLocationId: "L2", locationName: "Bar", currentQty: 4, parLevel: 6 }]);
    expect(await setup({ canSeeQty: false }).make().elsewhere("i1")).toEqual([{ storeLocationId: "L2", locationName: "Bar", currentQty: undefined, parLevel: 6 }]);
  });
});

describe("catalogue requests from the phone", () => {
  it("queues a request with a phone-made id and lists it as mine, newest first, with whether it is sent", async () => {
    const t = setup();
    const s = t.make();
    await s.refresh();
    await s.request({ itemName: "  Yuzu juice ", itemType: "KITCHEN_INGREDIENT", category: "beverages", baseUnit: "L", countedQty: "2" });
    expect(t.kick).toHaveBeenCalled();
    expect(s.getSnapshot().requests).toEqual([expect.objectContaining({ itemName: "Yuzu juice", countedQty: 2, state: "waiting", requestId: "00000000-0000-4000-8000-000000000001" })]);
    await t.outbox.drain();
    await s.request({ itemName: "Shiso", itemType: null, category: null, baseUnit: null, countedQty: "" });
    expect(s.getSnapshot().requests.map((r) => [r.itemName, r.state])).toEqual([["Shiso", "waiting"], ["Yuzu juice", "sent"]]);
  });

  it("keeps a refused request on the list with the server's words, and a discarded one as discarded", async () => {
    const t = setup({ send: vi.fn(async () => { throw new ApiError("forbidden", "You do not have access to this location", 403, undefined, "LOCATION_NOT_ALLOWED"); }) });
    const s = t.make();
    await s.refresh();
    await s.request({ itemName: "Yuzu", itemType: null, category: null, baseUnit: null, countedQty: "" });
    await t.outbox.drain();
    await vi.waitFor(() => expect(s.getSnapshot().requests[0]).toMatchObject({ state: "attention", attentionMessage: "You do not have access to this location" }));
    await s.discard(s.getSnapshot().requests[0].entryId!);
    await vi.waitFor(() => expect(s.getSnapshot().requests[0].state).toBe("discarded"));
  });

  it("refuses on the phone what the server would refuse", async () => {
    const s = setup().make();
    const ask = (over: Record<string, unknown>) => s.request({ itemName: "Yuzu", itemType: null, category: null, baseUnit: null, countedQty: "", ...over });
    await expect(ask({ itemName: " " })).rejects.toThrow("Give the item a name.");
    await expect(ask({ itemName: "x".repeat(201) })).rejects.toThrow("The name is too long.");
    await expect(ask({ countedQty: "-1" })).rejects.toThrow("Enter how many you have: 0 or more.");
    await expect(ask({ countedQty: "100000" })).rejects.toThrow("Enter how many you have: 0 or more.");
    await expect(ask({ baseUnit: "x".repeat(21) })).rejects.toThrow("The unit is too long.");
  });
});

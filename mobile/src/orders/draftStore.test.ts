import { describe, it, expect, vi } from "vitest";
import { OrderGuideItemSchema, OrderItemSchema, OrderSummarySchema, type OrderSummary } from "@culinaire/shared/schemas/purchasing";
import type { KvStore } from "../storage/kv";
import { ApiError } from "../api/client";
import { createDraftStore } from "./draftStore";
import type { OrdersApi } from "./ordersApi";

const memoryKv = (): KvStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
};
const flour = OrderItemSchema.parse({ ingredientId: "i1", ingredientName: "Flour", baseUnit: "kg", purchaseUnit: "bag", packQty: "12.5", orgUnitCost: "1.40" });
const gin = OrderItemSchema.parse({ ingredientId: "i2", ingredientName: "Gin", baseUnit: "bottle" });
const farms = { supplierId: "s1", supplierName: "Fresh Farms" };
const order = (over: object = {}): OrderSummary => OrderSummarySchema.parse({ poId: "new", poNumber: "PO-9", status: "DRAFT", storeLocationId: "L1", supplierId: "s1", createdByUserId: 7, lineCount: 1, ...over });

function setup(over: Partial<Record<keyof OrdersApi, unknown>> = {}, kv = memoryKv()) {
  const api = {
    suppliers: vi.fn(async () => [{ supplierId: "s2", supplierName: "Wine Co" }, farms]),
    items: vi.fn(async () => [flour, gin]),
    guides: vi.fn(async () => [{ orderGuideId: "g1", name: "Weekly dry", supplierId: "s1", supplierName: "Fresh Farms", itemCount: 1 }]),
    guideItems: vi.fn(async () => [OrderGuideItemSchema.parse({ ingredientId: "i1", ingredientName: "Flour", baseUnit: "kg", purchaseUnit: "bag", suggestedPackages: 2, unitCost: 1.4, packUnitCost: 17.5 })]),
    supplierItemIds: vi.fn(async () => ["i1"]),
    list: vi.fn(async () => [] as OrderSummary[]),
    create: vi.fn(async () => ({ poId: "new", poNumber: "PO-9", skippedItems: [] })),
    submit: vi.fn(async () => ({ poId: "new", status: "SENT" })),
    ...over,
  };
  return { api, kv, store: createDraftStore({ api: api as unknown as OrdersApi, kv, key: "d", locationId: "L1", userId: 7, guidesAllowed: true }) };
}
async function written(over: Parameters<typeof setup>[0] = {}, kv = memoryKv()) {
  const s = setup(over, kv);
  await s.store.load();
  s.store.chooseSupplier(farms);
  s.store.add("i1");
  return s;
}
const lost = new ApiError("timeout");

describe("writing an order", () => {
  it("loads what it needs, suppliers by name", async () => {
    const { store } = setup();
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ phase: "ready" });
    expect(store.getSnapshot().suppliers.map((s) => s.supplierName)).toEqual(["Fresh Farms", "Wine Co"]);
  });

  it("says so when there is no connection, and still has the unfinished order", async () => {
    const { kv } = await written();
    await new Promise((r) => setTimeout(r));
    const { store } = setup({ items: async () => { throw new ApiError("network"); } }, kv);
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ phase: "error", error: "Can't reach the server. Try again." });
    expect(store.getSnapshot().draft.lines).toHaveLength(1);
  });

  it("is still there after the app is closed, and a damaged note is an empty order", async () => {
    const { kv, store } = await written();
    store.update({ notes: "Back door" });
    await new Promise((r) => setTimeout(r));
    const again = setup({}, kv).store;
    await again.restore();
    expect(again.getSnapshot().draft).toMatchObject({ supplierId: "s1", notes: "Back door", lines: [{ ingredientId: "i1", qty: "1", unit: "bag", cost: "17.5" }] });
    kv.data.set("d", "{oops");
    const damaged = setup({}, kv).store;
    await damaged.restore();
    expect(damaged.getSnapshot().draft.lines).toEqual([]);
  });

  it("does without guides when the server refuses them, and never asks for them without the permission", async () => {
    const { store } = setup({ guides: async () => { throw new ApiError("forbidden", "no", 403); } });
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ phase: "ready", guides: [] });
    const api = setup().api;
    const noKey = createDraftStore({ api: api as unknown as OrdersApi, kv: memoryKv(), key: "d", locationId: "L1", userId: 7, guidesAllowed: false });
    await noKey.load();
    expect(api.guides).not.toHaveBeenCalled();
  });

  it("fills from a guide to par, with its supplier", async () => {
    const { store, api } = setup();
    await store.load();
    await store.applyGuide(store.getSnapshot().guides[0]);
    expect(api.guideItems).toHaveBeenCalledWith("g1", "L1");
    expect(store.getSnapshot().draft).toMatchObject({ supplierId: "s1", guideId: "g1", lines: [{ qty: "2", unit: "bag", cost: "17.5" }] });
  });

  it("searches what the supplier sells, less what is already on the order; every item when none is linked to the supplier", async () => {
    const { store } = setup();
    await store.load();
    store.chooseSupplier(farms);
    await new Promise((r) => setTimeout(r));
    expect((await store.source.search("fl")).map((p) => [p.name, p.unit])).toEqual([["Flour", "bag"]]);
    expect(await store.source.search("gin")).toEqual([]);
    store.add("i1");
    expect(await store.source.search("fl")).toEqual([]);
    const none = setup({ supplierItemIds: async () => [] }).store;
    await none.load();
    none.chooseSupplier(farms);
    await new Promise((r) => setTimeout(r));
    expect(await none.source.search("gin")).toHaveLength(1);
  });

  it("adds an item once", async () => {
    const { store } = await written();
    store.add("i1");
    expect(store.getSnapshot().draft.lines).toHaveLength(1);
  });
});

describe("saving an order", () => {
  it("as a draft sends it once and clears the phone's copy", async () => {
    const { store, api, kv } = await written();
    expect(await store.save(false)).toEqual({ poId: "new", notSubmitted: null });
    expect(api.create).toHaveBeenCalledWith({ storeLocationId: "L1", supplierId: "s1", lines: [{ ingredientId: "i1", orderedQty: "1", orderedUnit: "bag", unitCost: "17.5" }] });
    expect(api.submit).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r));
    expect(JSON.parse(kv.data.get("d")!).lines).toEqual([]);
  });

  it("stops at what is missing, without a call", async () => {
    const { store, api } = setup();
    await store.load();
    expect(await store.save(true)).toBeNull();
    expect(store.getSnapshot().saveError).toBe("Choose a supplier.");
    expect(api.list).not.toHaveBeenCalled();
  });

  it("and submitting: a submit that fails leaves one saved draft, not an order to save again", async () => {
    const { store, api } = await written({ submit: vi.fn(async () => { throw new ApiError("network"); }) });
    expect(await store.save(true)).toEqual({ poId: "new", notSubmitted: "Saved, but not submitted. Can't reach the server. Submitting an order needs a connection." });
    expect(store.getSnapshot().draft.lines).toEqual([]);
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it("with no signal keeps the order on the phone and says it needs a connection", async () => {
    const { store, api } = await written({ list: vi.fn(async () => { throw new ApiError("network"); }) });
    expect(await store.save(true)).toBeNull();
    expect(store.getSnapshot()).toMatchObject({ saving: false });
    expect(store.getSnapshot().saveError).toMatch(/^Can't reach the server\. Saving an order needs a connection\./);
    expect(store.getSnapshot().draft.lines).toHaveLength(1);
    expect(api.create).not.toHaveBeenCalled();
  });

  it("whose answer was lost finds the order on the server instead of making a second", async () => {
    const list = vi.fn().mockResolvedValueOnce([order({ poId: "older" })]).mockResolvedValueOnce([order(), order({ poId: "older" })]);
    const { store, api } = await written({ list, create: vi.fn(async () => { throw lost; }) });
    expect(await store.save(false)).toEqual({ poId: "new", notSubmitted: null });
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it("whose answer was lost, with the server still out of reach, looks first on the next try, also after a restart", async () => {
    const list = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new ApiError("network"));
    const { store, kv } = await written({ list, create: vi.fn(async () => { throw lost; }) });
    expect(await store.save(false)).toBeNull();
    expect(store.getSnapshot().saveError).toContain("saving again first checks");
    await new Promise((r) => setTimeout(r));
    const later = setup({ list: vi.fn(async () => [order()]) }, kv);
    await later.store.load();
    expect(await later.store.save(false)).toEqual({ poId: "new", notSubmitted: null });
    expect(later.api.create).not.toHaveBeenCalled();
  });

  it("does not take someone else's draft, another supplier's or another length for its own", async () => {
    const others = [order({ poId: "a", createdByUserId: 8 }), order({ poId: "b", supplierId: "s2" }), order({ poId: "c", lineCount: 2 })];
    const list = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(others).mockResolvedValue(others);
    const create = vi.fn().mockRejectedValueOnce(lost).mockResolvedValueOnce({ poId: "second", poNumber: "PO-10", skippedItems: [] });
    const { store } = await written({ list, create });
    expect(await store.save(false)).toBeNull();
    expect(await store.save(false)).toEqual({ poId: "second", notSubmitted: null });
  });

  it("changed after a lost save that did land says so instead of saving both", async () => {
    const list = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new ApiError("network")).mockResolvedValue([order()]);
    const { store, api } = await written({ list, create: vi.fn(async () => { throw lost; }) });
    await store.save(false);
    store.setLine({ ...store.getSnapshot().draft.lines[0], qty: "9" });
    expect(await store.save(false)).toBeNull();
    expect(store.getSnapshot().saveError).toMatch(/saved before you changed it/);
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it("refused by the server shows its reason and keeps the order", async () => {
    const { store } = await written({ create: vi.fn(async () => { throw new ApiError("bad_request", "Supplier not found", 400); }) });
    expect(await store.save(false)).toBeNull();
    expect(store.getSnapshot().saveError).toBe("Supplier not found");
    expect(store.getSnapshot().draft.pending).toBeNull();
  });
});

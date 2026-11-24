import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrderDetailSchema, OrderGuideItemSchema, OrderItemSchema } from "@culinaire/shared/schemas/purchasing";
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
let ids = 0;
beforeEach(() => void (ids = 0));
/** A draft the server has, raised for another location. */
const saved = (over: object = {}) =>
  OrderDetailSchema.parse({ poId: "P1", poNumber: "PO-100", status: "DRAFT", storeLocationId: "L2", supplierId: "s1", supplierName: "Fresh Farms", notes: "Back door", expectedDeliveryDate: "2026-12-04T00:00:00.000Z", lines: [{ lineId: "l1", ingredientId: "i1", ingredientName: "Flour", orderedQty: "2.0000", orderedUnit: "bag", unitCost: "17.5000" }], ...over });

function setup(over: Partial<Record<keyof OrdersApi, unknown>> = {}, kv = memoryKv(), editing?: string) {
  const api = {
    detail: vi.fn(async () => saved()),
    update: vi.fn(async () => ({ poId: "P1", poNumber: "PO-100", skippedItems: [] })),
    suppliers: vi.fn(async () => [{ supplierId: "s2", supplierName: "Wine Co" }, farms]),
    items: vi.fn(async () => [flour, gin]),
    guides: vi.fn(async () => [{ orderGuideId: "g1", name: "Weekly dry", supplierId: "s1", supplierName: "Fresh Farms", itemCount: 1 }]),
    guideItems: vi.fn(async () => [OrderGuideItemSchema.parse({ ingredientId: "i1", ingredientName: "Flour", baseUnit: "kg", purchaseUnit: "bag", suggestedPackages: 2, unitCost: 1.4, packUnitCost: 17.5 })]),
    supplierItemIds: vi.fn(async () => ["i1"]),
    create: vi.fn(async () => ({ poId: "new", poNumber: "PO-9", skippedItems: [] })),
    submit: vi.fn(async () => ({ poId: "new", status: "SENT" })),
    ...over,
  };
  return { api, kv, store: createDraftStore({ api: api as unknown as OrdersApi, kv, key: "d", locationId: "L1", newId: () => "id-" + ++ids, guidesAllowed: true, editing }) };
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
    expect(store.getSnapshot()).toMatchObject({ phase: "error", error: "Can't reach the server. Writing an order needs a connection." });
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
    const noKey = createDraftStore({ api: api as unknown as OrdersApi, kv: memoryKv(), key: "d", locationId: "L1", newId: () => "x", guidesAllowed: false });
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
  const body = { storeLocationId: "L1", supplierId: "s1", lines: [{ ingredientId: "i1", orderedQty: "1", orderedUnit: "bag", unitCost: "17.5" }] };
  const conflict = new ApiError("conflict", "That id is already used by another purchase order", 409, undefined, "CONFLICT");

  it("as a draft sends it once, with an id made on the phone, and clears the phone's copy", async () => {
    const { store, api, kv } = await written();
    expect(await store.save(false)).toEqual({ poId: "new", notSubmitted: null });
    expect(api.create).toHaveBeenCalledWith({ ...body, poId: "id-1" });
    expect(api.submit).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r));
    expect(JSON.parse(kv.data.get("d")!)).toMatchObject({ lines: [], poId: null });
    // The next order is another one.
    store.chooseSupplier(farms);
    store.add("i1");
    await store.save(false);
    expect(api.create).toHaveBeenLastCalledWith({ ...body, poId: "id-2" });
  });

  it("stops at what is missing, without a call", async () => {
    const { store, api } = setup();
    await store.load();
    expect(await store.save(true)).toBeNull();
    expect(store.getSnapshot().saveError).toBe("Choose a supplier.");
    expect(api.create).not.toHaveBeenCalled();
  });

  it("and submitting: a submit that fails leaves one saved draft, not an order to save again", async () => {
    const { store, api } = await written({ submit: vi.fn(async () => { throw new ApiError("network"); }) });
    expect(await store.save(true)).toEqual({ poId: "new", notSubmitted: "Saved, but not submitted. Can't reach the server. Submitting an order needs a connection." });
    expect(store.getSnapshot().draft.lines).toEqual([]);
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it("again after a lost reply carries the same id and body, also after a restart, so the server answers the first order", async () => {
    const { store, api, kv } = await written({ create: vi.fn(async () => { throw lost; }) });
    expect(await store.save(false)).toBeNull();
    expect(store.getSnapshot()).toMatchObject({ saving: false, saveError: "The server took too long to answer. Your order is kept on this phone, and it is safe to save again: it can't be made twice." });
    expect(store.getSnapshot().draft.lines).toHaveLength(1);
    const later = setup({}, kv);
    await later.store.load();
    expect(await later.store.save(false)).toEqual({ poId: "new", notSubmitted: null });
    const calls = (f: unknown) => (f as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls(later.api.create)).toEqual(calls(api.create));
  });

  it("changed after a lost save that did land brings that order up to date instead of making a second", async () => {
    const create = vi.fn().mockRejectedValueOnce(lost).mockRejectedValueOnce(conflict);
    const { store, api } = await written({ create });
    await store.save(false);
    store.setLine({ ...store.getSnapshot().draft.lines[0], qty: "9" });
    expect(await store.save(false)).toEqual({ poId: "P1", notSubmitted: null });
    expect(api.update).toHaveBeenCalledWith("id-1", { ...body, lines: [{ ...body.lines[0], orderedQty: "9" }] });
  });

  it("and if someone has submitted that order by then, says so and keeps what was written", async () => {
    const create = vi.fn().mockRejectedValueOnce(lost).mockRejectedValueOnce(conflict);
    const update = vi.fn().mockRejectedValue(new ApiError("conflict", "Cannot edit PO with status SENT", 409, undefined, "INVALID_STATE"));
    const { store } = await written({ create, update });
    await store.save(false);
    store.update({ notes: "x" });
    expect(await store.save(false)).toBeNull();
    expect(store.getSnapshot().saveError).toMatch(/already saved and is no longer a draft/);
    expect(store.getSnapshot().draft.lines).toHaveLength(1);
  });

  it("refused by the server shows its reason and keeps the order", async () => {
    const { store } = await written({ create: vi.fn(async () => { throw new ApiError("bad_request", "Supplier not found", 400, undefined, "VALIDATION"); }) });
    expect(await store.save(false)).toBeNull();
    expect(store.getSnapshot().saveError).toBe("Supplier not found");
    expect(store.getSnapshot().draft.lines).toHaveLength(1);
  });

  it("once, however fast it is tapped", async () => {
    const { store, api } = await written();
    await Promise.all([store.save(false), store.save(false)]);
    expect(api.create).toHaveBeenCalledTimes(1);
  });
});

describe("changing a saved draft", () => {
  it("starts from what the server has, at the order's own location, and replaces it", async () => {
    const { store, api, kv } = setup({}, memoryKv(), "P1");
    await store.load();
    expect(api.items).toHaveBeenCalledWith("L2");
    expect(store.getSnapshot()).toMatchObject({ phase: "ready", draft: { supplierId: "s1", supplierName: "Fresh Farms", notes: "Back door", expectedDate: "2026-12-04", lines: [{ qty: "2", unit: "bag", cost: "17.5" }] } });
    store.setLine({ ...store.getSnapshot().draft.lines[0], qty: "3" });
    expect(await store.save(false)).toEqual({ poId: "P1", notSubmitted: null });
    expect(api.update).toHaveBeenCalledWith("P1", { storeLocationId: "L2", supplierId: "s1", lines: [{ ingredientId: "i1", orderedQty: "3", orderedUnit: "bag", unitCost: "17.5" }], notes: "Back door", expectedDeliveryDate: "2026-12-04" });
    expect(api.create).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r));
    expect(kv.data.size).toBe(0); // never over the new order being written on this phone
  });

  it("is refused before it starts when it is no longer a draft, and when it stops being one meanwhile", async () => {
    const gone = setup({ detail: vi.fn(async () => saved({ status: "SENT" })) }, memoryKv(), "P1").store;
    await gone.load();
    expect(gone.getSnapshot()).toMatchObject({ phase: "error", error: "This order is no longer a draft, so it can't be changed." });
    const { store } = setup({ update: vi.fn(async () => { throw new ApiError("conflict", "x", 409, undefined, "INVALID_STATE"); }) }, memoryKv(), "P1");
    await store.load();
    expect(await store.save(false)).toBeNull();
    expect(store.getSnapshot().saveError).toBe("This order is no longer a draft, so it can't be changed.");
  });

  it("keeps what was typed when the form is opened again, and after a save that did not go through", async () => {
    const { store, api } = setup({ update: vi.fn(async () => { throw new ApiError("network"); }) }, memoryKv(), "P1");
    await store.load();
    store.update({ notes: "Front door" });
    await store.load();
    expect(await store.save(false)).toBeNull();
    expect(store.getSnapshot().saveError).toBe("Can't reach the server. Saving an order needs a connection. It is safe to save again.");
    expect(store.getSnapshot().draft.notes).toBe("Front door");
    expect(api.detail).toHaveBeenCalledTimes(1);
  });

  it("and submitting it", async () => {
    const { store, api } = setup({}, memoryKv(), "P1");
    await store.load();
    expect(await store.save(true)).toEqual({ poId: "P1", notSubmitted: null });
    expect(api.submit).toHaveBeenCalledWith("P1");
  });
});

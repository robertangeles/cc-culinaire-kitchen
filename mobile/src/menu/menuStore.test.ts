import { describe, it, expect, vi } from "vitest";
import type { MenuItem, MenuLine, SaleResult } from "@culinaire/shared/schemas/menu";
import { ApiError } from "../api/client";
import type { KvStore } from "../storage/kv";
import type { MenuApi } from "./menuApi";
import { createMenuStore } from "./menuStore";

const NOW = Date.UTC(2026, 10, 25, 1);
const item = (over: Partial<MenuItem> = {}): MenuItem => ({
  menuItemId: "m1", userId: 4, name: "Margherita", category: "Pasta", sellingPrice: 24, servings: 1, servingsPerSale: 1, qFactorPct: 0, foodCost: 6.1, foodCostPct: 25.42, contributionMargin: 17.9, unitsSold: 12, classification: "star",
  containsDairyInd: true, containsGlutenInd: true, containsNutsInd: false, containsShellfishInd: false, containsEggsInd: false, isVegetarianInd: true, canManage: true, ...over,
});
const line: MenuLine = { id: 1, ingredientId: "i1", ingredientName: "Mozzarella", note: null, quantity: 0.12, unit: "kg", unitCost: 14, yieldPct: 100, lineCost: 1.68, costStaleInd: true, baseUnit: "kg", contentQty: null, contentUnit: null, densityGPerMl: null, purchaseUnit: null, packQty: null, catalogUnitCost: 14 };
const recorded: SaleResult = { saleId: "s1", alreadyExists: false, voided: false, depleted: [{ ingredientId: "i1", ingredientName: "Mozzarella", baseQty: 0.24, baseUnit: "kg", fohOnHand: 3 }], skipped: [], oversold: [] };
const dish = { kind: "dish" as const, id: "m1", name: "Margherita" };

function setup(over: { canSeeCost?: boolean; kvMap?: Map<string, string> } = {}) {
  const kvMap = over.kvMap ?? new Map<string, string>();
  const kv: KvStore = { get: async (k) => kvMap.get(k) ?? null, set: async (k, v) => void kvMap.set(k, v), delete: async (k) => void kvMap.delete(k) };
  const api = {
    items: vi.fn(async () => [item()]),
    targets: vi.fn(async () => ({ Pasta: 28 })),
    lines: vi.fn(async () => [line]),
    consumables: vi.fn(async () => [{ ingredientId: "c1", ingredientName: "Cola can", baseUnit: "each" }]),
    sell: vi.fn(async () => recorded),
    remove: vi.fn(async () => undefined),
    refreshCost: vi.fn(async () => undefined),
    setTarget: vi.fn(async () => undefined),
    sales: vi.fn(async () => []),
    voidSale: vi.fn(async () => undefined),
  };
  let id = 0;
  const make = () => createMenuStore({ api: api as unknown as MenuApi, kv, userId: 4, locationId: "L1", canSeeCost: over.canSeeCost ?? true, now: () => NOW, newId: () => `key${++id}` });
  return { make, api, kvMap };
}

describe("the menu list", () => {
  it("downloads the menu, the targets and the consumables and keeps them with the time", async () => {
    const t = setup();
    const s = t.make();
    await s.refresh();
    expect(s.getSnapshot()).toMatchObject({ phase: "ready", offline: false, savedAt: NOW, targets: { Pasta: 28 }, items: [{ name: "Margherita", foodCost: 6.1 }], consumables: [{ ingredientName: "Cola can" }] });
  });

  it("shows the last download when there is no signal, and nothing when there is none", async () => {
    const t = setup();
    await t.make().refresh();
    t.api.items.mockRejectedValue(new ApiError("network"));
    const s = t.make();
    await s.refresh();
    expect(s.getSnapshot()).toMatchObject({ phase: "ready", offline: true, savedAt: NOW, items: [{ name: "Margherita" }] });
    const none = setup();
    none.api.items.mockRejectedValue(new ApiError("timeout"));
    const empty = none.make();
    await empty.refresh();
    expect(empty.getSnapshot()).toMatchObject({ phase: "ready", offline: true, savedAt: null, items: [] });
  });

  it("shows the menu when only the targets or the consumables cannot be read", async () => {
    const t = setup();
    t.api.targets.mockRejectedValue(new ApiError("server"));
    t.api.consumables.mockRejectedValue(new ApiError("bad_request", "You are not a member of any organisation", 400));
    const s = t.make();
    await s.refresh();
    expect(s.getSnapshot()).toMatchObject({ phase: "ready", offline: false, items: [{ name: "Margherita" }], targets: {}, consumables: [] });
  });

  it("says a refusal in the server's words", async () => {
    const t = setup();
    t.api.items.mockRejectedValue(new ApiError("forbidden", "No access", 403));
    const s = t.make();
    await s.refresh();
    expect(s.getSnapshot()).toMatchObject({ phase: "error", error: "No access" });
  });

  it("drops every cost for someone without inventory:cost, whatever the server sent, also from what is kept on the phone", async () => {
    const t = setup({ canSeeCost: false });
    const s = t.make();
    await s.refresh();
    await s.loadLines("m1");
    expect(s.getSnapshot().items[0]).toMatchObject({ foodCost: undefined, foodCostPct: undefined, contributionMargin: undefined });
    expect(s.getSnapshot().lines.m1[0]).toMatchObject({ unitCost: undefined, lineCost: undefined, catalogUnitCost: undefined, costStaleInd: false });
    expect([...t.kvMap.values()].join()).not.toMatch(/6\.1|17\.9|1\.68/);
  });
});

describe("someone who may no longer see costs", () => {
  it("does not read them from what was kept on the phone while they could", async () => {
    const before = setup();
    const s = before.make();
    await s.refresh();
    await s.loadLines("m1");
    const after = setup({ canSeeCost: false, kvMap: before.kvMap });
    after.api.items.mockRejectedValue(new ApiError("network"));
    after.api.lines.mockRejectedValue(new ApiError("network"));
    const blind = after.make();
    await blind.refresh();
    await blind.loadLines("m1");
    expect(blind.getSnapshot().items[0]).toMatchObject({ name: "Margherita", foodCost: undefined, foodCostPct: undefined, contributionMargin: undefined });
    expect(blind.getSnapshot().lines.m1[0]).toMatchObject({ ingredientName: "Mozzarella", unitCost: undefined, lineCost: undefined, catalogUnitCost: undefined });
  });
});

describe("an item's lines", () => {
  it("are read when the item opens and kept for no signal", async () => {
    const t = setup();
    const s = t.make();
    await s.loadLines("m1");
    expect(s.getSnapshot().lines.m1).toEqual([line]);
    t.api.lines.mockRejectedValue(new ApiError("network"));
    const again = t.make();
    await again.loadLines("m1");
    expect(again.getSnapshot().lines.m1).toEqual([line]);
    expect(again.getSnapshot().linesError).toBeUndefined();
    await again.loadLines("m2");
    expect(again.getSnapshot().linesError).toMatch(/back online/);
  });

  it("are read again, with the item's stored costs, after a line's cost is refreshed", async () => {
    const t = setup();
    const s = t.make();
    await s.refreshCost("m1", 1);
    expect(t.api.refreshCost).toHaveBeenCalledWith("m1", 1);
    expect(t.api.lines).toHaveBeenCalled();
    expect(t.api.items).toHaveBeenCalled();
  });
});

describe("recording a sale", () => {
  it("sends one sale with its own key at this location, reads the menu again and forgets the key", async () => {
    const t = setup();
    const s = t.make();
    await expect(s.sell(dish, 2)).resolves.toEqual(recorded);
    expect(t.api.sell).toHaveBeenCalledWith({ key: "key1", target: dish, qty: 2, locationId: "L1" });
    expect(s.getSnapshot().pendingSale).toBeNull();
    await s.sell(dish, 2);
    expect(t.api.sell.mock.calls[1]).toEqual([expect.objectContaining({ key: "key2" })]);
  });

  it("keeps an unconfirmed sale, also over a restart, and sends the same one with the same key on Try again", async () => {
    const t = setup();
    t.api.sell.mockRejectedValueOnce(new ApiError("timeout"));
    await expect(t.make().sell(dish, 2)).rejects.toMatchObject({ code: "timeout" });
    const restarted = t.make();
    await restarted.refresh();
    expect(restarted.getSnapshot().pendingSale).toEqual({ key: "key1", target: dish, qty: 2, locationId: "L1" });
    t.api.sell.mockResolvedValueOnce({ ...recorded, alreadyExists: true });
    await expect(restarted.retrySale()).resolves.toMatchObject({ alreadyExists: true });
    expect(t.api.sell.mock.calls[1]).toEqual([{ key: "key1", target: dish, qty: 2, locationId: "L1" }]);
    expect(restarted.getSnapshot().pendingSale).toBeNull();
  });

  it("does not show a sale as unconfirmed again when a menu read started before it was confirmed ends after", async () => {
    const t = setup();
    const s = t.make();
    await s.refresh();
    let answer: (r: SaleResult) => void = () => {};
    t.api.sell.mockImplementationOnce(() => new Promise<SaleResult>((r) => (answer = r)));
    const selling = s.sell(dish, 2);
    await vi.waitFor(() => expect(s.getSnapshot().pendingSale).not.toBeNull());
    let items: (i: MenuItem[]) => void = () => {};
    t.api.items.mockImplementationOnce(() => new Promise<MenuItem[]>((r) => (items = r)));
    const reading = s.refresh();
    answer(recorded);
    await selling;
    items([item()]);
    await reading;
    expect(s.getSnapshot().pendingSale).toBeNull();
  });

  it("does not start a sale over one left unconfirmed before a restart, even before the menu is read", async () => {
    const t = setup();
    t.api.sell.mockRejectedValueOnce(new ApiError("timeout"));
    await expect(t.make().sell(dish, 2)).rejects.toMatchObject({ code: "timeout" });
    await expect(t.make().sell(dish, 2)).rejects.toThrow(/not confirmed/);
  });

  it("saves the sale on the phone before it is sent, so the app closing mid-send cannot lose the key", async () => {
    const t = setup();
    let onPhone = "";
    t.api.sell.mockImplementationOnce(async () => {
      onPhone = [...t.kvMap.values()].join();
      return recorded;
    });
    await t.make().sell(dish, 2);
    expect(onPhone).toContain("key1");
  });

  it("forgets a sale the server refused: nothing was recorded, so a corrected one gets a new key", async () => {
    const t = setup();
    t.api.sell.mockRejectedValueOnce(new ApiError("bad_request", "qtySold can have at most 3 decimal places", 400, undefined, "VALIDATION"));
    const s = t.make();
    await expect(s.sell(dish, 2)).rejects.toThrow("3 decimal places");
    expect(s.getSnapshot().pendingSale).toBeNull();
    // A second sale is not started over an unconfirmed one.
    t.api.sell.mockRejectedValueOnce(new ApiError("network"));
    await expect(s.sell(dish, 2)).rejects.toMatchObject({ code: "network" });
    await expect(s.sell(dish, 3)).rejects.toThrow(/not confirmed/);
    await s.forgetSale();
    expect(s.getSnapshot().pendingSale).toBeNull();
  });

  it("keeps the key when sending again is refused: the first try may be recorded, so only an answer or the person settles it", async () => {
    const t = setup();
    const s = t.make();
    t.api.sell.mockRejectedValueOnce(new ApiError("timeout"));
    await expect(s.sell(dish, 2)).rejects.toMatchObject({ code: "timeout" });
    for (const refusal of [new ApiError("rate_limited"), new ApiError("unauthorized"), new ApiError("forbidden", "Not your location", 403)]) {
      t.api.sell.mockRejectedValueOnce(refusal);
      await expect(s.retrySale()).rejects.toBe(refusal);
      expect(s.getSnapshot().pendingSale).toMatchObject({ key: "key1" });
    }
    const restarted = t.make();
    await restarted.refresh();
    t.api.sell.mockRejectedValueOnce(new ApiError("rate_limited"));
    await expect(restarted.retrySale()).rejects.toMatchObject({ code: "rate_limited" });
    expect(restarted.getSnapshot().pendingSale).toMatchObject({ key: "key1" });
  });

  it("sends one sale when the button is pressed twice, and does not forget a sale that is being sent", async () => {
    const t = setup();
    const s = t.make();
    const [first, second] = await Promise.allSettled([s.sell(dish, 2), s.sell(dish, 2)]);
    expect([first.status, second.status]).toEqual(["fulfilled", "rejected"]);
    expect(t.api.sell).toHaveBeenCalledTimes(1);

    t.api.sell.mockRejectedValueOnce(new ApiError("timeout"));
    await expect(s.sell(dish, 1)).rejects.toMatchObject({ code: "timeout" });
    const [again, twice, forgotten] = await Promise.allSettled([s.retrySale(), s.retrySale(), s.forgetSale()]);
    expect([again.status, twice.status, forgotten.status]).toEqual(["fulfilled", "rejected", "rejected"]);
    expect(t.api.sell).toHaveBeenCalledTimes(3);
  });

  it("reads a sale left before a restart once, for a sale pressed while the menu is still being read too", async () => {
    const t = setup();
    t.api.sell.mockRejectedValueOnce(new ApiError("timeout"));
    await expect(t.make().sell(dish, 2)).rejects.toMatchObject({ code: "timeout" });
    const s = t.make();
    const reading = s.refresh();
    await expect(s.sell(dish, 5)).rejects.toThrow(/not confirmed/);
    await reading;
    expect(t.api.sell).toHaveBeenCalledTimes(1);
  });

  it("refuses a quantity the server would: none, zero, more than three decimals", async () => {
    const s = setup().make();
    for (const qty of [Number.NaN, 0, -1, 1.2345, 1e7]) await expect(s.sell(dish, qty)).rejects.toThrow(/how many/i);
  });

  it("hides what is left on hand from someone without inventory:cost", async () => {
    const s = setup({ canSeeCost: false }).make();
    const result = await s.sell(dish, 2);
    expect(result.depleted).toEqual([{ ingredientId: "i1", ingredientName: "Mozzarella", baseQty: 0.24, baseUnit: "kg" }]);
  });
});

describe("other writes", () => {
  it("removes an item from the list after the server did, and keeps it when the server refused", async () => {
    const t = setup();
    const s = t.make();
    await s.refresh();
    t.api.remove.mockRejectedValueOnce(new ApiError("conflict", "This menu item has recorded sales", 409, undefined, "CONFLICT"));
    await expect(s.remove("m1")).rejects.toThrow("recorded sales");
    t.api.items.mockResolvedValue([]);
    await s.remove("m1");
    expect(s.getSnapshot().items).toEqual([]);
  });

  it("counts an item already gone as removed", async () => {
    const t = setup();
    t.api.remove.mockRejectedValueOnce(new ApiError("not_found", "Item not found", 404, undefined, "NOT_FOUND"));
    await expect(t.make().remove("m1")).resolves.toBeUndefined();
  });

  it("saves a category's target and shows it at once; refuses one out of range", async () => {
    const t = setup();
    const s = t.make();
    await s.refresh();
    await s.setTarget("Pasta", "32,5");
    expect(t.api.setTarget).toHaveBeenCalledWith("Pasta", "32.5");
    expect(s.getSnapshot().targets).toEqual({ Pasta: 32.5 });
    for (const bad of ["", "x", "0", "101", "1.234"]) await expect(s.setTarget("Pasta", bad)).rejects.toThrow(/1 to 100|above 0/);
  });

  it("voids a sale, counts one already voided as done, and reads the menu again", async () => {
    const t = setup();
    const s = t.make();
    await s.voidSale("s1");
    expect(t.api.items).toHaveBeenCalled();
    t.api.voidSale.mockRejectedValueOnce(new ApiError("conflict", "Sale is already voided", 409, undefined, "INVALID_STATE"));
    await expect(s.voidSale("s1")).resolves.toBeUndefined();
    t.api.voidSale.mockRejectedValueOnce(new ApiError("forbidden", "Only the person who recorded this sale", 403, undefined, "FORBIDDEN"));
    await expect(s.voidSale("s1")).rejects.toThrow("Only the person");
  });
});

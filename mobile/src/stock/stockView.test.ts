import { describe, it, expect } from "vitest";
import type { LocationDashboard, LocationItem } from "@culinaire/shared/schemas/storeRoom";
import { alertLists, areasOf, categoryLabel, findItems, money, qtyText, valueRows } from "./stockView";

const item = (over: Partial<LocationItem> = {}): LocationItem => ({ ingredientId: "i1", ingredientName: "Salt", ingredientCategory: "dry_goods", itemType: "KITCHEN_INGREDIENT", baseUnit: "kg", parLevel: 10, activeInd: true, currentQty: 2, lastCountedDttm: null, supplierName: null, ...over });
const dashboard = (over: Partial<LocationDashboard["stockSummary"]> = {}): LocationDashboard => ({
  stockLevels: [{ ingredientId: "i9", ingredientName: "Saffron", ingredientCategory: "spices", baseUnit: "g", currentQty: 1, parLevel: 20 }],
  stockSummary: { lowCount: 1, criticalCount: 2, lowIngredientIds: ["i2"], criticalIngredientIds: ["i1", "i9"], ...over },
  activeSession: null,
  lastCompletedSession: null,
});

describe("blind count: a figure the server left out is a dash, never a zero", () => {
  it("writes a quantity with its unit, and a dash for one that is hidden or not recorded", () => {
    expect(qtyText(2.5, "kg")).toBe("2.5 kg");
    expect(qtyText(0, "kg")).toBe("0 kg");
    expect(qtyText(1 / 3, "L")).toBe("0.33 L");
    expect(qtyText(undefined, "kg")).toBe("—");
    expect(qtyText(null, "kg")).toBe("—");
  });

  it("lists low and critical items from the server's ids, with a dash where the quantity is hidden", () => {
    const { critical, low } = alertLists(dashboard(), [item(), item({ ingredientId: "i2", ingredientName: "Flour", currentQty: undefined, parLevel: 25 })]);
    expect(critical.map((a) => [a.name, a.onHand, a.par])).toEqual([["Saffron", "1 g", "20 g"], ["Salt", "2 kg", "10 kg"]]);
    expect(low.map((a) => [a.name, a.onHand, a.par])).toEqual([["Flour", "—", "25 kg"]]);
  });

  it("still names an item the item list does not hold", () => {
    expect(alertLists(dashboard({ criticalIngredientIds: ["gone"] }), []).critical).toEqual([{ ingredientId: "gone", name: "An item no longer in the catalogue", onHand: "—", par: "—" }]);
  });

  it("shows no value rows when the server sent no value", () => {
    expect(valueRows(dashboard())).toBeNull();
    expect(valueRows(dashboard({ stockValue: 1500.4, valueByCategory: [{ category: "dry_goods", value: 300 }, { category: "proteins", value: 1200.4 }] }))).toEqual({ total: "$1,500", rows: [{ label: "Proteins", value: "$1,200", share: 0.8 }, { label: "Dry Goods", value: "$300", share: 0.2 }] });
  });
});

describe("item lookup", () => {
  const items = [item({ ingredientName: "Sea salt", ingredientId: "a" }), item({ ingredientName: "Salted butter", ingredientId: "b", activeInd: false }), item({ ingredientName: "Basil", ingredientId: "c" })];

  it("lists the items active here, A to Z, when nothing is typed", () => {
    expect(findItems(items, "").map((i) => i.ingredientName)).toEqual(["Basil", "Sea salt"]);
  });

  it("searches the whole catalogue by name, active or not, best match first", () => {
    expect(findItems(items, "sal").map((i) => i.ingredientName)).toEqual(["Salted butter", "Sea salt"]);
  });

  it("names the areas an item is kept in, in the venue's order", () => {
    const areas = [{ storageAreaId: "a1", areaName: "Dry Store" }, { storageAreaId: "a2", areaName: "Cool Room" }];
    expect(areasOf("i1", { i1: ["a2", "a1", "gone"] }, areas)).toEqual(["Dry Store", "Cool Room"]);
    expect(areasOf("i2", {}, areas)).toEqual([]);
  });

  it("writes categories and money as the web does", () => {
    expect(categoryLabel("dry_goods")).toBe("Dry Goods");
    expect(categoryLabel("")).toBe("Other");
    expect(money(1234.5)).toBe("$1,235");
  });
});

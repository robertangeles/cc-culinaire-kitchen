import { vi } from "vitest";
import type { ImportRecipe, MenuCatalogueItem, MenuItem, MenuLine, Recommendation, Sale, SaleResult, SalesCsvPreview, SalesCsvReport, SellableConsumable, WasteImpact, YieldVariance } from "@culinaire/shared/schemas/menu";
import { createRecents, type Recents } from "../src/ingredients/recents";
import type { PickedIngredient } from "../src/ingredients/source";
import type { MenuApi } from "../src/menu/menuApi";
import { createMenuStore, type MenuStore } from "../src/menu/menuStore";
import type { KvStore } from "../src/storage/kv";
import { NOW } from "./stockHarness";

/** What a menu screen test renders against; the mocked `useMenu` reads it from here. */
export const menu = { store: null as unknown as MenuStore, api: null as unknown as MenuApi, recents: null as unknown as Recents<PickedIngredient> };

export const menuItem = (over: Partial<MenuItem> = {}): MenuItem => ({
  menuItemId: "m1", userId: 1, name: "Margherita", category: "Pasta", sellingPrice: 24, servings: 1, servingsPerSale: 1, qFactorPct: 0, foodCost: 6.1, foodCostPct: 25.42, contributionMargin: 17.9, unitsSold: 12, menuMixPct: 60, classification: "star",
  containsDairyInd: true, containsGlutenInd: false, containsNutsInd: false, containsShellfishInd: false, containsEggsInd: false, isVegetarianInd: false, canManage: true, ...over,
});
export const menuLine = (over: Partial<MenuLine> = {}): MenuLine => ({ id: 1, ingredientId: "i1", ingredientName: "Mozzarella", note: null, quantity: 0.12, unit: "kg", unitCost: 14, yieldPct: 100, lineCost: 1.68, costStaleInd: false, baseUnit: "kg", contentQty: null, contentUnit: null, densityGPerMl: null, purchaseUnit: null, packQty: null, catalogUnitCost: 14, ...over });
export const recorded: SaleResult = { saleId: "s1", alreadyExists: false, voided: false, depleted: [{ ingredientId: "i1", ingredientName: "Mozzarella", baseQty: 0.24, baseUnit: "kg", fohOnHand: 3 }], skipped: [{ ingredientName: "Basil" }], oversold: [] };
const flour: MenuCatalogueItem = { ingredientId: "i2", ingredientName: "Flour", baseUnit: "kg", ingredientCategory: "dry_goods", contentQty: null, contentUnit: null, densityGPerMl: null, purchaseUnit: null, packQty: null, preferredUnitCost: 2, unitCost: 2 };

interface Over {
  items?: MenuItem[];
  lines?: MenuLine[];
  targets?: Record<string, number>;
  consumables?: SellableConsumable[];
  recipes?: ImportRecipe[];
  sales?: Sale[];
  waste?: WasteImpact[];
  variance?: YieldVariance;
  plateCost?: number;
  canSeeCost?: boolean;
  api?: Partial<Record<keyof MenuApi, ReturnType<typeof vi.fn>>>;
}

export async function makeMenu(over: Over = {}) {
  const kvMap = new Map<string, string>();
  const kv: KvStore = { get: async (k) => kvMap.get(k) ?? null, set: async (k, v) => void kvMap.set(k, v), delete: async (k) => void kvMap.delete(k) };
  const api = {
    items: vi.fn(async () => over.items ?? [menuItem()]),
    lines: vi.fn(async () => over.lines ?? [menuLine()]),
    create: vi.fn(async () => ({ menuItemId: "m9" })),
    update: vi.fn(async () => undefined),
    addLine: vi.fn(async () => undefined),
    removeLine: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    refreshCost: vi.fn(async () => undefined),
    targets: vi.fn(async () => over.targets ?? {}),
    setTarget: vi.fn(async () => undefined),
    recipes: vi.fn(async () => over.recipes ?? []),
    catalogue: vi.fn(async () => [flour]),
    conversions: vi.fn(async () => []),
    consumables: vi.fn(async () => over.consumables ?? []),
    sell: vi.fn(async () => recorded),
    sales: vi.fn(async () => over.sales ?? []),
    voidSale: vi.fn(async () => undefined),
    wasteImpact: vi.fn(async () => over.waste ?? []),
    yieldVariance: vi.fn(async () => over.variance ?? { status: "no-period", threshold: null, unitsSold: 0, consumptionLogCount: 0, periodStart: null, periodEnd: null }),
    plateCost: vi.fn(async (): Promise<number | null | undefined> => over.plateCost),
    recalculate: vi.fn(async () => undefined),
    recommendations: vi.fn(async (): Promise<Recommendation> => ({ summary: "", actions: [] })),
    replacement: vi.fn(async () => "Generate a replacement recipe for \"Margherita\"."),
    previewSales: vi.fn(async (): Promise<SalesCsvPreview> => ({ matched: [], unmatched: [] })),
    commitSales: vi.fn(async (): Promise<SalesCsvReport> => ({ succeeded: [], alreadyExists: [], failed: [] })),
    importUnits: vi.fn(async () => ({ updated: 0, notFound: [] as string[] })),
    ...over.api,
  };
  let n = 0;
  const store = createMenuStore({ api: api as unknown as MenuApi, kv, userId: 1, locationId: "L1", canSeeCost: over.canSeeCost ?? true, now: () => NOW, newId: () => `key${++n}` });
  await store.refresh();
  Object.assign(menu, { store, api, recents: createRecents<PickedIngredient>({ kv, key: "menu.recents", max: 12 }) });
  return { store, api };
}

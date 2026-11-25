import { CategoryTargetListSchema, ConsumableListSchema, ConversionListSchema, CreatedMenuItemSchema, ImportRecipeListSchema, MenuAnalysisSchema, MenuCatalogueSchema, MenuLineListSchema, SaleListSchema, SaleResultSchema, type ImportRecipe, type MenuCatalogueItem, type MenuItem, type MenuLine, type Sale, type SaleResult, type SellableConsumable } from "@culinaire/shared/schemas/menu";
import type { CustomConversion } from "@culinaire/shared";
import type { ApiClient } from "../api/client";
import type { EditorApi } from "./menuEditor";

/** What is sold: a dish of the menu, or a front-of-house item sold as it is. */
export interface SaleTarget {
  kind: "dish" | "consumable";
  id: string;
  name: string;
}

/** One sale to record. `key` makes sending it again safe: the server records a key once and answers a repeat with the sale it already has. */
export interface SaleAttempt {
  key: string;
  target: SaleTarget;
  qty: number;
  locationId: string;
}

export const SALES_SHOWN = 50;

/** The menu routes. Nothing here is queued: every write needs a connection. */
export function createMenuApi(client: ApiClient) {
  const itemPath = (id: string) => `/api/menu/items/${encodeURIComponent(id)}`;
  const editor: EditorApi = {
    /** The organisation's items with their mix and class, worked out by the server as the web shows them; it writes nothing. */
    items: async (): Promise<MenuItem[]> => (await client.request("GET", "/api/menu/analysis", { schema: MenuAnalysisSchema })).items,
    lines: (menuItemId): Promise<MenuLine[]> => client.request("GET", `${itemPath(menuItemId)}/ingredients`, { schema: MenuLineListSchema }),
    create: (body) => client.request("POST", "/api/menu/items", { body, schema: CreatedMenuItemSchema }),
    update: (menuItemId, changes) => client.request("PATCH", itemPath(menuItemId), { body: changes }),
    addLine: (menuItemId, line) => client.request("POST", `${itemPath(menuItemId)}/ingredients`, { body: line }),
    removeLine: (menuItemId, rowId) => client.request("DELETE", `${itemPath(menuItemId)}/ingredients/${rowId}`),
  };
  return {
    ...editor,
    remove: (menuItemId: string) => client.request("DELETE", itemPath(menuItemId)),
    refreshCost: (menuItemId: string, rowId: number) => client.request("POST", `${itemPath(menuItemId)}/ingredients/${rowId}/refresh-cost`),
    /** Category name -> food cost target %. */
    async targets(): Promise<Record<string, number>> {
      const rows = await client.request("GET", "/api/menu/categories", { schema: CategoryTargetListSchema });
      return Object.fromEntries(rows.map((r) => [r.categoryName, r.targetFoodCostPct]));
    },
    setTarget: (category: string, targetFoodCostPct: string) => client.request("PUT", `/api/menu/categories/${encodeURIComponent(category)}`, { body: { targetFoodCostPct } }),
    recipes: (): Promise<ImportRecipe[]> => client.request("GET", "/api/recipes/for-import", { schema: ImportRecipeListSchema }),
    catalogue: (): Promise<MenuCatalogueItem[]> => client.request("GET", "/api/inventory/ingredients", { schema: MenuCatalogueSchema }),
    conversions: (ingredientId: string): Promise<CustomConversion[]> => client.request("GET", `/api/inventory/ingredients/${encodeURIComponent(ingredientId)}/conversions`, { schema: ConversionListSchema }),
    consumables: (): Promise<SellableConsumable[]> => client.request("GET", "/api/menu/consumables", { schema: ConsumableListSchema }),
    sell({ key, target, qty, locationId }: SaleAttempt): Promise<SaleResult> {
      const path = target.kind === "dish" ? itemPath(target.id) : `/api/menu/consumables/${encodeURIComponent(target.id)}`;
      return client.request("POST", `${path}/sales`, { body: { qtySold: qty, locationId, idempotencyKey: key }, schema: SaleResultSchema });
    },
    sales: (locationId: string): Promise<Sale[]> => client.request("GET", `/api/menu/locations/${encodeURIComponent(locationId)}/sales?limit=${SALES_SHOWN}`, { schema: SaleListSchema }),
    voidSale: (saleId: string) => client.request("POST", `/api/menu/sales/${encodeURIComponent(saleId)}/void`),
  };
}

export type MenuApi = ReturnType<typeof createMenuApi>;

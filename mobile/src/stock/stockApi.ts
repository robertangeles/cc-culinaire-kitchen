import { AreaAssignmentsSchema, LocationDashboardSchema, LocationItemListSchema, StockAcrossLocationsSchema, type LocationDashboard, type LocationItem, type StockAtLocation } from "@culinaire/shared/schemas/storeRoom";
import { StorageAreaListSchema, type StorageArea } from "@culinaire/shared/schemas/stockMovement";
import type { ApiClient } from "../api/client";

/** The store room reads. Catalogue requests are queued commands (`catalogRequestCommands.ts`), never called from a screen. */
export function createStockApi(client: ApiClient) {
  const base = (locationId: string) => `/api/inventory/locations/${encodeURIComponent(locationId)}`;
  return {
    /** The server's figures: low and critical for everyone with `inventory:count`, the value only with `inventory:cost`. */
    dashboard(locationId: string): Promise<LocationDashboard> {
      return client.request("GET", `${base(locationId)}/dashboard`, { schema: LocationDashboardSchema });
    },
    /** Every catalogue item with this location's par, whether it is active here and its store-room stock (hidden without `inventory:cost`). */
    items(locationId: string): Promise<LocationItem[]> {
      return client.request("GET", `${base(locationId)}/ingredients`, { schema: LocationItemListSchema });
    },
    areas(locationId: string): Promise<StorageArea[]> {
      return client.request("GET", `${base(locationId)}/storage-areas`, { schema: StorageAreaListSchema });
    },
    /** Item id -> the areas it is kept in at this location. */
    assignments(locationId: string): Promise<Record<string, string[]>> {
      return client.request("GET", `${base(locationId)}/storage-areas/assignments`, { schema: AreaAssignmentsSchema });
    },
    /** One item's store-room stock at every location of the organisation. The server opens it to `inventory:manage` only. */
    elsewhere(ingredientId: string): Promise<StockAtLocation[]> {
      return client.request("GET", `/api/inventory/ingredients/${encodeURIComponent(ingredientId)}/stock-levels`, { schema: StockAcrossLocationsSchema });
    },
  };
}

export type StockApi = ReturnType<typeof createStockApi>;

import { StockMovementListSchema, StorageAreaListSchema, type StockMovement, type StorageArea } from "@culinaire/shared/schemas/stockMovement";
import type { ApiClient } from "../api/client";

/** The stock movement reads. Writes are queued commands (`movementCommands.ts`), never called from a screen. */
export function createMovementApi(client: ApiClient) {
  const base = (locationId: string) => `/api/inventory/locations/${encodeURIComponent(locationId)}`;
  return {
    /** The active areas at a location, in the order the venue set. */
    areas(locationId: string): Promise<StorageArea[]> {
      return client.request("GET", `${base(locationId)}/storage-areas`, { schema: StorageAreaListSchema });
    },

    /** The latest moves at a location, newest first (the route has no date filter). */
    list(locationId: string): Promise<StockMovement[]> {
      return client.request("GET", `${base(locationId)}/stock-movements?limit=${RECENT_LIMIT}`, { schema: StockMovementListSchema });
    },
  };
}

export const RECENT_LIMIT = 50;
export type MovementApi = ReturnType<typeof createMovementApi>;

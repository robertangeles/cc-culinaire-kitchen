import { TransferDetailSchema, TransferListSchema, type TransferDetail, type TransferSummary } from "@culinaire/shared/schemas/transfer";
import { LocationItemListSchema, type LocationItem } from "@culinaire/shared/schemas/storeRoom";
import type { ApiClient } from "../api/client";

/** The transfer reads. Writes are queued commands (`transferCommands.ts`), never called from a screen. */
export function createTransferApi(client: ApiClient) {
  const at = (locationId: string) => `storeLocationId=${encodeURIComponent(locationId)}`;
  return {
    /** The latest transfers to or from a location, newest first. */
    list(locationId: string): Promise<TransferSummary[]> {
      return client.request("GET", `/api/inventory/transfers?${at(locationId)}&limit=${LIST_LIMIT}`, { schema: TransferListSchema });
    },
    /** Every transfer on its way to a location (sent, not received), however old: none drops off the list. */
    pending(locationId: string): Promise<TransferSummary[]> {
      return client.request("GET", `/api/inventory/transfers/pending?${at(locationId)}`, { schema: TransferListSchema });
    },
    detail(transferId: string): Promise<TransferDetail> {
      return client.request("GET", `/api/inventory/transfers/${encodeURIComponent(transferId)}`, { schema: TransferDetailSchema });
    },
    /** The location's items with their store-room stock ("You have"), hidden without `inventory:cost`. */
    items(locationId: string): Promise<LocationItem[]> {
      return client.request("GET", `/api/inventory/locations/${encodeURIComponent(locationId)}/ingredients`, { schema: LocationItemListSchema });
    },
  };
}

export const LIST_LIMIT = 50;
export type TransferApi = ReturnType<typeof createTransferApi>;

/**
 * Asking for an item the catalogue lacks ("we got yuzu juice in, it isn't in the list"). Safe to send twice: the request carries its own id
 * (`requestId`, made on the phone) and the server answers a repeat with 200 and the stored request. HQ approves or rejects it on the web.
 */

import type { ApiClient } from "../api/client";
import type { CommandHandler } from "../outbox/outbox";

export interface CatalogRequestCommand {
  requestId: string;
  /** Where it was asked for: the server checks the person works there. */
  storeLocationId: string;
  itemName: string;
  itemType: string | null;
  category: string | null;
  /** The unit it would be counted in. */
  baseUnit: string | null;
  /** How many are on the shelf now, when the person counted them. */
  countedQty: number | null;
  /** ISO, the phone's clock. Not sent. */
  requestedAt: string;
}

export const CATALOG_REQUEST = "catalog.request";
export const CATALOG_REQUEST_TYPES = [CATALOG_REQUEST];

export function catalogRequestHandlers(client: ApiClient): CommandHandler<unknown>[] {
  const ask: CommandHandler<CatalogRequestCommand> = {
    type: CATALOG_REQUEST,
    version: 1,
    key: (c) => `catalogRequest:${c.requestId}`,
    creates: true,
    maxServerFailures: 5,
    // 409 CONFLICT (an id that is someone else's), 400 VALIDATION and 403 LOCATION_NOT_ALLOWED stay visible with the server's words.
    async send(c) {
      const body: Record<string, unknown> = { requestId: c.requestId, storeLocationId: c.storeLocationId, itemName: c.itemName };
      if (c.itemType) body.itemType = c.itemType;
      if (c.category) body.category = c.category;
      if (c.baseUnit) body.baseUnit = c.baseUnit;
      if (c.countedQty !== null) body.countedQty = c.countedQty;
      await client.request("POST", "/api/inventory/catalog-requests", { body });
    },
    describe: (c) => `New item request: ${c.itemName}`,
  };
  return [ask] as CommandHandler<unknown>[];
}

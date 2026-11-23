/**
 * The offline stock movement command ("4 bottles, Stock Room to Bar"). It is safe to send twice: it carries its own id
 * (`stockMovementId`, made on the phone) and a repeat answers 200 with the stored row. A move changes no stock, only the record of
 * where things are, and the web has no edit or delete for it, so there is one command and nothing to fold.
 */

import type { ApiClient } from "../api/client";
import type { CommandHandler } from "../outbox/outbox";

export interface MovementLogCommand {
  stockMovementId: string;
  /** Where the move was made: it is sent to this location's route even after a location switch. */
  storeLocationId: string;
  ingredientId: string;
  ingredientName: string;
  fromStorageAreaId: string;
  fromAreaName: string;
  toStorageAreaId: string;
  toAreaName: string;
  quantity: number;
  /** The item's kitchen unit. */
  unit: string;
  notes: string | null;
  /** ISO, the phone's clock when made: what the list shows until the server's list holds the move. Not sent. */
  movedAt: string;
}

export const MOVEMENT_LOG = "movement.log";
export const MOVEMENT_TYPES = [MOVEMENT_LOG];

export function movementHandlers(client: ApiClient): CommandHandler<unknown>[] {
  const log: CommandHandler<MovementLogCommand> = {
    type: MOVEMENT_LOG,
    version: 1,
    key: (c) => `movement:${c.stockMovementId}`,
    creates: true,
    maxServerFailures: 5,
    // 404 NOT_FOUND (an area at another location, or the item), 400 VALIDATION (an area no longer in use) and 422 INCOMPATIBLE_UNITS
    // are refusals the default reading keeps visible, with the server's words.
    async send(c) {
      const body: Record<string, unknown> = { stockMovementId: c.stockMovementId, ingredientId: c.ingredientId, fromStorageAreaId: c.fromStorageAreaId, toStorageAreaId: c.toStorageAreaId, quantity: c.quantity, unit: c.unit };
      if (c.notes) body.notes = c.notes;
      await client.request("POST", `/api/inventory/locations/${encodeURIComponent(c.storeLocationId)}/stock-movements`, { body });
    },
    describe: (c) => `Move: ${c.quantity} ${c.unit} ${c.ingredientName}, ${c.fromAreaName} to ${c.toAreaName}`,
  };
  return [log] as CommandHandler<unknown>[];
}

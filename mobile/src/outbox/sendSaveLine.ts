import type { ApiClient } from "../api/client";
import type { OutboxEntry } from "./outbox";

/** The request behind one queued count. The server saves a line as an upsert, so sending it twice is safe. */
export function createSendSaveLine(client: ApiClient) {
  return async (entry: OutboxEntry): Promise<void> => {
    const { sessionId, categoryName, ingredientId, rawQty, countedUnit, claimRevision } = entry.command;
    await client.request("POST", `/api/inventory/stock-takes/${sessionId}/categories/${encodeURIComponent(categoryName)}/lines`, {
      body: { ingredientId, rawQty, countedUnit, claimRevision },
    });
  };
}

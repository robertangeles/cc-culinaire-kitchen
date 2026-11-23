import { ConsumptionListSchema, type ConsumptionEntry } from "@culinaire/shared/schemas/consumption";
import type { ApiClient } from "../api/client";

/** The consumption reads. Writes are queued commands (`consumptionCommands.ts`), never called from a screen. */
export function createConsumptionApi(client: ApiClient) {
  return {
    /** Everyone's entries at one location for one day, newest first. `day` holds ISO timestamps: the server reads a bare date as a UTC day. */
    list(day: { start: string; end: string }, locationId: string): Promise<ConsumptionEntry[]> {
      const q = new URLSearchParams({ storeLocationId: locationId, startDate: day.start, endDate: day.end, limit: "200" });
      return client.request("GET", `/api/inventory/consumption-logs?${q.toString()}`, { schema: ConsumptionListSchema });
    },
  };
}

export type ConsumptionApi = ReturnType<typeof createConsumptionApi>;

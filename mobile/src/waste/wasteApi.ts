import { WasteListSchema, WasteSuggestionsSchema, type WasteEntry } from "@culinaire/shared/schemas/waste";
import type { ApiClient } from "../api/client";

/** The waste reads. Writes are queued commands (`wasteCommands.ts`), never called from a screen. */
export function createWasteApi(client: ApiClient) {
  return {
    /** The signed-in person's own entries for one day at one location. `day` holds ISO timestamps: the server reads a bare date as a UTC day. */
    async list(day: { start: string; end: string }, locationId: string): Promise<WasteEntry[]> {
      const q = new URLSearchParams({ limit: "200", startDate: day.start, endDate: day.end, storeLocationId: locationId });
      return (await client.request("GET", `/api/waste?${q.toString().replace(/\+/g, "%20")}`, { schema: WasteListSchema })).data;
    },

    /** Names from the waste history and recipes that contain `query`. */
    suggestions(query: string): Promise<string[]> {
      return client.request("GET", `/api/waste/suggestions?q=${encodeURIComponent(query.trim())}`, { schema: WasteSuggestionsSchema });
    },
  };
}

export type WasteApi = ReturnType<typeof createWasteApi>;

import { PrepMenuSchema, PrepSelectionsSchema, PrepTodaySchema, type PrepMenu, type PrepSelection, type PrepToday } from "@culinaire/shared/schemas/prep";
import { ApiError, type ApiClient } from "../api/client";

/** The prep reads. Writes are queued commands (`prepCommands.ts`), never called from a screen. */
export function createPrepApi(client: ApiClient) {
  return {
    /** The open session for one local date at one location, whoever made it, or null when none was made. */
    async today(date: string, locationId: string): Promise<PrepToday | null> {
      try {
        return await client.request("GET", `/api/prep/sessions/today?date=${date}&storeLocationId=${encodeURIComponent(locationId)}`, { schema: PrepTodaySchema });
      } catch (err) {
        if (err instanceof ApiError && err.code === "not_found") return null; // the server's answer for "nothing planned yet"
        throw err;
      }
    },

    /** The dishes a cook can plan prep for: the organisation's, as the web shows by default. */
    menu(): Promise<PrepMenu> {
      return client.request("GET", "/api/prep/menu?teamView=true", { schema: PrepMenuSchema });
    },

    /** The dishes and portions of the most recent plan, to start from. */
    previousSelections(): Promise<PrepSelection[]> {
      return client.request("GET", "/api/prep/previous-selections?teamView=true", { schema: PrepSelectionsSchema });
    },
  };
}

export type PrepApi = ReturnType<typeof createPrepApi>;

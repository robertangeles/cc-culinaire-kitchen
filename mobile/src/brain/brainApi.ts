import { MemoryPageSchema, NudgeOptInSchema, type MemoryPage } from "@culinaire/shared/schemas/brain";
import type { ApiClient } from "../api/client";

export interface MemoryFilter {
  /** "user" is private to this person, "org" is shared with the kitchen. */
  scope: "user" | "org";
  /** Where the memory came from, or null for all. */
  sourceType: string | null;
  search: string;
}

/** Your Brain (`/api/brain`): reading is `brain:read` on the server, removing is `brain:manage`. */
export function createBrainApi(client: ApiClient) {
  return {
    list({ scope, sourceType, search }: MemoryFilter, offset: number, limit: number): Promise<MemoryPage> {
      const q = search.trim();
      return client.request("GET", `/api/brain/memories?scope=${scope}&limit=${limit}&offset=${offset}${sourceType ? `&sourceType=${sourceType}` : ""}${q ? `&search=${encodeURIComponent(q)}` : ""}`, { schema: MemoryPageSchema });
    },
    async remove(memoryId: string): Promise<void> {
      await client.request("DELETE", `/api/brain/memories/${encodeURIComponent(memoryId)}`);
    },
    async nudges(): Promise<boolean> {
      return (await client.request("GET", "/api/brain/nudges/opt-in", { schema: NudgeOptInSchema })).optIn;
    },
    async setNudges(optIn: boolean): Promise<boolean> {
      return (await client.request("PUT", "/api/brain/nudges/opt-in", { body: { optIn }, schema: NudgeOptInSchema })).optIn;
    },
  };
}

export type BrainApi = ReturnType<typeof createBrainApi>;

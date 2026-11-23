import { CatalogueSchema, type CatalogueIngredient } from "@culinaire/shared/schemas/catalogue";
import type { AuthUser } from "../api/auth";
import type { ApiClient } from "../api/client";
import { hasAnyPermission } from "../shell/tabs";
import type { KvStore } from "../storage/kv";

/**
 * The list to download: the full inventory list for someone who may count stock (as before), otherwise the small read-only list
 * the server opens to `waste:log` (id, name and kitchen unit only). Both parse as the same catalogue.
 */
export const catalogueRoute = (user: AuthUser) =>
  hasAnyPermission(user, ["inventory:count"]) ? "/api/inventory/ingredients" : "/api/waste/ingredients";

/**
 * The organisation's ingredient list the picker searches, kept on the phone: `items()` reads what was last downloaded (so the picker
 * works with no signal and never waits on the network), `refresh()` downloads again. If the download fails (no signal, or the server
 * refuses) the list stays as it was, empty at first: the picker then offers recent items and the server's name suggestions, and
 * accepts what is typed.
 */
export function createCatalogue({ client, kv, key, path }: { client: ApiClient; kv: KvStore; key: string; path: string }) {
  let memory: CatalogueIngredient[] | null = null;

  async function items(): Promise<CatalogueIngredient[]> {
    if (memory) return memory;
    try {
      memory = CatalogueSchema.parse(JSON.parse((await kv.get(key)) ?? "[]"));
    } catch {
      memory = [];
    }
    return memory;
  }

  return {
    items,
    /** True when a new list was downloaded; false (and the old list kept) when it could not be. */
    async refresh(): Promise<boolean> {
      try {
        const downloaded = await client.request("GET", path, { schema: CatalogueSchema });
        memory = downloaded;
        await kv.set(key, JSON.stringify(downloaded));
        return true;
      } catch {
        return false;
      }
    },
  };
}

export type Catalogue = ReturnType<typeof createCatalogue>;

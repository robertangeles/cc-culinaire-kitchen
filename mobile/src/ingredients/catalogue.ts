import { CatalogueSchema, type CatalogueIngredient } from "@culinaire/shared/schemas/catalogue";
import type { ApiClient } from "../api/client";
import type { KvStore } from "../storage/kv";

/**
 * The organisation's ingredient list the picker searches, kept on the phone: `items()` reads what was last downloaded (so the picker
 * works with no signal and never waits on the network), `refresh()` downloads again. The server shows the list only to people who may
 * count stock, so for anyone else `refresh()` fails and the list stays empty: the picker then offers recent items and the server's
 * name suggestions, and accepts what is typed.
 */
export function createCatalogue({ client, kv, key }: { client: ApiClient; kv: KvStore; key: string }) {
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
        const downloaded = await client.request("GET", "/api/inventory/ingredients", { schema: CatalogueSchema });
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

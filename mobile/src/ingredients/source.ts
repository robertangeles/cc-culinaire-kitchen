/**
 * The shared ingredient picker's data: what to offer before anything is typed (recent items) and what matches what was typed
 * (the downloaded catalogue and recent items at once, then, when the server can be reached, its own name suggestions).
 * The waste log uses it now; consumption, transfers and orders use the same source with their own `moreNames`.
 */

import type { CatalogueIngredient } from "@culinaire/shared/schemas/catalogue";
import type { Recents } from "./recents";

/** What the person chose. `ingredientId` is set when it came from the catalogue; typed or suggested names have none. */
export interface PickedIngredient {
  name: string;
  ingredientId?: string;
  /** The unit the item is kept in (catalogue) or was last used with (recent). */
  unit?: string;
}

export interface IngredientSource {
  /** Offered before anything is typed, newest first. */
  recent(): Promise<PickedIngredient[]>;
  /** Instant, from the phone: catalogue and recent items that match. */
  search(query: string): Promise<PickedIngredient[]>;
  /** Slower, from the server: names the instant search did not find. Never throws. Absent when the module has no such list. */
  searchMore?(query: string): Promise<PickedIngredient[]>;
  remember(picked: PickedIngredient): Promise<void>;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Names that start with the text first, then names with a word that starts with it, then names that contain it. */
export function rankIngredients<T extends { name: string }>(query: string, items: T[], limit: number): T[] {
  const q = fold(query);
  if (!q) return [];
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const name = fold(item.name);
    const score = name.startsWith(q) ? 0 : name.split(/[\s\-/,(]+/).some((w) => w.startsWith(q)) ? 1 : name.includes(q) ? 2 : -1;
    if (score >= 0) scored.push({ item, score });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((s) => s.item);
}

export interface SourceDeps {
  catalogue: { items(): Promise<CatalogueIngredient[]> };
  recents: Recents<PickedIngredient>;
  /** The server's own suggestions for what was typed (waste: names from the waste history and recipes). */
  moreNames?: (query: string) => Promise<string[]>;
}

const LIMIT = 8;

export function createIngredientSource({ catalogue, recents, moreNames }: SourceDeps): IngredientSource {
  async function local(query: string): Promise<PickedIngredient[]> {
    const [recent, items] = await Promise.all([recents.list(), catalogue.items()]);
    const fromCatalogue: PickedIngredient[] = items.map((i) => ({ name: i.ingredientName, ingredientId: i.ingredientId, unit: i.baseUnit || undefined }));
    // Recent items come first (the person's own habit), then the catalogue; a name is offered once.
    const seen = new Set<string>();
    const out: PickedIngredient[] = [];
    for (const p of [...rankIngredients(query, recent, LIMIT), ...rankIngredients(query, fromCatalogue, LIMIT * 2)]) {
      if (seen.has(fold(p.name))) continue;
      seen.add(fold(p.name));
      out.push(p);
    }
    return out.slice(0, LIMIT);
  }

  return {
    recent: () => recents.list(),
    search: local,
    ...(moreNames
      ? {
          async searchMore(query: string) {
            try {
              const have = new Set((await local(query)).map((p) => fold(p.name)));
              return (await moreNames(query)).filter((n) => !have.has(fold(n))).map((name) => ({ name }));
            } catch {
              return [];
            }
          },
        }
      : {}),
    remember: (picked) => recents.remember(picked),
  };
}

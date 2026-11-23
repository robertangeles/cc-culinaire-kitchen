/** My Recipes: the person's saved recipes, newest first, a page at a time, filtered by lab the way the web's tabs are. */

import type { RecipeDomain, RecipeSummary } from "@culinaire/shared/schemas/recipe";
import type { RecipeApi } from "./recipeApi";
import { recipeFailure } from "./labStore";

export interface ShelfSnapshot {
  phase: "loading" | "ready" | "error";
  domain: RecipeDomain | null;
  recipes: RecipeSummary[];
  total: number;
  /** Loading the next page. */
  more: boolean;
  error: string | null;
}

export function createShelfStore({ api }: { api: RecipeApi }) {
  let snapshot: ShelfSnapshot = { phase: "loading", domain: null, recipes: [], total: 0, more: false, error: null };
  const listeners = new Set<() => void>();
  let page = 1;
  // A newer request (another tab picked, a refresh) wins over a slower older one.
  let generation = 0;

  const set = (next: Partial<ShelfSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };

  async function load(domain: RecipeDomain | null): Promise<void> {
    const mine = ++generation;
    const restart = domain !== snapshot.domain || snapshot.phase === "error";
    if (restart) page = 1;
    set({ domain, error: null, more: false, ...(restart ? { phase: "loading", recipes: [] } : {}) });
    try {
      // A refresh reads every page already loaded again, so the list stays as long as it was and a recipe added or removed
      // elsewhere moves the rows the way the server has them.
      const pages = await Promise.all(Array.from({ length: page }, (_, i) => api.mine(i + 1, domain ?? undefined)));
      if (mine !== generation) return;
      const seen = new Set<string>();
      const recipes = pages.flatMap((p) => p.recipes).filter((r) => !seen.has(r.recipeId) && seen.add(r.recipeId));
      set({ phase: "ready", recipes, total: pages[0].total });
    } catch (err) {
      if (mine !== generation) return;
      // Keep what is on screen when only a refresh failed.
      set({ phase: snapshot.recipes.length ? "ready" : "error", error: recipeFailure(err, "see your recipes").message });
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    refresh: () => load(snapshot.domain),
    setDomain: (domain: RecipeDomain | null) => (domain === snapshot.domain && snapshot.phase !== "error" ? Promise.resolve() : load(domain)),
    async loadMore(): Promise<void> {
      if (snapshot.more || snapshot.phase !== "ready" || snapshot.recipes.length >= snapshot.total) return;
      const mine = ++generation;
      set({ more: true, error: null });
      try {
        const next = await api.mine(page + 1, snapshot.domain ?? undefined);
        if (mine !== generation) return;
        page += 1;
        const known = new Set(snapshot.recipes.map((r) => r.recipeId));
        set({ recipes: [...snapshot.recipes, ...next.recipes.filter((r) => !known.has(r.recipeId))], total: next.total });
      } catch (err) {
        if (mine === generation) set({ error: recipeFailure(err, "see your recipes").message });
      } finally {
        if (mine === generation) set({ more: false });
      }
    },
  };
}

export type ShelfStore = ReturnType<typeof createShelfStore>;

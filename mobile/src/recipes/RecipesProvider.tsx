import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { client } from "../runtime/appContext";
import { createRecipeApi, type RecipeApi } from "./recipeApi";
import { createLabStore, type LabStore } from "./labStore";
import { createRecipeStore } from "./recipeStore";
import { createShelfStore, type ShelfStore } from "./shelfStore";

interface Ctx {
  api: RecipeApi;
  shelf: ShelfStore;
  lab: LabStore;
}
const RecipesContext = createContext<Ctx | null>(null);

/** The recipes module: My Recipes and the Recipe Lab live as long as the tab, so a generation keeps running while the person looks elsewhere in it. */
export function RecipesProvider({ api, children }: { api?: RecipeApi; children: ReactNode }) {
  const ctx = useMemo<Ctx>(() => {
    const recipeApi = api ?? createRecipeApi(client);
    return { api: recipeApi, shelf: createShelfStore({ api: recipeApi }), lab: createLabStore({ api: recipeApi, now: Date.now }) };
  }, [api]);
  useEffect(() => () => ctx.lab.dispose(), [ctx]);
  return <RecipesContext.Provider value={ctx}>{children}</RecipesContext.Provider>;
}

function useCtx(): Ctx {
  const ctx = useContext(RecipesContext);
  if (!ctx) throw new Error("recipe screens must be inside RecipesProvider");
  return ctx;
}

export function useShelf() {
  const { shelf } = useCtx();
  return { store: shelf, snap: useSyncExternalStore(shelf.subscribe, shelf.getSnapshot) };
}

export function useLab() {
  const { lab } = useCtx();
  return { store: lab, snap: useSyncExternalStore(lab.subscribe, lab.getSnapshot) };
}

/** One recipe, loaded when the screen opens; leaving stops a refinement in flight (nothing is saved before Accept). */
export function useRecipe(recipeId: string, userId: number) {
  const { api } = useCtx();
  const store = useMemo(() => createRecipeStore({ api, recipeId, userId }), [api, recipeId, userId]);
  useEffect(() => {
    void store.load();
    return () => store.dispose();
  }, [store]);
  return { store, snap: useSyncExternalStore(store.subscribe, store.getSnapshot) };
}

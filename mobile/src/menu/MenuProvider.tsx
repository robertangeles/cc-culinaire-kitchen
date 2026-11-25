import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { client } from "../runtime/appContext";
import { currentUserId } from "../runtime/appOutbox";
import { createRecents, type Recents } from "../ingredients/recents";
import type { PickedIngredient } from "../ingredients/source";
import { newUuid } from "../outbox/uuid";
import { sqliteKv } from "../storage/kv";
import { createMenuApi, type MenuApi } from "./menuApi";
import { createMenuStore, type MenuStore } from "./menuStore";

interface Ctx {
  store: MenuStore;
  api: MenuApi;
  /** The ingredients this person last put in a recipe. */
  recents: Recents<PickedIngredient>;
}
const MenuContext = createContext<Ctx | null>(null);

/** One menu store per account and location (a sale is recorded at the location), loading the menu as soon as it exists. */
export function MenuProvider({ locationId, canSeeCost, children }: { locationId: string; canSeeCost: boolean; children: ReactNode }) {
  const ctx = useMemo<Ctx>(() => {
    const userId = currentUserId() ?? -1;
    const api = createMenuApi(client);
    return { api, recents: createRecents<PickedIngredient>({ kv: sqliteKv, key: `menu.recents.${userId}`, max: 12 }), store: createMenuStore({ api, kv: sqliteKv, userId, locationId, canSeeCost, now: Date.now, newId: newUuid }) };
  }, [locationId, canSeeCost]);
  useEffect(() => void ctx.store.refresh(), [ctx]);
  return <MenuContext.Provider value={ctx}>{children}</MenuContext.Provider>;
}

/** The menu store, its routes and the store's current snapshot, re-rendering on every change. */
export function useMenu() {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error("useMenu must be used inside MenuProvider");
  const snap = useSyncExternalStore(ctx.store.subscribe, ctx.store.getSnapshot);
  return { ...ctx, snap };
}

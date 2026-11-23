import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { client, session } from "../runtime/appContext";
import { currentUserId, outbox, runner } from "../runtime/appOutbox";
import { catalogueRoute, createCatalogue } from "../ingredients/catalogue";
import { createRecents } from "../ingredients/recents";
import { createIngredientSource, type IngredientSource } from "../ingredients/source";
import { newUuid } from "../outbox/uuid";
import { sqliteKv } from "../storage/kv";
import { createWasteApi } from "./wasteApi";
import { createWasteStore, type WasteRecent, type WasteStore } from "./wasteStore";

interface Ctx {
  store: WasteStore;
  source: IngredientSource;
}
const WasteContext = createContext<Ctx | null>(null);

/** One waste store per location and account, loading today's entries as soon as it exists. */
export function WasteProvider({ locationId, children }: { locationId: string; children: ReactNode }) {
  const ctx = useMemo<Ctx>(() => {
    const userId = currentUserId() ?? -1;
    const api = createWasteApi(client);
    const recents = createRecents<WasteRecent>({ kv: sqliteKv, key: `waste.recents.${userId}`, max: 12 });
    const state = session.getSnapshot().state;
    const catalogue = createCatalogue({ client, kv: sqliteKv, key: `catalogue.${userId}`, path: state.phase === "ready" ? catalogueRoute(state.user) : "/api/inventory/ingredients" });
    void catalogue.refresh(); // in the background: the picker reads what is on the phone and never waits for this
    return {
      store: createWasteStore({ api, kv: sqliteKv, outbox, recents, getUserId: () => currentUserId() ?? -1, locationId, kick: runner.kick, now: Date.now, newId: newUuid }),
      source: createIngredientSource({ catalogue, recents, moreNames: api.suggestions }),
    };
  }, [locationId]);
  useEffect(() => {
    void ctx.store.refresh();
    return () => ctx.store.dispose();
  }, [ctx]);
  return <WasteContext.Provider value={ctx}>{children}</WasteContext.Provider>;
}

/** The waste store, the picker's source and the store's current snapshot, re-rendering on every change. */
export function useWaste() {
  const ctx = useContext(WasteContext);
  if (!ctx) throw new Error("useWaste must be used inside WasteProvider");
  const snap = useSyncExternalStore(ctx.store.subscribe, ctx.store.getSnapshot);
  return { store: ctx.store, source: ctx.source, snap };
}

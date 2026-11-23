import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { client, session } from "../runtime/appContext";
import { currentUserId, outbox, runner } from "../runtime/appOutbox";
import { catalogueRoute, createCatalogue } from "../ingredients/catalogue";
import { createRecents } from "../ingredients/recents";
import { createIngredientSource, type IngredientSource } from "../ingredients/source";
import { newUuid } from "../outbox/uuid";
import { sqliteKv } from "../storage/kv";
import { createConsumptionApi } from "./consumptionApi";
import { createConsumptionStore, type ConsumptionRecent, type ConsumptionStore } from "./consumptionStore";
import type { Viewer } from "./consumptionView";

interface Ctx {
  store: ConsumptionStore;
  source: IngredientSource;
}
const ConsumptionContext = createContext<Ctx | null>(null);

/** One usage store per location and account, loading today's entries as soon as it exists. */
export function ConsumptionProvider({ locationId, viewer, children }: { locationId: string; viewer: Viewer; children: ReactNode }) {
  const ctx = useMemo<Ctx>(() => {
    const userId = currentUserId() ?? -1;
    const recents = createRecents<ConsumptionRecent>({ kv: sqliteKv, key: `consumption.recents.${userId}`, max: 12 });
    // Usage names an item of the organisation's catalogue (the server takes an ingredient id), so there is no free-text list from the server.
    const state = session.getSnapshot().state;
    const catalogue = createCatalogue({ client, kv: sqliteKv, key: `catalogue.${userId}`, path: state.phase === "ready" ? catalogueRoute(state.user) : "/api/inventory/ingredients" });
    void catalogue.refresh(); // in the background: the picker reads what is on the phone and never waits for this
    return {
      store: createConsumptionStore({ api: createConsumptionApi(client), kv: sqliteKv, outbox, recents, viewer, locationId, kick: runner.kick, now: Date.now, newId: newUuid }),
      source: createIngredientSource({ catalogue, recents }),
    };
  }, [locationId, viewer.userId]);
  useEffect(() => {
    void ctx.store.refresh();
    return () => ctx.store.dispose();
  }, [ctx]);
  return <ConsumptionContext.Provider value={ctx}>{children}</ConsumptionContext.Provider>;
}

/** The usage store, the picker's source and the store's current snapshot, re-rendering on every change. */
export function useConsumption() {
  const ctx = useContext(ConsumptionContext);
  if (!ctx) throw new Error("useConsumption must be used inside ConsumptionProvider");
  const snap = useSyncExternalStore(ctx.store.subscribe, ctx.store.getSnapshot);
  return { store: ctx.store, source: ctx.source, snap };
}

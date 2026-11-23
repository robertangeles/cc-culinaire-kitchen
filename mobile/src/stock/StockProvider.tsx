import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { client, session } from "../runtime/appContext";
import { catalogueRoute, createCatalogue } from "../ingredients/catalogue";
import { currentUserId, outbox, runner } from "../runtime/appOutbox";
import { newUuid } from "../outbox/uuid";
import { sqliteKv } from "../storage/kv";
import { createStockApi } from "./stockApi";
import { createStockStore, type StockStore } from "./stockStore";

const StockContext = createContext<StockStore | null>(null);

/** One stock store per location and account, loading the dashboard as soon as it exists. */
export function StockProvider({ locationId, canSeeQty, children }: { locationId: string; canSeeQty: boolean; children: ReactNode }) {
  const store = useMemo(() => {
    const userId = currentUserId() ?? -1;
    const state = session.getSnapshot().state;
    // The same list, kept under the same key, as the shared picker's.
    const catalogue = createCatalogue({ client, kv: sqliteKv, key: `catalogue.${userId}`, path: state.phase === "ready" ? catalogueRoute(state.user) : "/api/inventory/ingredients" });
    return createStockStore({ api: createStockApi(client), catalogue, kv: sqliteKv, outbox, userId, locationId, canSeeQty, kick: runner.kick, now: Date.now, newId: newUuid });
  }, [locationId, canSeeQty]);
  useEffect(() => {
    void store.refresh();
    return () => store.dispose();
  }, [store]);
  return <StockContext.Provider value={store}>{children}</StockContext.Provider>;
}

/** The stock store and its current snapshot, re-rendering on every change. */
export function useStock() {
  const store = useContext(StockContext);
  if (!store) throw new Error("useStock must be used inside StockProvider");
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { store, snap };
}

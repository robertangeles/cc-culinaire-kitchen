import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { client } from "../runtime/appContext";
import { currentUserId, outbox, runner } from "../runtime/appOutbox";
import { newUuid } from "../outbox/uuid";
import { sqliteKv } from "../storage/kv";
import { createStockApi } from "./stockApi";
import { createStockStore, type StockStore } from "./stockStore";

const StockContext = createContext<StockStore | null>(null);

/** One stock store per location and account, loading the dashboard as soon as it exists. */
export function StockProvider({ locationId, canSeeQty, children }: { locationId: string; canSeeQty: boolean; children: ReactNode }) {
  const store = useMemo(
    () => createStockStore({ api: createStockApi(client), kv: sqliteKv, outbox, userId: currentUserId() ?? -1, locationId, canSeeQty, kick: runner.kick, now: Date.now, newId: newUuid }),
    [locationId, canSeeQty],
  );
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

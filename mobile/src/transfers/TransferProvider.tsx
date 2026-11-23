import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { client, session } from "../runtime/appContext";
import { currentUserId, outbox, runner } from "../runtime/appOutbox";
import { catalogueRoute, createCatalogue } from "../ingredients/catalogue";
import { createRecents } from "../ingredients/recents";
import { createIngredientSource, type IngredientSource, type PickedIngredient } from "../ingredients/source";
import { newUuid } from "../outbox/uuid";
import { sqliteKv } from "../storage/kv";
import { createTransferApi } from "./transferApi";
import { createTransferStore, type TransferStore } from "./transferStore";

interface Ctx {
  store: TransferStore;
  source: IngredientSource;
}
const TransferContext = createContext<Ctx | null>(null);

/** One transfer store per location and account, loading the list as soon as it exists. */
export function TransferProvider({ locationId, locationName, userName, children }: { locationId: string; locationName: string; userName: string; children: ReactNode }) {
  const ctx = useMemo<Ctx>(() => {
    const userId = currentUserId() ?? -1;
    const recents = createRecents<PickedIngredient>({ kv: sqliteKv, key: `transfers.recents.${userId}`, max: 12 });
    const state = session.getSnapshot().state;
    const catalogue = createCatalogue({ client, kv: sqliteKv, key: `catalogue.${userId}`, path: state.phase === "ready" ? catalogueRoute(state.user) : "/api/inventory/ingredients" });
    void catalogue.refresh(); // in the background: the picker reads what is on the phone and never waits for this
    return {
      store: createTransferStore({ api: createTransferApi(client), kv: sqliteKv, outbox, userId, userName, locationId, locationName, kick: runner.kick, now: Date.now, newId: newUuid }),
      source: createIngredientSource({ catalogue, recents }),
    };
  }, [locationId, locationName, userName]);
  useEffect(() => {
    void ctx.store.refresh();
    return () => ctx.store.dispose();
  }, [ctx]);
  return <TransferContext.Provider value={ctx}>{children}</TransferContext.Provider>;
}

/** The transfer store, the picker's source and the store's current snapshot, re-rendering on every change. */
export function useTransfers() {
  const ctx = useContext(TransferContext);
  if (!ctx) throw new Error("useTransfers must be used inside TransferProvider");
  const snap = useSyncExternalStore(ctx.store.subscribe, ctx.store.getSnapshot);
  return { store: ctx.store, source: ctx.source, snap };
}

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { client } from "../runtime/appContext";
import { currentUserId, outbox, runner } from "../runtime/appOutbox";
import { createCatalogue } from "../ingredients/catalogue";
import { createRecents } from "../ingredients/recents";
import { createIngredientSource, type IngredientSource } from "../ingredients/source";
import { newUuid } from "../outbox/uuid";
import { sqliteKv } from "../storage/kv";
import { createMovementApi } from "./movementApi";
import { createMovementStore, type MovementRecent, type MovementStore } from "./movementStore";

interface Ctx {
  store: MovementStore;
  source: IngredientSource;
}
const MovementContext = createContext<Ctx | null>(null);

/** One moves store per location and account, loading the areas and the latest moves as soon as it exists. */
export function MovementProvider({ locationId, userName, children }: { locationId: string; userName: string; children: ReactNode }) {
  const ctx = useMemo<Ctx>(() => {
    const userId = currentUserId() ?? -1;
    const recents = createRecents<MovementRecent>({ kv: sqliteKv, key: `movements.recents.${userId}`, max: 12 });
    const catalogue = createCatalogue({ client, kv: sqliteKv, key: `catalogue.${userId}` });
    void catalogue.refresh(); // in the background: the picker reads what is on the phone and never waits for this
    return {
      store: createMovementStore({ api: createMovementApi(client), kv: sqliteKv, outbox, recents, userId, userName, locationId, kick: runner.kick, now: Date.now, newId: newUuid }),
      source: createIngredientSource({ catalogue, recents }),
    };
  }, [locationId, userName]);
  useEffect(() => {
    void ctx.store.refresh();
    return () => ctx.store.dispose();
  }, [ctx]);
  return <MovementContext.Provider value={ctx}>{children}</MovementContext.Provider>;
}

/** The moves store, the picker's source and the store's current snapshot, re-rendering on every change. */
export function useMovements() {
  const ctx = useContext(MovementContext);
  if (!ctx) throw new Error("useMovements must be used inside MovementProvider");
  const snap = useSyncExternalStore(ctx.store.subscribe, ctx.store.getSnapshot);
  return { store: ctx.store, source: ctx.source, snap };
}

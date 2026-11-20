import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { client } from "./appContext";
import { currentUserId, outbox, runner } from "./appOutbox";
import { createCountApi } from "../count/countApi";
import { createCountStore, type CountStore } from "../count/countStore";
import { sqliteKv } from "../storage/kv";

const Ctx = createContext<CountStore | null>(null);

/** One count store per location, downloading the open stock take as soon as it exists. */
export function CountProvider({ locationId, children }: { locationId: string; children: ReactNode }) {
  const store = useMemo(
    () =>
      createCountStore({
        api: createCountApi(client),
        kv: sqliteKv,
        outbox,
        getUserId: () => currentUserId() ?? -1,
        locationId,
        kick: runner.kick,
      }),
    [locationId],
  );
  useEffect(() => {
    void store.refresh();
    return () => store.dispose();
  }, [store]);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/** The count store and its current snapshot, re-rendering on every change. */
export function useCount() {
  const store = useContext(Ctx);
  if (!store) throw new Error("useCount must be used inside CountProvider");
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { store, snap };
}

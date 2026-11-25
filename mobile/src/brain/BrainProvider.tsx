import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { client } from "../runtime/appContext";
import { sqliteKv } from "../storage/kv";
import { createBrainApi, type BrainApi } from "./brainApi";
import { createBrainStore, type BrainStore } from "./brainStore";

interface Ctx {
  api: BrainApi;
  store: BrainStore;
}
const BrainContext = createContext<Ctx | null>(null);

/** Your Brain belongs to the person, not the location: one store per account. */
export function BrainProvider({ userId, api, children }: { userId: number; api?: BrainApi; children: ReactNode }) {
  const ctx = useMemo<Ctx>(() => {
    const brainApi = api ?? createBrainApi(client);
    return { api: brainApi, store: createBrainStore({ api: brainApi, kv: sqliteKv, userId, now: () => new Date().toISOString() }) };
  }, [api, userId]);
  return <BrainContext.Provider value={ctx}>{children}</BrainContext.Provider>;
}

/** The memories, their store and the routes, re-rendering on every change. */
export function useBrain() {
  const ctx = useContext(BrainContext);
  if (!ctx) throw new Error("useBrain must be used inside BrainProvider");
  return { ...ctx, snap: useSyncExternalStore(ctx.store.subscribe, ctx.store.getSnapshot) };
}

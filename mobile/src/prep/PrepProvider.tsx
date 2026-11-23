import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { client } from "../runtime/appContext";
import { currentUserId, outbox, runner } from "../runtime/appOutbox";
import { newUuid } from "../outbox/uuid";
import { sqliteKv } from "../storage/kv";
import { createPrepApi } from "./prepApi";
import { createPrepStore, type PrepStore } from "./prepStore";

/** How often the list is read again while the app is open: other cooks tick the same list, and nothing pushes to the phone. */
const POLL_MS = 30_000;

const PrepContext = createContext<{ store: PrepStore; canPlan: boolean } | null>(null);

/** One prep store per location and account, reading today's list now, when the app wakes, and every 30 seconds. `canPlan` is `prep:manage`. */
export function PrepProvider({ locationId, canPlan, children }: { locationId: string; canPlan: boolean; children: ReactNode }) {
  const store = useMemo(() => createPrepStore({ api: createPrepApi(client), kv: sqliteKv, outbox, getUserId: () => currentUserId() ?? -1, locationId, kick: runner.kick, now: Date.now, newId: newUuid }), [locationId]);
  useEffect(() => {
    void store.refresh();
    const timer = setInterval(() => void store.refresh(), POLL_MS);
    const wake = AppState.addEventListener("change", (s) => s === "active" && void store.refresh());
    return () => {
      clearInterval(timer);
      wake.remove();
      store.dispose();
    };
  }, [store]);
  const value = useMemo(() => ({ store, canPlan }), [store, canPlan]);
  return <PrepContext.Provider value={value}>{children}</PrepContext.Provider>;
}

/** The prep store, whether this person may make the list, and the store's current snapshot, re-rendering on every change. */
export function usePrep() {
  const ctx = useContext(PrepContext);
  if (!ctx) throw new Error("usePrep must be used inside PrepProvider");
  const snap = useSyncExternalStore(ctx.store.subscribe, ctx.store.getSnapshot);
  return { store: ctx.store, canPlan: ctx.canPlan, snap };
}

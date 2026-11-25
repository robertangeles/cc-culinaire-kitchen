import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { client } from "../runtime/appContext";
import { newUuid } from "../outbox/uuid";
import { createBenchApi, type BenchApi, type Room } from "./benchApi";
import { createBenchLive, type LiveSocket } from "./benchLive";
import { createBenchStore, type BenchStore } from "./benchStore";
import { nativeSocket } from "./nativeLive";

interface Ctx {
  api: BenchApi;
  store: BenchStore;
  live: ReturnType<typeof createBenchLive>;
}
const BenchContext = createContext<Ctx | null>(null);

/**
 * The Bench, one per account, in memory only. Connected while the tab is in view and the app is in front: leaving the tab or the app disconnects,
 * coming back connects and reads what was missed. Signing out takes the tab, and this with it, away.
 */
export function BenchProvider({ userId, api, socket, children }: { userId: number; api?: BenchApi; socket?: LiveSocket; children: ReactNode }) {
  const ctx = useMemo<Ctx>(() => {
    const benchApi = api ?? createBenchApi(client);
    const live = createBenchLive({ socket: socket ?? nativeSocket(), renew: () => benchApi.channels() });
    return { api: benchApi, live, store: createBenchStore({ api: benchApi, live, userId, now: Date.now, newId: newUuid }) };
  }, [api, socket, userId]);
  useEffect(
    () => () => {
      ctx.store.dispose();
      ctx.live.stop();
    },
    [ctx],
  );
  useFocusEffect(
    useCallback(() => {
      if (AppState.currentState !== "background") ctx.live.start();
      // "inactive" (the app switcher, a call banner, the lock prompt) is left alone: iOS passes through it all the time.
      const sub = AppState.addEventListener("change", (s) => {
        if (s === "active") ctx.live.start();
        else if (s === "background") ctx.live.stop();
      });
      return () => {
        sub.remove();
        ctx.live.stop();
      };
    }, [ctx]),
  );
  return <BenchContext.Provider value={ctx}>{children}</BenchContext.Provider>;
}

export function useBench() {
  const ctx = useContext(BenchContext);
  if (!ctx) throw new Error("bench screens must be inside BenchProvider");
  return { ...ctx, snap: useSyncExternalStore(ctx.store.subscribe, ctx.store.getSnapshot), status: useSyncExternalStore(ctx.live.subscribe, ctx.live.getStatus) };
}

/** Opens a room while the screen showing it is in view, and leaves it after. */
export function useRoom(room: Room | null) {
  const { store, snap, ...rest } = useBench();
  const key = JSON.stringify(room);
  useFocusEffect(
    useCallback(() => {
      const open = JSON.parse(key) as Room | null;
      if (!open) return;
      void store.open(open);
      return () => store.close(open);
    }, [store, key]),
  );
  return { store, snap, ...rest };
}

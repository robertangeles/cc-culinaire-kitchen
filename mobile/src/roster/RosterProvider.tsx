import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { client } from "../runtime/appContext";
import { lockedCache, useAfterUnlock } from "../runtime/lockedCache";
import { createAvailabilityStore, type AvailabilityStore } from "./availabilityStore";
import { createRosterApi } from "./rosterApi";
import { createRosterStore, type RosterStore } from "./rosterStore";

export interface RosterCtx {
  roster: RosterStore;
  availability: AvailabilityStore;
}

const RosterContext = createContext<RosterCtx | null>(null);

/** The roster module: my shifts, the open swaps and my availability, shared by its screens. The last answers are sealed on the phone (`lockedCache`). */
export function RosterProvider({ userId, children }: { userId: number; children: ReactNode }) {
  const ctx = useMemo(() => {
    const api = createRosterApi(client);
    return { roster: createRosterStore({ api, now: Date.now, cache: lockedCache }), availability: createAvailabilityStore(api, lockedCache) };
  }, [userId]);
  useAfterUnlock(useCallback(() => [ctx.roster, ctx.availability].forEach((s) => s.getSnapshot().phase === "failed" && void s.refresh()), [ctx]));
  return <RosterContext.Provider value={ctx}>{children}</RosterContext.Provider>;
}

/** Test seam: the screens on stores the test made. */
export const RosterContextProvider = RosterContext.Provider;

function useCtx(): RosterCtx {
  const ctx = useContext(RosterContext);
  if (!ctx) throw new Error("roster screens must be inside RosterProvider");
  return ctx;
}

export function useRoster() {
  const { roster } = useCtx();
  return { store: roster, snap: useSyncExternalStore(roster.subscribe, roster.getSnapshot) };
}

export function useAvailability() {
  const { availability } = useCtx();
  return { store: availability, snap: useSyncExternalStore(availability.subscribe, availability.getSnapshot) };
}

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { client } from "../runtime/appContext";
import { createAvailabilityStore, type AvailabilityStore } from "./availabilityStore";
import { createRosterApi } from "./rosterApi";
import { createRosterStore, type RosterStore } from "./rosterStore";

export interface RosterCtx {
  roster: RosterStore;
  availability: AvailabilityStore;
}

const RosterContext = createContext<RosterCtx | null>(null);

/** The roster module: my shifts, the open swaps and my availability, shared by its screens. Held in memory; gone when the account signs out. */
export function RosterProvider({ userId, children }: { userId: number; children: ReactNode }) {
  const ctx = useMemo(() => {
    const api = createRosterApi(client);
    return { roster: createRosterStore({ api, now: Date.now }), availability: createAvailabilityStore(api) };
  }, [userId]);
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

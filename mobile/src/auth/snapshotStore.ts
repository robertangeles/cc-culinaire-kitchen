import type { KvStore } from "../storage/kv";
import type { Snapshot } from "./session";

const KEY = "session.snapshot";

/** Keeps the last known user and location so the app can open with no signal. Cleared on sign-out. */
export function createSnapshotStore(kv: KvStore) {
  return {
    async load(): Promise<Snapshot | null> {
      const raw = await kv.get(KEY);
      return raw ? (JSON.parse(raw) as Snapshot) : null;
    },
    async save(snapshot: Snapshot | null): Promise<void> {
      if (snapshot) await kv.set(KEY, JSON.stringify(snapshot));
      else await kv.delete(KEY);
    },
  };
}

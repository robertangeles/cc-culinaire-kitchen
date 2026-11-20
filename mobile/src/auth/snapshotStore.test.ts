import { describe, it, expect } from "vitest";
import { createSnapshotStore } from "./snapshotStore";
import type { KvStore } from "../storage/kv";
import type { Snapshot } from "./session";

function memoryKv(): KvStore {
  const m = new Map<string, string>();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k) };
}

const snap: Snapshot = {
  user: { userId: 1, userName: "Chef", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions: ["inventory:count"] },
  location: { storeLocationId: "L1", organisationId: 1, locationName: "Main", classification: "branch" },
  locations: [{ storeLocationId: "L1", organisationId: 1, locationName: "Main", classification: "branch" }],
};

describe("snapshot store", () => {
  it("returns nothing before anything is saved, then what was saved, then nothing after clearing", async () => {
    const store = createSnapshotStore(memoryKv());
    expect(await store.load()).toBeNull();
    await store.save(snap);
    expect(await store.load()).toEqual(snap);
    await store.save(null);
    expect(await store.load()).toBeNull();
  });
});

import { describe, it, expect, vi } from "vitest";
import type { AuthUser, StoreLocation } from "../api/auth";
import type { SessionState } from "../auth/session";
import type { KvStore } from "../storage/kv";
import { createLockedCache, type Cipher } from "./lockedCache";

const person = (userId: number, permissions = ["roster:read-own", "compliance:read-own"]): AuthUser => ({ userId, userName: "Cook", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions });
const kitchen = (storeLocationId: string): StoreLocation => ({ storeLocationId, organisationId: 1, locationName: storeLocationId, classification: "branch", ianaTimezone: "Australia/Melbourne" });
const ready = (user: AuthUser, location = "L1"): SessionState => ({ phase: "ready", user, location: kitchen(location), locations: [kitchen(location)] });
/** What a store's schema does: the rows, or a throw. */
const Rows = { parse: (data: unknown) => { if (!Array.isArray(data) || !data.every((r) => typeof r?.name === "string")) throw new Error("not rows"); return data as { name: string }[]; } };
const Numbers = { parse: (data: unknown) => { if (!Array.isArray(data) || !data.every((n) => typeof n === "number")) throw new Error("not numbers"); return data as number[]; } };

/** Real AES-GCM (the platform's WebCrypto), standing in for the phone's native one. */
const webCipher: Cipher = {
  async newKey() {
    return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
  },
  async seal(text, key, context) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await crypto.subtle.importKey("raw", Buffer.from(key, "base64"), "AES-GCM", false, ["encrypt"]);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) }, k, new TextEncoder().encode(text));
    return Buffer.concat([iv, new Uint8Array(ct)]).toString("base64");
  },
  async open(sealed, key, context) {
    const bytes = Buffer.from(sealed, "base64");
    const k = await crypto.subtle.importKey("raw", Buffer.from(key, "base64"), "AES-GCM", false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: new TextEncoder().encode(context) }, k, bytes.subarray(12));
    return new TextDecoder().decode(pt);
  },
};

function setup() {
  const rows = new Map<string, string>();
  const kv: KvStore = { get: async (k) => rows.get(k) ?? null, set: async (k, v) => void rows.set(k, v), delete: async (k) => void rows.delete(k) };
  const secret = { value: null as string | null, failSave: false };
  const secrets = {
    get: vi.fn(async () => secret.value),
    set: vi.fn(async (v: string) => {
      if (secret.failSave) throw new Error("no passcode set");
      secret.value = v;
    }),
    delete: vi.fn(async () => void (secret.value = null)),
  };
  const state = { session: ready(person(1)) as SessionState, unlocked: 1 as number | null };
  const cache = createLockedCache({ kv, secrets, cipher: webCipher, session: () => state.session, unlockedUserId: () => state.unlocked, now: () => "2026-11-26T08:00:00.000Z" });
  /** As a store does: who it is for is taken before the request goes out. */
  const save = (name: Parameters<typeof cache.write>[0], data: unknown) => cache.write(name, cache.owner(), data);
  return { rows, secret, secrets, state, cache, save };
}

describe("the locked cache", () => {
  it("keeps the last answer sealed on the phone and gives it back with when it was saved", async () => {
    const t = setup();
    await t.save("roster", [{ name: "Friday close" }]);
    expect([...t.rows.keys()]).toEqual(["locked.roster"]);
    expect(t.rows.get("locked.roster")).not.toContain("Friday close");
    expect(t.secret.value).not.toContain("Friday close");
    expect(await t.cache.read("roster", Rows)).toEqual({ at: "2026-11-26T08:00:00.000Z", data: [{ name: "Friday close" }] });
  });

  it("is never read before the app lock is passed by this person", async () => {
    const t = setup();
    await t.save("documents", [{ name: "RSA" }]);
    t.state.unlocked = null;
    expect(await t.cache.read("documents", Rows)).toBeNull();
    t.state.unlocked = 2;
    expect(await t.cache.read("documents", Rows)).toBeNull();
    t.state.unlocked = 1;
    expect(await t.cache.read("documents", Rows)).toMatchObject({ data: [{ name: "RSA" }] });
  });

  it("is never read without the permission its screen needs", async () => {
    const t = setup();
    await t.save("documents", [{ name: "RSA" }]);
    t.state.session = ready(person(1, ["roster:read-own"]));
    expect(await t.cache.read("documents", Rows)).toBeNull();
  });

  it("is emptied, key and all, at sign-out and when the account is deleted", async () => {
    for (const phase of ["signedOut", "accountDeleted"] as const) {
      const t = setup();
      await t.save("roster", [{ name: "Friday close" }]);
      await t.cache.follow({ phase });
      expect(t.rows.size).toBe(0);
      expect(t.secret.value).toBeNull();
    }
  });

  it("is emptied when another account or another kitchen opens, and not when the same one comes back", async () => {
    const t = setup();
    await t.save("roster", [{ name: "Friday close" }]);
    await t.cache.follow(ready(person(1)));
    expect(t.rows.size).toBe(1);
    t.state.session = ready(person(1), "L2");
    await t.cache.follow(t.state.session);
    expect(t.rows.size).toBe(0);
    await t.save("roster", [{ name: "Saturday open" }]);
    expect(t.rows.size).toBe(1);
    t.state.session = ready(person(2), "L2");
    await t.cache.follow(t.state.session);
    expect(t.rows.size).toBe(0);
    expect(t.secret.value).toBeNull();
  });

  it("keeps it while the kitchen is being chosen, since that can be cancelled", async () => {
    const t = setup();
    await t.save("roster", [{ name: "Friday close" }]);
    await t.cache.follow({ phase: "chooseLocation", user: person(1), locations: [kitchen("L1"), kitchen("L2")], current: kitchen("L1") });
    expect(t.rows.size).toBe(1);
  });

  it("drops a screen's copy when the account loses its permission, and keeps the others", async () => {
    const t = setup();
    await t.save("roster", [{ name: "Friday close" }]);
    await t.save("availability", [{ name: "Mondays" }]);
    await t.save("documents", [{ name: "RSA" }]);
    await t.cache.follow(ready(person(1, ["compliance:read-own"])));
    expect([...t.rows.keys()]).toEqual(["locked.documents"]);
  });

  it("is emptied when the phone no longer has a screen lock", async () => {
    const t = setup();
    await t.save("roster", [{ name: "Friday close" }]);
    await t.cache.followLock({ problem: "failed" });
    expect(t.rows.size).toBe(1);
    await t.cache.followLock({ problem: "unprotected" });
    expect(t.rows.size).toBe(0);
    expect(t.secret.value).toBeNull();
  });

  it("does not save an answer that arrives after its account or kitchen changed", async () => {
    const t = setup();
    const owner = t.cache.owner();
    t.state.session = ready(person(1), "L2");
    await t.cache.write("roster", owner, [{ name: "Friday close" }]);
    t.state.session = { phase: "signedOut" };
    await t.cache.write("roster", owner, [{ name: "Friday close" }]);
    expect(t.rows.size).toBe(0);
  });

  it("saves nothing when the key cannot be kept (an iPhone with no passcode)", async () => {
    const t = setup();
    t.secret.failSave = true;
    await t.save("roster", [{ name: "Friday close" }]);
    expect(t.rows.size).toBe(0);
  });

  it("gives nothing back for a copy it cannot open or read", async () => {
    const t = setup();
    await t.save("roster", [{ name: "Friday close" }]);
    t.rows.set("locked.availability", t.rows.get("locked.roster")!);
    expect(await t.cache.read("availability", Rows)).toBeNull();
    expect(await t.cache.read("roster", Numbers)).toBeNull();
    t.rows.set("locked.roster", "not sealed");
    expect(await t.cache.read("roster", Rows)).toBeNull();
  });

  it("removes one screen's copy", async () => {
    const t = setup();
    await t.save("roster", [{ name: "Friday close" }]);
    await t.cache.remove("roster");
    expect(await t.cache.read("roster", Rows)).toBeNull();
  });
});

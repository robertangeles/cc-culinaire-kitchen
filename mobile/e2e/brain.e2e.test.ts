import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApiClient, type Tokens } from "../src/api/client";
import { createAuthApi } from "../src/api/auth";
import { createAccountApi } from "../src/api/account";
import { createBrainApi } from "../src/brain/brainApi";
import { createBrainStore } from "../src/brain/brainStore";
import { SOURCES } from "../src/brain/brainView";

/**
 * Your Brain against a real server, with the phone's own code and no UI: a person who just registered (`brain:read` and `brain:manage` come
 * with the role) reads both tiers with every filter, is told when a memory is not there to remove, and switches nudges on and off.
 * A memory cannot be made through the API (the server writes them itself, when its Brain flags are on), so listing and removing real ones
 * is the screenshot walk's (`device/screens.device.test.ts`). Needs the server on E2E_API_URL. Skipped locally without E2E credentials.
 */
const baseUrl = process.env.E2E_API_URL ?? "http://localhost:3009";
const email = `ph-brain-${Date.now().toString(36)}@culinaire.test`;
const PASSWORD = "Phone-Brain-Pass-1!";

describe.skipIf(!process.env.CI && !process.env.E2E_USER_EMAIL)("Your Brain against the real server", () => {
  let tokens: Tokens | null = null;
  const tokenStore = { load: async () => tokens, save: async (t: Tokens) => void (tokens = t), clear: async () => void (tokens = null) };
  const client = createApiClient({ baseUrl, tokenStore, appVersion: "0.1.0-e2e", timeoutMs: 20_000 });
  const authApi = createAuthApi(client, tokenStore);
  const api = createBrainApi(client);
  const kvMap = new Map<string, string>();
  const kv = { get: async (k: string) => kvMap.get(k) ?? null, set: async (k: string, v: string) => void kvMap.set(k, v), delete: async (k: string) => void kvMap.delete(k) };
  let store: ReturnType<typeof createBrainStore>;

  beforeAll(async () => {
    await authApi.register("Phone Brain", email, PASSWORD);
    const result = await authApi.signIn(email, PASSWORD);
    if (result.status !== "signedIn") throw new Error("expected a plain sign-in");
    store = createBrainStore({ api, kv, userId: result.user.userId, now: () => new Date().toISOString() });
  });

  afterAll(async () => {
    if (tokens) await createAccountApi(client, tokenStore).deleteAccount({ password: PASSWORD }).catch(() => {});
  });

  it("reads both tiers, and the server takes every filter the screen offers", async () => {
    await store.refresh();
    expect(store.getSnapshot()).toMatchObject({ phase: "ready", items: [], total: 0, error: null });
    await store.setFilter({ scope: "org" });
    expect(store.getSnapshot()).toMatchObject({ phase: "ready", error: null });
    for (const { value } of SOURCES) {
      await store.setFilter({ sourceType: value, search: "salt & 100% oil" });
      expect(store.getSnapshot()).toMatchObject({ phase: "ready", items: [], error: null });
    }
  });

  it("says a memory that is not there (or not theirs) cannot be removed", async () => {
    expect(await store.remove("11111111-1111-4111-8111-111111111111")).toBe("That memory was already removed, or is no longer yours to remove.");
  });

  it("switches nudges on and off", async () => {
    expect(await api.nudges()).toBe(false);
    expect(await api.setNudges(true)).toBe(true);
    expect(await api.nudges()).toBe(true);
    await api.setNudges(false);
    expect(await api.nudges()).toBe(false);
  });
});

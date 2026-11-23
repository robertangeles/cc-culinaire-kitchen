import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApiClient, type Tokens } from "../src/api/client";
import { createAuthApi } from "../src/api/auth";
import { createAccountApi } from "../src/api/account";
import { createLegalApi } from "../src/legal/legalApi";
import { createSession, type Snapshot } from "../src/auth/session";
import { manager } from "../device/fixtures";

/**
 * The store-plumbing flows against a real server, with the phone's own code and no UI: a person who just registered joins an
 * organisation and a location by key, reads the terms, and deletes their own account. Needs the server on E2E_API_URL
 * (default http://localhost:3009) and the seeded E2E user. Skipped locally without credentials; fails in CI without them.
 */
const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
const totpSecret = process.env.E2E_USER_TOTP_SECRET;
const baseUrl = process.env.E2E_API_URL ?? "http://localhost:3009";

const newEmail = `ph-first-${Date.now().toString(36)}@culinaire.test`;
const NEW_PASSWORD = "Phone-First-Run-Pass-1!";

describe.skipIf(!process.env.CI && (!email || !password || !totpSecret))("store plumbing against the real server", () => {
  let tokens: Tokens | null = null;
  let snapshot: Snapshot | null = null;
  let upgrade: unknown;
  let wiped = false;
  const tokenStore = { load: async () => tokens, save: async (t: Tokens) => void (tokens = t), clear: async () => void (tokens = null) };
  const client = createApiClient({ baseUrl, tokenStore, appVersion: "0.1.0-e2e", timeoutMs: 20_000, onUpgradeRequired: (b) => void (upgrade = b) });
  const authApi = createAuthApi(client, tokenStore);
  const accountApi = createAccountApi(client, tokenStore);
  const session = createSession({
    api: authApi,
    hasTokens: async () => tokens !== null,
    snapshots: { load: async () => snapshot, save: async (s) => void (snapshot = s) },
    wipeLocalData: async () => void (wiped = true),
  });
  const state = () => session.getSnapshot().state;

  let joinKey = "";
  let storeKey = "";
  let storeLocationId = "";
  let organisationId = 0;

  beforeAll(async () => {
    // The manager (the E2E user) reads the two keys a manager would hand out.
    const m = manager();
    await m.signIn();
    const org = await m.client.request<{ organisation: { organisationId: number; joinKey: string } }>("GET", "/api/organisations/mine");
    joinKey = org.organisation.joinKey;
    organisationId = org.organisation.organisationId;
    const locations = await m.client.request<{ locations: Array<{ storeLocationId: string }> }>("GET", "/api/store-locations/mine");
    storeLocationId = locations.locations[0].storeLocationId;
    storeKey = (await m.client.request<{ storeLocation: { storeKey: string } }>("GET", `/api/store-locations/${storeLocationId}`)).storeLocation.storeKey;
    await authApi.register("Phone First Run", newEmail, NEW_PASSWORD);
  });

  afterAll(async () => {
    // If the delete test did not run to the end, the new account is still there: remove it the way the app does.
    if (tokens) await accountApi.deleteAccount({ password: NEW_PASSWORD }).catch(() => {});
  });

  it("serves the legal pages without a sign-in: published text shows, a draft is unavailable (never an empty page)", async () => {
    const legal = createLegalApi(client);
    const result = await legal.load("terms");
    expect(["ok", "unavailable"]).toContain(result.status); // depends on whether the owner has published it in this database
    expect(upgrade).toBeUndefined();
  });

  it("sends a just-registered person with no organisation to the first-run screen", async () => {
    await session.signIn(newEmail, NEW_PASSWORD);
    expect(state()).toMatchObject({ phase: "firstRun", organisationId: null });
  });

  it("explains a wrong organisation key from the server's code, and stays on the screen", async () => {
    await session.joinOrganisation("CULINAIRE-NOTAREALKEY");
    expect(state()).toMatchObject({ phase: "firstRun", organisationId: null, error: "That key wasn't found. Check it with your manager." });
  });

  it("joins the organisation, then explains a wrong location key", async () => {
    await session.joinOrganisation(joinKey);
    expect(state()).toMatchObject({ phase: "firstRun", organisationId });
    expect(state()).not.toHaveProperty("error");
    await session.joinLocation("KITCHEN-NOTAREALKEY");
    expect(state()).toMatchObject({ phase: "firstRun", error: "That key wasn't found. Check it with your manager." });
  });

  it("joins the location with its key and opens the app there", async () => {
    await session.joinLocation(storeKey);
    expect(state()).toMatchObject({ phase: "ready", location: { storeLocationId } });
  });

  it("asks for a password (this account has one), refuses a wrong one by code, and keeps the account", async () => {
    expect(await accountApi.facts()).toMatchObject({ hasPassword: true, mfaEnabled: false });
    await expect(accountApi.deleteAccount({ password: "not-the-password" })).rejects.toMatchObject({ code: "forbidden", serverCode: "INVALID_CREDENTIALS" });
    expect(await authApi.me()).toMatchObject({ userEmail: newEmail });
  });

  it("deletes the account, clears the phone, shows the result, and the account can no longer sign in", async () => {
    await accountApi.deleteAccount({ password: NEW_PASSWORD });
    await session.accountDeleted();
    expect(state()).toEqual({ phase: "accountDeleted" });
    expect(tokens).toBeNull();
    expect(snapshot).toBeNull();
    expect(wiped).toBe(true);
    session.leaveDeletedAccount();
    await session.signIn(newEmail, NEW_PASSWORD);
    expect(state()).toMatchObject({ phase: "signedOut", error: "Email or password is wrong." });
  });
});

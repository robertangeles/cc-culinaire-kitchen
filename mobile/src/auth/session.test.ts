import { describe, it, expect, vi } from "vitest";
import { createSession, type Snapshot } from "./session";
import { ApiError } from "../api/client";
import type { AppleCredential, AuthApi, AuthUser, LocationContext, StoreLocation } from "../api/auth";

const counter: AuthUser = { userId: 1, userName: "Chef", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions: ["inventory:count"] };
const admin: AuthUser = { ...counter, roles: ["Administrator"], permissions: [] };
const bystander: AuthUser = { ...counter, permissions: ["chat:access"] };
const loc = (id: string): StoreLocation => ({ storeLocationId: id, organisationId: 1, locationName: `Loc ${id}`, classification: "branch" });
const ctx = (locations: StoreLocation[], selectedLocationId: string | null = null): LocationContext => ({ locations, selectedLocationId, organisationId: 1, isOrgAdmin: false, hasLocationAccess: locations.length > 0 });

function setup(overrides: Partial<Record<keyof AuthApi, unknown>> = {}, googleIdToken?: () => Promise<string | null>, appleCredential?: () => Promise<AppleCredential | null>) {
  const api = {
    signIn: vi.fn(async () => ({ status: "signedIn" as const, user: counter })),
    googleSignIn: vi.fn(async () => ({ status: "signedIn" as const, user: counter })),
    appleSignIn: vi.fn(async () => ({ status: "signedIn" as const, user: counter })),
    verifyMfa: vi.fn(async () => counter),
    me: vi.fn(async () => counter),
    signOut: vi.fn(async () => {}),
    locationContext: vi.fn(async () => ctx([loc("L1")], "L1")),
    selectLocation: vi.fn(async () => {}),
    joinOrganisation: vi.fn(async () => {}),
    joinLocation: vi.fn(async () => {}),
    ...overrides,
  };
  const hasTokens = vi.fn(async () => true);
  let saved: Snapshot | null = null;
  const snapshots = { load: vi.fn(async () => saved), save: vi.fn(async (s: Snapshot | null) => void (saved = s)) };
  const session = createSession({ api: api as unknown as AuthApi, hasTokens, snapshots, googleIdToken, appleCredential });
  return { session, api: api as Record<keyof AuthApi, ReturnType<typeof vi.fn>>, hasTokens, snapshots, setSaved: (s: Snapshot | null) => void (saved = s) };
}

const state = (s: ReturnType<typeof setup>["session"]) => s.getSnapshot().state;

describe("restoring a saved session", () => {
  it("goes straight to ready when tokens are valid and a location is selected", async () => {
    const { session } = setup();
    await session.restore();
    expect(state(session)).toMatchObject({ phase: "ready", user: counter, location: { storeLocationId: "L1" } });
  });

  it("shows sign-in when there are no tokens, without calling the server", async () => {
    const { session, api, hasTokens } = setup();
    hasTokens.mockResolvedValueOnce(false);
    await session.restore();
    expect(state(session)).toEqual({ phase: "signedOut" });
    expect(api.me).not.toHaveBeenCalled();
  });

  it("shows sign-in when the server refuses the saved session", async () => {
    const { session } = setup({ me: vi.fn(async () => { throw new ApiError("unauthorized"); }) });
    await session.restore();
    expect(state(session)).toEqual({ phase: "signedOut" });
  });

  it("opens offline from the last known user and location when the server can't be reached", async () => {
    const { session, setSaved } = setup({ me: vi.fn(async () => { throw new ApiError("network"); }) });
    setSaved({ user: counter, location: loc("L1"), locations: [loc("L1"), loc("L2")] });
    await session.restore();
    expect(state(session)).toEqual({ phase: "ready", user: counter, location: loc("L1"), locations: [loc("L1"), loc("L2")], offline: true });
  });

  it("does not open offline for a session the server has refused", async () => {
    const { session, setSaved } = setup({ me: vi.fn(async () => { throw new ApiError("unauthorized"); }) });
    setSaved({ user: counter, location: loc("L1"), locations: [loc("L1")] });
    await session.restore();
    expect(state(session)).toEqual({ phase: "signedOut" });
  });

  it("remembers the user and location each time it opens, and forgets them on sign-out", async () => {
    const { session, snapshots } = setup();
    await session.restore();
    expect(snapshots.save).toHaveBeenCalledWith({ user: counter, location: loc("L1"), locations: [loc("L1")] });
    await session.signOut();
    expect(snapshots.save).toHaveBeenLastCalledWith(null);
  });

  it("shows sign-in instead of hanging when the secure store itself fails", async () => {
    const { session, hasTokens } = setup();
    hasTokens.mockRejectedValueOnce(new Error("keystore reset"));
    await session.restore();
    expect(state(session)).toEqual({ phase: "signedOut" });
  });

  it("explains an unreachable server on the sign-in screen and keeps the tokens (no signOut call)", async () => {
    const { session, api } = setup({ me: vi.fn(async () => { throw new ApiError("network"); }) });
    await session.restore();
    expect(state(session)).toEqual({ phase: "signedOut", error: "Can't reach the server. Try again." });
    expect(api.signOut).not.toHaveBeenCalled();
  });
});

describe("signing in", () => {
  it("lands on ready for a one-location account, selecting the location when none was chosen", async () => {
    const { session, api } = setup({ locationContext: vi.fn(async () => ctx([loc("L1")], null)) });
    await session.signIn("c@x.test", "pw");
    expect(api.selectLocation).toHaveBeenCalledWith("L1");
    expect(state(session)).toMatchObject({ phase: "ready", location: { storeLocationId: "L1" } });
  });

  it("asks which location when there are several and none is selected", async () => {
    const { session } = setup({ locationContext: vi.fn(async () => ctx([loc("L1"), loc("L2")], null)) });
    await session.signIn("c@x.test", "pw");
    expect(state(session)).toMatchObject({ phase: "chooseLocation", locations: [{ storeLocationId: "L1" }, { storeLocationId: "L2" }] });
  });

  it("opens the selected location when several exist and one is already selected", async () => {
    const { session } = setup({ locationContext: vi.fn(async () => ctx([loc("L1"), loc("L2")], "L2")) });
    await session.signIn("c@x.test", "pw");
    expect(state(session)).toMatchObject({ phase: "ready", location: { storeLocationId: "L2" } });
  });

  it("goes to the code step for an MFA account", async () => {
    const { session } = setup({ signIn: vi.fn(async () => ({ status: "mfa" as const, mfaSessionToken: "M" })) });
    await session.signIn("c@x.test", "pw");
    expect(state(session)).toEqual({ phase: "mfa", mfaSessionToken: "M" });
  });

  it.each([
    [new ApiError("unauthorized", "Invalid email or password."), "Email or password is wrong."],
    [new ApiError("network"), "Can't reach the server. Try again."],
    [new ApiError("timeout"), "The server took too long. Try again."],
    [new ApiError("forbidden", "Please verify your email before logging in."), "Please verify your email before logging in."],
    [new ApiError("rate_limited"), "Too many requests. Wait a moment and try again."],
    [new ApiError("upgrade_required"), "Update the app to continue."],
  ])("keeps you on sign-in with a plain sentence for %s", async (err, sentence) => {
    const { session } = setup({ signIn: vi.fn(async () => { throw err; }) });
    await session.signIn("c@x.test", "pw");
    expect(state(session)).toEqual({ phase: "signedOut", error: sentence });
  });

  it("is busy while the request runs and not afterwards", async () => {
    let release: () => void = () => {};
    const { session } = setup({ signIn: vi.fn(() => new Promise((r) => { release = () => r({ status: "signedIn", user: counter }); })) });
    const pending = session.signIn("c@x.test", "pw");
    expect(session.getSnapshot().busy).toBe(true);
    release();
    await pending;
    expect(session.getSnapshot().busy).toBe(false);
  });
});

describe("access rules", () => {
  it("opens the app for any signed-in person with a location, whatever they may count: the shell's tab list decides what they see", async () => {
    for (const person of [bystander, admin, counter]) {
      const { session } = setup({ me: vi.fn(async () => person) });
      await session.restore();
      expect(state(session)).toMatchObject({ phase: "ready", user: person });
    }
  });

  it("sends an account with no location to the first-run screen, still needing an organisation when it has none", async () => {
    const { session } = setup({ locationContext: vi.fn(async () => ({ ...ctx([]), organisationId: null })) });
    await session.restore();
    expect(state(session)).toMatchObject({ phase: "firstRun", user: counter, organisationId: null });
  });

  it("asks only for the location key when the account is already in an organisation", async () => {
    const { session } = setup({ locationContext: vi.fn(async () => ctx([])) });
    await session.restore();
    expect(state(session)).toMatchObject({ phase: "firstRun", organisationId: 1 });
  });
});

describe("MFA, location choice and sign-out", () => {
  it("finishes sign-in with the code", async () => {
    const { session, api } = setup({ signIn: vi.fn(async () => ({ status: "mfa" as const, mfaSessionToken: "M" })) });
    await session.signIn("c@x.test", "pw");
    await session.submitCode("123456");
    expect(api.verifyMfa).toHaveBeenCalledWith("M", "123456");
    expect(state(session)).toMatchObject({ phase: "ready" });
  });

  it("keeps the code step with a message for a wrong code, and restarts for an expired MFA session", async () => {
    const wrong = setup({ signIn: vi.fn(async () => ({ status: "mfa" as const, mfaSessionToken: "M" })), verifyMfa: vi.fn(async () => { throw new ApiError("bad_request", "Invalid code. Please try again."); }) });
    await wrong.session.signIn("c@x.test", "pw");
    await wrong.session.submitCode("000000");
    expect(state(wrong.session)).toEqual({ phase: "mfa", mfaSessionToken: "M", error: "That code didn't work. Try again." });

    const expired = setup({ signIn: vi.fn(async () => ({ status: "mfa" as const, mfaSessionToken: "M" })), verifyMfa: vi.fn(async () => { throw new ApiError("unauthorized", "MFA session expired. Please log in again."); }) });
    await expired.session.signIn("c@x.test", "pw");
    await expired.session.submitCode("123456");
    expect(state(expired.session)).toEqual({ phase: "signedOut", error: "Your sign-in timed out. Start again." });
  });

  it("selects the chosen location and opens it", async () => {
    const { session, api } = setup({ locationContext: vi.fn(async () => ctx([loc("L1"), loc("L2")], null)) });
    await session.signIn("c@x.test", "pw");
    await session.chooseLocation("L2");
    expect(api.selectLocation).toHaveBeenCalledWith("L2");
    expect(state(session)).toMatchObject({ phase: "ready", location: { storeLocationId: "L2" } });
  });

  it("signs out to the sign-in screen", async () => {
    const { session, api } = setup();
    await session.restore();
    await session.signOut();
    expect(api.signOut).toHaveBeenCalled();
    expect(state(session)).toEqual({ phase: "signedOut" });
  });

  it("unregisters this phone's push before the sign-out ends the tokens", async () => {
    const { api } = setup();
    const order: string[] = [];
    api.signOut.mockImplementation(async () => void order.push("signOut"));
    const session = createSession({ api: api as unknown as AuthApi, hasTokens: async () => true, snapshots: { load: async () => null, save: async () => {} }, beforeSignOut: async () => void order.push("unregister") });
    await session.restore();
    await session.signOut();
    expect(order).toEqual(["unregister", "signOut"]);
  });

  it("reads the person again after they change their name, keeping the location", async () => {
    const { session, api, snapshots } = setup();
    await session.restore();
    api.me.mockResolvedValueOnce({ ...counter, userName: "Chef Rob", userPhotoPath: "https://img/x.jpg" });
    await session.refreshUser();
    expect(state(session)).toMatchObject({ phase: "ready", user: { userName: "Chef Rob", userPhotoPath: "https://img/x.jpg" }, location: { storeLocationId: "L1" } });
    expect(snapshots.save).toHaveBeenLastCalledWith(expect.objectContaining({ user: expect.objectContaining({ userName: "Chef Rob" }) }));
    api.me.mockRejectedValueOnce(new ApiError("network"));
    await session.refreshUser();
    expect(state(session)).toMatchObject({ user: { userName: "Chef Rob" } });
  });

  it("returns to sign-in when the server ends the session mid-use", async () => {
    const { session } = setup();
    await session.restore();
    session.sessionExpired();
    expect(state(session)).toEqual({ phase: "signedOut", error: "Your session ended. Sign in again." });
  });

  it("notifies subscribers on every change", async () => {
    const { session } = setup();
    const listener = vi.fn();
    session.subscribe(listener);
    await session.restore();
    expect(listener).toHaveBeenCalled();
  });
});

describe("changing location after sign-in", () => {
  async function readyAt(selected: string, ids = ["L1", "L2"]) {
    const h = setup({ locationContext: vi.fn(async () => ctx(ids.map(loc), selected)) });
    await h.session.restore();
    return h;
  }

  it("goes back to the picker with the current location marked, when the account has several", async () => {
    const { session } = await readyAt("L1");
    session.changeLocation();
    expect(state(session)).toMatchObject({ phase: "chooseLocation", current: { storeLocationId: "L1" }, locations: [{ storeLocationId: "L1" }, { storeLocationId: "L2" }] });
  });

  it("does nothing for an account with one location", async () => {
    const { session } = await readyAt("L1", ["L1"]);
    session.changeLocation();
    expect(state(session).phase).toBe("ready");
  });

  it("Cancel returns to the same location without asking the server", async () => {
    const { session, api } = await readyAt("L1");
    session.changeLocation();
    session.cancelChangeLocation();
    expect(state(session)).toMatchObject({ phase: "ready", location: { storeLocationId: "L1" } });
    expect(api.selectLocation).not.toHaveBeenCalled();
  });

  it("choosing another location selects it on the server and opens it", async () => {
    const { session, api, snapshots } = await readyAt("L1");
    session.changeLocation();
    await session.chooseLocation("L2");
    expect(api.selectLocation).toHaveBeenCalledWith("L2");
    expect(state(session)).toMatchObject({ phase: "ready", location: { storeLocationId: "L2" } });
    expect(snapshots.save).toHaveBeenLastCalledWith(expect.objectContaining({ location: loc("L2") }));
  });

  it("a failed switch keeps the picker open with a sentence, and the old location is still the saved one", async () => {
    const { session } = await readyAt("L1");
    session.changeLocation();
    const failing = setup({ locationContext: vi.fn(async () => ctx([loc("L1"), loc("L2")], "L1")), selectLocation: vi.fn(async () => { throw new ApiError("network"); }) });
    await failing.session.restore();
    failing.session.changeLocation();
    await failing.session.chooseLocation("L2");
    expect(state(failing.session)).toMatchObject({ phase: "chooseLocation", error: "Can't reach the server. Try again.", current: { storeLocationId: "L1" } });
  });
});


describe("signing in with Google", () => {
  it("takes the ID token from the Google account picker and opens the areas like a password sign-in", async () => {
    const { session, api } = setup({}, async () => "ID-TOKEN");
    await session.signInWithGoogle();
    expect(api.googleSignIn).toHaveBeenCalledWith("ID-TOKEN");
    expect(state(session)).toMatchObject({ phase: "ready", user: counter });
  });

  it("does nothing, and says nothing, when the person closes the account picker", async () => {
    const { session, api } = setup({}, async () => null);
    await session.signInWithGoogle();
    expect(api.googleSignIn).not.toHaveBeenCalled();
    expect(state(session)).toEqual({ phase: "restoring" });
    expect(session.getSnapshot().busy).toBe(false);
  });

  it("says plainly when the account picker itself fails", async () => {
    const { session, api } = setup({}, async () => { throw new Error("DEVELOPER_ERROR"); });
    await session.signInWithGoogle();
    expect(api.googleSignIn).not.toHaveBeenCalled();
    expect(state(session)).toEqual({ phase: "signedOut", error: "Google sign-in didn't work. Try again." });
  });

  it("shows the server's reason when it refuses the Google account", async () => {
    const { session } = setup({ googleSignIn: vi.fn(async () => { throw new ApiError("forbidden", "This Google account can't sign in here."); }) }, async () => "ID-TOKEN");
    await session.signInWithGoogle();
    expect(state(session)).toEqual({ phase: "signedOut", error: "This Google account can't sign in here." });
  });

  it("goes to the code step when the account uses MFA", async () => {
    const { session } = setup({ googleSignIn: vi.fn(async () => ({ status: "mfa" as const, mfaSessionToken: "M" })) }, async () => "ID-TOKEN");
    await session.signInWithGoogle();
    expect(state(session)).toMatchObject({ phase: "mfa", mfaSessionToken: "M" });
  });
});

describe("first run: joining by key", () => {
  const noOrg = () => ({ ...ctx([]), organisationId: null });
  const keyError = (serverCode: string, message = "server words") => new ApiError("bad_request", message, 400, undefined, serverCode);

  async function firstRun(overrides: Partial<Record<keyof AuthApi, unknown>> = {}) {
    const s = setup({ locationContext: vi.fn(async () => noOrg()), ...overrides });
    await s.session.restore();
    expect(state(s.session)).toMatchObject({ phase: "firstRun" });
    return s;
  }

  it("joins the organisation, reloads the person and the location list, and asks for the location key next", async () => {
    const { session, api } = await firstRun();
    api.locationContext.mockResolvedValueOnce(ctx([]));
    await session.joinOrganisation("  CULINAIRE-ABC  ");
    expect(api.joinOrganisation).toHaveBeenCalledWith("CULINAIRE-ABC");
    expect(api.me).toHaveBeenCalledTimes(2); // restore, then again so new permissions show
    expect(state(session)).toMatchObject({ phase: "firstRun", organisationId: 1 });
  });

  it("goes to the app once the location key opens a location", async () => {
    const { session, api } = await firstRun();
    api.locationContext.mockResolvedValueOnce(ctx([]));
    await session.joinOrganisation("K1");
    api.locationContext.mockResolvedValueOnce(ctx([loc("L1")]));
    await session.joinLocation("S1");
    expect(api.joinLocation).toHaveBeenCalledWith("S1");
    expect(api.selectLocation).toHaveBeenCalledWith("L1");
    expect(state(session)).toMatchObject({ phase: "ready", location: { storeLocationId: "L1" } });
  });

  it.each([
    ["INVALID_JOIN_KEY", "That key wasn't found. Check it with your manager."],
    ["STORE_KEY_NOT_FOUND", "That key wasn't found. Check it with your manager."],
    ["NOT_ORG_MEMBER", "That location belongs to a different organisation than yours."],
    ["LOCATION_INACTIVE", "That location isn't open any more. Ask your manager."],
  ])("says what went wrong, from the server's code %s, never its English", async (code, sentence) => {
    const { session, api } = await firstRun();
    api.joinOrganisation.mockRejectedValueOnce(keyError(code));
    await session.joinOrganisation("K");
    expect(state(session)).toMatchObject({ phase: "firstRun", error: sentence });
  });

  it("shows the server's sentence for a failure it has no code for, and a plain one when the network is down", async () => {
    const { session, api } = await firstRun();
    api.joinOrganisation.mockRejectedValueOnce(new ApiError("bad_request", "Invalid join key."));
    await session.joinOrganisation("K");
    expect(state(session)).toMatchObject({ error: "Invalid join key." });
    api.joinOrganisation.mockRejectedValueOnce(new ApiError("network"));
    await session.joinOrganisation("K");
    expect(state(session)).toMatchObject({ error: "Can't reach the server. Try again." });
  });

  it("carries on when the server says the person is already in (a retry after a lost reply)", async () => {
    const { session, api } = await firstRun();
    api.joinOrganisation.mockRejectedValueOnce(keyError("ALREADY_MEMBER"));
    api.locationContext.mockResolvedValueOnce(ctx([]));
    await session.joinOrganisation("K");
    expect(state(session)).toMatchObject({ phase: "firstRun", organisationId: 1 });
    expect(state(session)).not.toHaveProperty("error");
    api.joinLocation.mockRejectedValueOnce(keyError("ALREADY_ASSIGNED"));
    api.locationContext.mockResolvedValueOnce(ctx([loc("L1")], "L1"));
    await session.joinLocation("S");
    expect(state(session)).toMatchObject({ phase: "ready" });
  });

  it("does nothing outside the first-run screen, and nothing for an empty key", async () => {
    const { session, api } = setup();
    await session.restore();
    await session.joinOrganisation("K");
    expect(api.joinOrganisation).not.toHaveBeenCalled();
    const first = await firstRun();
    await first.session.joinOrganisation("   ");
    expect(first.api.joinOrganisation).not.toHaveBeenCalled();
  });
});

describe("the update screen", () => {
  const body = { minVersion: "1.2.0", storeUrls: { ios: "https://apps.apple.com/app/id1" } };

  it("shows from any 426, with the version and the links the server sent", async () => {
    const { session } = setup();
    await session.restore();
    session.updateRequired(body);
    expect(state(session)).toEqual({ phase: "updateRequired", minVersion: "1.2.0", storeUrls: { ios: "https://apps.apple.com/app/id1" } });
  });

  it("has no links when the server sent none, even from a body it cannot read", () => {
    const { session } = setup();
    session.updateRequired(undefined);
    expect(state(session)).toEqual({ phase: "updateRequired", minVersion: "", storeUrls: undefined });
  });

  it("stays until the app is replaced: the failure that came with the 426 must not put the sign-in screen back", async () => {
    const { session } = setup({ me: vi.fn(async () => { throw new ApiError("upgrade_required", undefined, 426); }) });
    const restoring = session.restore();
    session.updateRequired(body); // the client reports the 426 before the call rejects
    await restoring;
    expect(state(session)).toMatchObject({ phase: "updateRequired" });
    await session.signIn("c@x.test", "pw");
    expect(state(session)).toMatchObject({ phase: "updateRequired" });
  });
});

describe("account deleted", () => {
  const ready = async (extra: Record<string, unknown> = {}) => {
    const wipeLocalData = vi.fn(async () => {});
    const s = setup(extra);
    const session = createSession({ api: s.api as unknown as AuthApi, hasTokens: s.hasTokens, snapshots: s.snapshots, wipeLocalData });
    await session.restore();
    return { ...s, session, wipeLocalData };
  };

  it("clears the tokens, the saved user and everything stored on the phone, then shows the result", async () => {
    const { session, api, snapshots, wipeLocalData } = await ready();
    await session.accountDeleted();
    expect(api.signOut).toHaveBeenCalled(); // clears the device tokens
    expect(snapshots.save).toHaveBeenLastCalledWith(null);
    expect(wipeLocalData).toHaveBeenCalled();
    expect(state(session)).toEqual({ phase: "accountDeleted" });
  });

  it("still shows the result when clearing the phone fails: the account is gone either way", async () => {
    const { session, wipeLocalData } = await ready();
    wipeLocalData.mockRejectedValueOnce(new Error("disk"));
    await session.accountDeleted();
    expect(state(session)).toEqual({ phase: "accountDeleted" });
  });

  it("goes back to sign-in once acknowledged", async () => {
    const { session } = await ready();
    await session.accountDeleted();
    session.leaveDeletedAccount();
    expect(state(session)).toEqual({ phase: "signedOut" });
  });
});

describe("signing in with Apple", () => {
  const credential: AppleCredential = { identityToken: "APPLE-TOKEN", nonce: "n".repeat(32), authorizationCode: "CODE", givenName: "Ada" };

  it("sends what Apple's sheet returned and opens the areas like a password sign-in", async () => {
    const { session, api } = setup({}, undefined, async () => credential);
    await session.signInWithApple();
    expect(api.appleSignIn).toHaveBeenCalledWith(credential);
    expect(state(session)).toMatchObject({ phase: "ready", user: counter });
  });

  it("does nothing, and says nothing, when the person closes Apple's sheet", async () => {
    const { session, api } = setup({}, undefined, async () => null);
    await session.signInWithApple();
    expect(api.appleSignIn).not.toHaveBeenCalled();
    expect(state(session)).toEqual({ phase: "restoring" });
    expect(session.getSnapshot().busy).toBe(false);
  });

  it("does nothing on a build without Apple sign-in (Android)", async () => {
    const { session, api } = setup();
    await session.signInWithApple();
    expect(api.appleSignIn).not.toHaveBeenCalled();
  });

  it("says plainly when Apple's sheet itself fails", async () => {
    const { session, api } = setup({}, undefined, async () => { throw new Error("ERR_REQUEST_FAILED"); });
    await session.signInWithApple();
    expect(api.appleSignIn).not.toHaveBeenCalled();
    expect(state(session)).toEqual({ phase: "signedOut", error: "Apple sign-in didn't work. Try again." });
  });

  it("shows the server's reason when it refuses the Apple account", async () => {
    const refusal = new ApiError("conflict", "An account with this email exists but its email was never verified.", 409, undefined, "ACCOUNT_EMAIL_UNVERIFIED");
    const { session } = setup({ appleSignIn: vi.fn(async () => { throw refusal; }) }, undefined, async () => credential);
    await session.signInWithApple();
    expect(state(session)).toEqual({ phase: "signedOut", error: refusal.message });
  });

  it("says it could not reach the server, not something Apple-specific, when the network is down", async () => {
    const { session } = setup({ appleSignIn: vi.fn(async () => { throw new ApiError("network"); }) }, undefined, async () => credential);
    await session.signInWithApple();
    expect(state(session)).toMatchObject({ phase: "signedOut", error: "Can't reach the server. Try again." });
  });

  it("goes to the code step when the account uses MFA", async () => {
    const { session } = setup({ appleSignIn: vi.fn(async () => ({ status: "mfa" as const, mfaSessionToken: "M" })) }, undefined, async () => credential);
    await session.signInWithApple();
    expect(state(session)).toMatchObject({ phase: "mfa", mfaSessionToken: "M" });
  });
});

import { describe, it, expect, vi } from "vitest";
import { createSession, type Snapshot } from "./session";
import { ApiError } from "../api/client";
import type { AuthApi, AuthUser, LocationContext, StoreLocation } from "../api/auth";

const counter: AuthUser = { userId: 1, userName: "Chef", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions: ["inventory:count"] };
const admin: AuthUser = { ...counter, roles: ["Administrator"], permissions: [] };
const bystander: AuthUser = { ...counter, permissions: ["chat:access"] };
const loc = (id: string): StoreLocation => ({ storeLocationId: id, organisationId: 1, locationName: `Loc ${id}`, classification: "branch" });
const ctx = (locations: StoreLocation[], selectedLocationId: string | null = null): LocationContext => ({ locations, selectedLocationId, organisationId: 1, isOrgAdmin: false, hasLocationAccess: locations.length > 0 });

function setup(overrides: Partial<Record<keyof AuthApi, unknown>> = {}) {
  const api = {
    signIn: vi.fn(async () => ({ status: "signedIn" as const, user: counter })),
    verifyMfa: vi.fn(async () => counter),
    me: vi.fn(async () => counter),
    signOut: vi.fn(async () => {}),
    locationContext: vi.fn(async () => ctx([loc("L1")], "L1")),
    selectLocation: vi.fn(async () => {}),
    ...overrides,
  };
  const hasTokens = vi.fn(async () => true);
  let saved: Snapshot | null = null;
  const snapshots = { load: vi.fn(async () => saved), save: vi.fn(async (s: Snapshot | null) => void (saved = s)) };
  const session = createSession({ api: api as unknown as AuthApi, hasTokens, snapshots });
  return { session, api, hasTokens, snapshots, setSaved: (s: Snapshot | null) => void (saved = s) };
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
  it("tells an account without count permission it cannot count, and an Administrator can", async () => {
    const no = setup({ me: vi.fn(async () => bystander) });
    await no.session.restore();
    expect(state(no.session)).toMatchObject({ phase: "noAccess", reason: "Your account can't count stock. Ask your manager." });

    const yes = setup({ me: vi.fn(async () => admin) });
    await yes.session.restore();
    expect(state(yes.session)).toMatchObject({ phase: "ready" });
  });

  it("tells an account with no location to ask its manager", async () => {
    const { session } = setup({ locationContext: vi.fn(async () => ctx([])) });
    await session.restore();
    expect(state(session)).toMatchObject({ phase: "noAccess", reason: "You aren't assigned to a location yet. Ask your manager." });
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

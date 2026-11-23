/**
 * Who is signed in and which screen that means, as plain logic with no React in it.
 * `createSession` is wired to the real API in `src/runtime/appContext` and to fakes in the tests.
 * It never discards saved tokens on a network failure: only the server refusing them ends a session.
 */

import { UpgradeRequiredBodySchema, type UpgradeRequired } from "@culinaire/shared/schemas/errors";
import { ApiError } from "../api/client";
import type { AppleCredential, AuthApi, AuthUser, StoreLocation } from "../api/auth";

export type SessionState =
  | { phase: "restoring" }
  | { phase: "signedOut"; error?: string }
  | { phase: "mfa"; mfaSessionToken: string; error?: string }
  /** Signed in but not at a location yet: join the organisation (`organisationId` null) or the location by key. */
  | { phase: "firstRun"; user: AuthUser; organisationId: number | null; error?: string }
  /** The server says this build is too old. Stays until the app is replaced. */
  | ({ phase: "updateRequired" } & UpgradeRequired)
  /** The person deleted their account from here; the phone is already cleared. */
  | { phase: "accountDeleted" }
  /** `current` is set when a chef already counting at a location came back to the picker, so they can cancel. */
  | { phase: "chooseLocation"; user: AuthUser; locations: StoreLocation[]; current?: StoreLocation; error?: string }
  /** `offline` is true when opened from the last known user and location because the server could not be reached. */
  | { phase: "ready"; user: AuthUser; location: StoreLocation; locations: StoreLocation[]; offline?: true };

export interface SessionSnapshot {
  state: SessionState;
  /** A request is running: the screen disables its button and shows "Signing in…". */
  busy: boolean;
}

/** The last known user and location, kept on the phone so the app can open with no signal. */
export interface Snapshot {
  user: AuthUser;
  location: StoreLocation;
  locations: StoreLocation[];
}

export interface SessionDeps {
  api: AuthApi;
  /** True when the device holds saved tokens. */
  hasTokens: () => Promise<boolean>;
  snapshots: { load: () => Promise<Snapshot | null>; save: (snapshot: Snapshot | null) => Promise<void> };
  /** Opens the Google account picker and returns its ID token, or null when the person closes it. Absent when the build has no Google client ID. */
  googleIdToken?: () => Promise<string | null>;
  /** Clears what the phone stores besides the tokens and saved user: the count queue and downloaded sheets. */
  wipeLocalData?: () => Promise<void>;
  /** Opens Apple's sign-in sheet and returns what the server verifies, or null when the person closes it. Absent off iOS. */
  appleCredential?: () => Promise<AppleCredential | null>;
}

const GENERIC = "Something went wrong. Try again.";

/** One plain sentence for a failed sign-in. A wrong password is the only 401 on this screen. */
function signInMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return GENERIC;
  return err.code === "unauthorized" ? "Email or password is wrong." : err.message;
}

/** A failed join in one plain sentence. The code is the server's machine-readable one; the English is only the fallback. */
function joinMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return GENERIC;
  if (err.hasCode("INVALID_JOIN_KEY") || err.hasCode("STORE_KEY_NOT_FOUND")) return "That key wasn't found. Check it with your manager.";
  if (err.hasCode("NOT_ORG_MEMBER")) return "That location belongs to a different organisation than yours.";
  if (err.hasCode("LOCATION_INACTIVE")) return "That location isn't open any more. Ask your manager.";
  return err.message;
}

export function createSession({ api, hasTokens, snapshots, googleIdToken, appleCredential, wipeLocalData }: SessionDeps) {
  let snapshot: SessionSnapshot = { state: { phase: "restoring" }, busy: false };
  const listeners = new Set<() => void>();

  function set(next: Partial<SessionSnapshot>) {
    // Once the server has said this build is too old, no later answer (the failure that came with the 426) may replace the update screen.
    if (next.state && snapshot.state.phase === "updateRequired") return;
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  }

  async function run(work: () => Promise<void>) {
    set({ busy: true });
    try {
      await work();
    } finally {
      set({ busy: false });
    }
  }

  async function ready(user: AuthUser, location: StoreLocation, locations: StoreLocation[]) {
    await snapshots.save({ user, location, locations });
    set({ state: { phase: "ready", user, location, locations } });
  }

  /** After the person is known: find their location. What they may open is decided by their permissions, in the shell's tab list. */
  async function open(user: AuthUser) {
    const ctx = await api.locationContext();
    if (ctx.locations.length === 0) {
      set({ state: { phase: "firstRun", user, organisationId: ctx.organisationId } });
      return;
    }
    const selected = ctx.locations.find((l) => l.storeLocationId === ctx.selectedLocationId);
    if (selected) {
      await ready(user, selected, ctx.locations);
    } else if (ctx.locations.length === 1) {
      await api.selectLocation(ctx.locations[0].storeLocationId);
      await ready(user, ctx.locations[0], ctx.locations);
    } else {
      set({ state: { phase: "chooseLocation", user, locations: ctx.locations } });
    }
  }

  /** One join step. A server that says the person is already in is a retry after a lost reply, so it counts as done. */
  function join(key: string, send: (key: string) => Promise<void>, alreadyCode: string) {
    const current = snapshot.state;
    const trimmed = key.trim();
    if (current.phase !== "firstRun" || !trimmed) return Promise.resolve();
    return run(async () => {
      try {
        try {
          await send(trimmed);
        } catch (err) {
          if (!(err instanceof ApiError && err.hasCode(alreadyCode))) throw err;
        }
        await open(await api.me());
      } catch (err) {
        set({ state: { ...current, error: joinMessage(err) } });
      }
    });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    /** App start: reuse saved tokens if the server still accepts them. */
    async restore() {
      // A secure store that throws (say after a keystore reset) means there is no usable session, not a frozen splash screen.
      const saved = await hasTokens().catch(() => false);
      if (!saved) return set({ state: { phase: "signedOut" } });
      try {
        await open(await api.me());
      } catch (err) {
        if (err instanceof ApiError && err.code === "unauthorized") return set({ state: { phase: "signedOut" } });
        // No signal is not a reason to lock a chef out of counting: open from the last known user and location.
        const last = err instanceof ApiError && (err.code === "network" || err.code === "timeout") ? await snapshots.load().catch(() => null) : null;
        if (last) return set({ state: { phase: "ready", ...last, offline: true } });
        set({ state: { phase: "signedOut", error: err instanceof ApiError ? err.message : GENERIC } });
      }
    },

    signIn(email: string, password: string) {
      return run(async () => {
        try {
          const result = await api.signIn(email, password);
          if (result.status === "mfa") return set({ state: { phase: "mfa", mfaSessionToken: result.mfaSessionToken } });
          await open(result.user);
        } catch (err) {
          set({ state: { phase: "signedOut", error: signInMessage(err) } });
        }
      });
    },

    signInWithGoogle() {
      if (!googleIdToken) return Promise.resolve();
      return run(async () => {
        let idToken: string | null;
        try {
          idToken = await googleIdToken();
        } catch {
          return set({ state: { phase: "signedOut", error: "Google sign-in didn't work. Try again." } });
        }
        if (idToken === null) return; // closed the picker: nothing to say
        try {
          const result = await api.googleSignIn(idToken);
          if (result.status === "mfa") return set({ state: { phase: "mfa", mfaSessionToken: result.mfaSessionToken } });
          await open(result.user);
        } catch (err) {
          set({ state: { phase: "signedOut", error: err instanceof ApiError ? err.message : GENERIC } });
        }
      });
    },

    signInWithApple() {
      if (!appleCredential) return Promise.resolve();
      return run(async () => {
        let credential: AppleCredential | null;
        try {
          credential = await appleCredential();
        } catch {
          return set({ state: { phase: "signedOut", error: "Apple sign-in didn't work. Try again." } });
        }
        if (credential === null) return; // closed the sheet: nothing to say
        try {
          const result = await api.appleSignIn(credential);
          if (result.status === "mfa") return set({ state: { phase: "mfa", mfaSessionToken: result.mfaSessionToken } });
          await open(result.user);
        } catch (err) {
          set({ state: { phase: "signedOut", error: err instanceof ApiError ? err.message : GENERIC } });
        }
      });
    },

    submitCode(code: string) {
      return run(async () => {
        const current = snapshot.state;
        if (current.phase !== "mfa") return;
        try {
          await open(await api.verifyMfa(current.mfaSessionToken, code));
        } catch (err) {
          if (err instanceof ApiError && err.code === "unauthorized") {
            return set({ state: { phase: "signedOut", error: "Your sign-in timed out. Start again." } });
          }
          const error = err instanceof ApiError && err.code === "bad_request" ? "That code didn't work. Try again." : err instanceof ApiError ? err.message : GENERIC;
          set({ state: { ...current, error } });
        }
      });
    },

    chooseLocation(storeLocationId: string) {
      return run(async () => {
        const current = snapshot.state;
        if (current.phase !== "chooseLocation") return;
        const location = current.locations.find((l) => l.storeLocationId === storeLocationId);
        if (!location) return;
        try {
          await api.selectLocation(storeLocationId);
          await ready(current.user, location, current.locations);
        } catch (err) {
          set({ state: { ...current, error: err instanceof ApiError ? err.message : GENERIC } });
        }
      });
    },

    /** From the areas list: pick a different location (only for accounts that have more than one). */
    changeLocation() {
      const current = snapshot.state;
      if (current.phase !== "ready" || current.locations.length < 2) return;
      set({ state: { phase: "chooseLocation", user: current.user, locations: current.locations, current: current.location } });
    },

    /** Back out of a location change: the same location, no server call. */
    cancelChangeLocation() {
      const current = snapshot.state;
      if (current.phase !== "chooseLocation" || !current.current) return;
      set({ state: { phase: "ready", user: current.user, location: current.current, locations: current.locations } });
    },

    /** First run, step one: join the organisation by its key. Reloads the person, so new permissions show. */
    joinOrganisation(joinKey: string) {
      return join(joinKey, (key) => api.joinOrganisation(key), "ALREADY_MEMBER");
    },

    /** First run, step two: join a location of that organisation by its store key. */
    joinLocation(storeKey: string) {
      return join(storeKey, (key) => api.joinLocation(key), "ALREADY_ASSIGNED");
    },

    /** The API client calls this on any 426. */
    updateRequired(body: unknown) {
      set({ state: { phase: "updateRequired", ...UpgradeRequiredBodySchema.parse(body) } });
    },

    /** The server deleted the account: end the session and clear everything on the phone, then show the result. */
    async accountDeleted() {
      // Each step is tried on its own: the account is gone either way, so the result must show whatever fails here.
      await api.signOut().catch(() => undefined); // clears the device tokens
      await snapshots.save(null).catch(() => undefined);
      await wipeLocalData?.().catch(() => undefined);
      set({ state: { phase: "accountDeleted" } });
    },

    leaveDeletedAccount() {
      set({ state: { phase: "signedOut" } });
    },

    signOut() {
      return run(async () => {
        await api.signOut();
        await snapshots.save(null);
        set({ state: { phase: "signedOut" } });
      });
    },

    /** The API client calls this when the server refuses the refresh token. */
    sessionExpired() {
      void snapshots.save(null);
      set({ state: { phase: "signedOut", error: "Your session ended. Sign in again." } });
    },
  };
}

export type Session = ReturnType<typeof createSession>;

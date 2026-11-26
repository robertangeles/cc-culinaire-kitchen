/**
 * The app lock, as plain logic: who it is for, when it is on, and whether a guarded action (approve, reject, credit note) may go ahead.
 * The system's Face ID, fingerprint or passcode prompt is behind `authenticate`, so the tests drive a fake. It is in front of the session and
 * never ends it: a prompt that fails, is cancelled or is locked out leaves the app locked and the person signed in.
 */

import type { AuthUser } from "../api/auth";
import { hasAnyPermission } from "../shell/tabs";

/**
 * Approving orders, and reading or managing rosters and compliance documents, a person's own shifts and certificates included (owner, Q6).
 */
export const LOCK_PERMISSIONS = ["purchasing:approve", "roster:read-own", "roster:read-all", "roster:manage", "roster:publish", "roster:manage-award-rules", "compliance:read-own", "compliance:read-all", "compliance:verify", "compliance:manage-rules"];

/** How long the app may be in the background before it locks. */
export const GRACE_MS = 60_000;
/** How long an unlock counts for a guarded action before it asks again. */
export const RECENT_MS = 120_000;

/** `unprotected`: the device has no biometrics and no passcode, so there is nothing to unlock with. */
export type AuthResult = "ok" | "cancelled" | "lockout" | "unprotected" | "failed";

export interface LockSnapshot {
  /** Who unlocked the app; the lock is on for anyone else it is for. */
  unlockedUserId: number | null;
  /** The app is not in front: hide the screen now, so it is not seen in the app switcher or for a moment on the way back. */
  covered: boolean;
  /** The system prompt is open. */
  busy: boolean;
  /** Why the last try did not unlock it (a closed prompt needs no words). */
  problem: "lockout" | "unprotected" | "failed" | null;
}

export interface AppLockDeps {
  /** Opens the system prompt, with the reason shown on it. */
  authenticate: (reason: string) => Promise<AuthResult>;
  /** The phone's clock, which keeps going while it sleeps but can be set by hand. */
  now: () => number;
  /** Time since the app started, which cannot be set but may stop while the phone sleeps. */
  uptime: () => number;
}

interface Moment {
  clock: number;
  up: number;
}

export const lockRequired = (user: AuthUser) => hasAnyPermission(user, LOCK_PERMISSIONS);

/** True when the lock is on for this person. */
export const lockedFor = (user: AuthUser | null, snapshot: LockSnapshot) => user !== null && lockRequired(user) && snapshot.unlockedUserId !== user.userId;

export function createAppLock({ authenticate, now, uptime }: AppLockDeps) {
  let snapshot: LockSnapshot = { unlockedUserId: null, covered: false, busy: false, problem: null };
  let user: AuthUser | null = null;
  let unlockedAt: Moment | null = null;
  let leftAt: Moment | null = null;
  let prompt: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();

  function set(next: Partial<LockSnapshot>) {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  }

  const moment = (): Moment => ({ clock: now(), up: uptime() });
  /** By either clock, so setting the phone's clock back does not buy time; one that went backwards counts as too long ago. */
  const longerThan = (ms: number, since: Moment) => now() - since.clock > ms || now() < since.clock || uptime() - since.up > ms;

  async function ask(reason: string): Promise<boolean> {
    const who = user;
    if (!who) return false;
    set({ busy: true, problem: null });
    const result = await authenticate(reason).catch((): AuthResult => "failed");
    if (user?.userId !== who.userId) {
      set({ busy: false });
      return false;
    }
    if (result !== "ok") {
      set({ busy: false, unlockedUserId: null, problem: result === "cancelled" ? null : result });
      return false;
    }
    unlockedAt = moment();
    // The prompt can send the app to the background itself: that time away is answered for.
    if (leftAt !== null) leftAt = unlockedAt;
    set({ busy: false, unlockedUserId: who.userId });
    return true;
  }

  /** One prompt at a time: a second tap waits for the first one's answer. */
  const open = (reason: string) => (prompt ??= ask(reason).finally(() => (prompt = null)));

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    /** Who is signed in. A sign-out, or a different person, locks it again. */
    setUser(next: AuthUser | null) {
      if (next?.userId !== user?.userId) set({ unlockedUserId: null, problem: null });
      user = next;
    },

    isLocked: () => lockedFor(user, snapshot),

    /** React Native's AppState. Only "background" counts as leaving: iOS is "inactive" under its own Face ID sheet and the control centre. */
    appState(state: string) {
      if (state === "active") {
        const away = leftAt !== null && longerThan(GRACE_MS, leftAt);
        leftAt = null;
        set({ covered: false, ...(away ? { unlockedUserId: null } : {}) });
        return;
      }
      if (state === "background") leftAt ??= moment();
      set({ covered: true });
    },

    unlock: () => open("Unlock CulinAIre Kitchen"),

    /** Before a guarded action: true when this person may go on. A prompt that does not go through locks the app. */
    async confirm(reason: string): Promise<boolean> {
      if (!user || !lockRequired(user)) return true;
      if (snapshot.unlockedUserId === user.userId && unlockedAt && !longerThan(RECENT_MS, unlockedAt)) return true;
      return open(reason);
    },
  };
}

export type AppLock = ReturnType<typeof createAppLock>;

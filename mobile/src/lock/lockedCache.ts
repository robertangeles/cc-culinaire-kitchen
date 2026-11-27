/**
 * The last answer of each roster and documents screen, kept on the phone so they open with no signal (owner, Q6: allowed once the app lock
 * covers these holders). Sealed with AES-GCM under a random key held in the Keychain or Keystore, as the tokens are; the sealed text sits in
 * the kv table. It is read only by the person who unlocked the app, for the account and kitchen that saved it, while they hold the screen's
 * permission, and emptied at sign-out, at another account or kitchen, and when the phone has no screen lock any more.
 */

import type { AuthUser } from "../api/auth";
import type { SessionState } from "../auth/session";
import { hasAnyPermission } from "../shell/tabs";
import type { KvStore } from "../storage/kv";
import type { LockSnapshot } from "./appLock";

/** One copy per screen's store. */
const PERMISSION = { roster: "roster:read-own", availability: "roster:read-own", documents: "compliance:read-own" } as const;
export type CacheName = keyof typeof PERMISSION;
const NAMES = Object.keys(PERMISSION) as CacheName[];
const entry = (name: CacheName) => `locked.${name}`;

/** AES-GCM over text; `context` is bound into the seal (the owner and the screen), so a copy opens only where it was written. */
export interface Cipher {
  newKey(): Promise<string>;
  seal(text: string, key: string, context: string): Promise<string>;
  open(sealed: string, key: string, context: string): Promise<string>;
}

/** The one secure item that holds the key and whose copy it is. */
export interface KeyStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
}

export interface LockedCacheDeps {
  kv: KvStore;
  secrets: KeyStore;
  cipher: Cipher;
  session: () => SessionState;
  /** Who passed the app lock, or null. */
  unlockedUserId: () => number | null;
  now: () => string;
}

const ownerOf = (state: SessionState) => (state.phase === "ready" ? `${state.user.userId}:${state.location.storeLocationId}` : null);

export function createLockedCache({ kv, secrets, cipher, session, unlockedUserId, now }: LockedCacheDeps) {
  // Key changes and writes one at a time, so a clear cannot interleave with a write that is making a new key.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.catch(() => undefined);
    return next;
  };

  async function held(): Promise<{ owner: string; key: string } | null> {
    try {
      return JSON.parse((await secrets.get()) ?? "null");
    } catch {
      return null;
    }
  }

  async function clearNow() {
    await Promise.all(NAMES.map((n) => kv.delete(entry(n)).catch(() => undefined)));
    await secrets.delete().catch(() => undefined);
  }

  const may = (user: AuthUser, name: CacheName) => hasAnyPermission(user, [PERMISSION[name]]);

  return {
    /** Taken before a request goes out and handed back to `write`, so an answer that arrives after a switch is not saved. */
    owner: () => ownerOf(session()),

    async read<T>(name: CacheName, schema: { parse(data: unknown): T }): Promise<{ at: string; data: T } | null> {
      const state = session();
      const owner = ownerOf(state);
      if (!owner || state.phase !== "ready" || !may(state.user, name) || unlockedUserId() !== state.user.userId) return null;
      return serial(async () => {
        try {
          const secret = await held();
          const sealed = await kv.get(entry(name));
          if (secret?.owner !== owner || !sealed) return null;
          const doc = JSON.parse(await cipher.open(sealed, secret.key, `${owner}|${name}`)) as { at: string; data: unknown };
          return { at: doc.at, data: schema.parse(doc.data) };
        } catch {
          return null;
        }
      });
    },

    write(name: CacheName, owner: string | null, data: unknown): Promise<void> {
      return serial(async () => {
        const state = session();
        if (!owner || owner !== ownerOf(state) || state.phase !== "ready" || !may(state.user, name)) return;
        try {
          let secret = await held();
          if (secret?.owner !== owner) {
            await clearNow();
            secret = { owner, key: await cipher.newKey() };
            // An iPhone with no passcode refuses the key: then nothing is kept.
            await secrets.set(JSON.stringify(secret));
          }
          await kv.set(entry(name), await cipher.seal(JSON.stringify({ at: now(), data }), secret.key, `${owner}|${name}`));
        } catch {
          // Not kept: the screen still has what it read.
        }
      });
    },

    remove: (name: CacheName) => serial(() => kv.delete(entry(name)).catch(() => undefined)),
    clear: () => serial(clearNow),

    /** Every change of the session: sign-out, another account or kitchen, or a permission taken away. */
    follow(state: SessionState): Promise<void> {
      return serial(async () => {
        if (state.phase === "signedOut" || state.phase === "accountDeleted" || state.phase === "mfa" || state.phase === "firstRun") return clearNow();
        if (state.phase !== "ready") return;
        const secret = await held();
        if (secret && secret.owner !== ownerOf(state)) return clearNow();
        await Promise.all(NAMES.filter((n) => !may(state.user, n)).map((n) => kv.delete(entry(n)).catch(() => undefined)));
      });
    },

    /**
     * The phone's screen lock was removed: nothing can unlock the app now, so nothing is kept. shortcut: seen only at the next unlock try; on
     * iOS the Keychain drops the key with the passcode, Android keeps it until then. A lock removed and set again in between keeps the copy.
     */
    followLock: (lock: Pick<LockSnapshot, "problem">) => (lock.problem === "unprotected" ? serial(clearNow) : Promise.resolve()),
  };
}

export type LockedCache = ReturnType<typeof createLockedCache>;

/** What a screen's store uses. */
export type StoreCache = Pick<LockedCache, "owner" | "read" | "write" | "remove">;

import { useEffect } from "react";
import { appLockOff } from "../config";
import { createLockedCache } from "../lock/lockedCache";
import { aesCipher, cacheKeyStore } from "../lock/nativeSeal";
import { sqliteKv } from "../storage/kv";
import { session } from "./appContext";
import { appLock } from "./appLock";

/** The one sealed copy of the roster's and documents' last answers. Device walks run with the lock off, and read it as if it were passed. */
export const lockedCache = createLockedCache({
  kv: sqliteKv,
  secrets: cacheKeyStore,
  cipher: aesCipher,
  session: () => session.getSnapshot().state,
  unlockedUserId: () => {
    const s = session.getSnapshot().state;
    return appLockOff && s.phase === "ready" ? s.user.userId : appLock.getSnapshot().unlockedUserId;
  },
  now: () => new Date().toISOString(),
});

let started = false;
/** Once, at launch: empty it at sign-out, at another account or kitchen, at a permission taken away, and when the phone has no screen lock. */
export function startLockedCache(): void {
  if (started) return;
  started = true;
  const follow = () => void lockedCache.follow(session.getSnapshot().state);
  session.subscribe(follow);
  follow();
  appLock.subscribe(() => void lockedCache.followLock(appLock.getSnapshot()));
}

/** A screen opened under the lock with no signal could not show the saved copy: `run` reads again once the lock is passed. */
export function useAfterUnlock(run: () => void): void {
  useEffect(() => {
    let locked = appLock.isLocked();
    return appLock.subscribe(() => {
      const now = appLock.isLocked();
      if (locked && !now) run();
      locked = now;
    });
  }, [run]);
}

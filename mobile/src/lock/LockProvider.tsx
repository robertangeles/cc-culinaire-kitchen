import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { AppState, StyleSheet, View } from "react-native";
import type { AuthUser } from "../api/auth";
import { useColors } from "../ui/theme";
import { LockScreen } from "./LockScreen";
import { lockedFor, lockRequired, type AppLock } from "./appLock";

const LockContext = createContext<Pick<AppLock, "confirm"> | null>(null);

/**
 * The app lock over the whole app. The screens stay mounted under it, so what was typed is there after an unlock, but they are covered by an
 * opaque page and hidden from screen readers. `user` is whoever is signed in, whatever screen that is on.
 */
export function LockProvider({ lock, user, onSignOut, children }: { lock: AppLock; user: AuthUser | null; onSignOut: () => void; children: ReactNode }) {
  const snapshot = useSyncExternalStore(lock.subscribe, lock.getSnapshot);
  const c = useColors();
  // Before anything is painted, and worked out below in the same render, so no frame shows the app to someone who has not unlocked it.
  useLayoutEffect(() => lock.setUser(user), [lock, user]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", lock.appState);
    return () => sub.remove();
  }, [lock]);
  const guard = useMemo(() => ({ confirm: lock.confirm }), [lock]);

  const locked = lockedFor(user, snapshot);
  const hidden = locked || (snapshot.covered && user !== null && lockRequired(user));
  return (
    <LockContext.Provider value={guard}>
      <View style={styles.fill} aria-hidden={hidden}>
        {children}
      </View>
      {hidden ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]} accessibilityViewIsModal>
          {locked ? <LockScreen problem={snapshot.problem} busy={snapshot.busy} onUnlock={() => void lock.unlock()} onSignOut={onSignOut} /> : null}
        </View>
      ) : null}
    </LockContext.Provider>
  );
}

/** Test seam: the screens with a lock the test made. */
export const LockContextProvider = LockContext.Provider;

/** `confirm(reason)` before a guarded action: true when the person may go on. */
export function useAppLock() {
  const ctx = useContext(LockContext);
  if (!ctx) throw new Error("guarded screens must be inside LockProvider");
  return ctx;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });

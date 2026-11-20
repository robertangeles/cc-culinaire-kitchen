import type { Outbox } from "./outbox";

export interface RunnerDeps {
  outbox: Pick<Outbox, "drain">;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

/**
 * Keeps the outbox moving: drain now, and come back when the outbox says to (a backoff or the 20-a-minute
 * cap). Call `kick()` after a count is saved, when the app returns to the foreground, and after sign-in.
 */
export function createRunner({ outbox, now, setTimer, clearTimer }: RunnerDeps) {
  let timer: unknown = null;
  function kick() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    void outbox.drain().then(({ nextWakeAt }) => {
      if (nextWakeAt !== null) timer = setTimer(kick, Math.max(1_000, nextWakeAt - now()));
    });
  }
  return { kick };
}

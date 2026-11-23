import { AppState } from "react-native";
import { client, session } from "./appContext";
import { createOutbox } from "../outbox/outbox";
import { createRunner } from "../outbox/runner";
import { createSendSaveLine } from "../outbox/sendSaveLine";
import { sqliteOutboxStore } from "../outbox/sqliteStore";
import { prepHandlers } from "../prep/prepCommands";
import { consumptionHandlers } from "../consumption/consumptionCommands";
import { movementHandlers } from "../movements/movementCommands";
import { wasteHandlers } from "../waste/wasteCommands";

/** The signed-in chef's id, or null (counts stay on the phone and wait for a sign-in). */
export function currentUserId(): number | null {
  const s = session.getSnapshot().state;
  return s.phase === "ready" ? s.user.userId : null;
}

export const outbox = createOutbox({
  store: sqliteOutboxStore,
  send: createSendSaveLine(client),
  // Every other module's commands: add its handlers here (see the "Offline queue" section of mobile/README.md).
  handlers: [...wasteHandlers(client), ...prepHandlers(client), ...consumptionHandlers(client), ...movementHandlers(client)],
  now: Date.now,
  newId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  getUserId: currentUserId,
});

export const runner = createRunner({
  outbox,
  now: Date.now,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
});

let started = false;
/** Once, at launch: requeue counts a crash caught mid-send, then send whenever the app wakes or someone signs in. */
export function startOutbox(): void {
  if (started) return;
  started = true;
  // Accepted counts only need to stay a week (the server holds them); stuck and discarded ones are never pruned.
  void outbox.recover().then(() => outbox.pruneAccepted(7 * 86_400_000)).catch(() => {}).then(runner.kick); // housekeeping must never stop the first send
  AppState.addEventListener("change", (s) => s === "active" && runner.kick());
  session.subscribe(() => {
    if (session.getSnapshot().state.phase !== "ready") return;
    // Counts parked because the session ended ("Sign in again and this count will be sent") go back in the queue.
    void outbox.requeueSignedOut().then(runner.kick);
  });
}

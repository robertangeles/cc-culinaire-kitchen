import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { router } from "expo-router";
import { notificationsApi, push, session } from "./appContext";
import { currentUserId, outbox, runner } from "./appOutbox";
import { createInboxStore } from "../notifications/inboxStore";
import { listenForPushes } from "../notifications/nativePush";
import { phoneRoute } from "../notifications/notificationView";
import { readPushData } from "../notifications/push";
import { INBOX_LINK, type PushData } from "@culinaire/shared/schemas/push";
import { sqliteKv } from "../storage/kv";

/** The one inbox: the tab badge, the inbox screen and a tapped push all read it. */
export const inbox = createInboxStore({ api: notificationsApi, kv: sqliteKv, outbox, getUserId: currentUserId, kick: runner.kick });

export function useInbox() {
  return useSyncExternalStore(inbox.subscribe, inbox.getSnapshot);
}

/** The web bell checks every minute; so does the phone while it is open, besides a push arriving and the app waking. */
const POLL_MS = 60_000;
const INBOX_ROUTE = "/(app)/(inbox)";

/** A tapped push opens the screen it is about where the phone has one (and marks it read), else the inbox. */
function open(data: PushData) {
  const s = session.getSnapshot().state;
  if (s.phase !== "ready") return false;
  const route = data.link === INBOX_LINK ? null : phoneRoute(data.type, data.link, s.user);
  if (route) void inbox.markRead(data.notificationId);
  router.navigate((route ?? INBOX_ROUTE) as never);
  void inbox.refresh();
  return true;
}

let started = false;
/** Once, at launch (after the outbox): keep the inbox fresh, register push at each sign-in, and open tapped pushes. */
export function startNotifications(): void {
  if (started) return;
  started = true;
  let lastUser: number | null = null;
  // A push tapped before the session is ready (it started the app) waits for it.
  let pending: PushData | null = null;
  const whenReady = () => {
    const userId = currentUserId();
    if (userId !== null && userId !== lastUser) {
      void push.sync();
      void inbox.refresh();
    }
    lastUser = userId;
    if (userId !== null && pending && open(pending)) pending = null;
  };
  session.subscribe(whenReady);
  whenReady();
  AppState.addEventListener("change", (s) => {
    if (s !== "active" || currentUserId() === null) return;
    void push.sync();
    void inbox.refresh();
  });
  setInterval(() => AppState.currentState === "active" && currentUserId() !== null && void inbox.refresh(), POLL_MS);
  listenForPushes({
    onArrive: () => void inbox.refresh(),
    onTap: (raw) => {
      const data = readPushData(raw);
      if (data && !open(data)) pending = data;
    },
  });
}

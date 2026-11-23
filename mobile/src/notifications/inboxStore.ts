/**
 * The inbox: the server's unread notifications, kept on the phone for a start with no signal, with the queued "mark read"
 * commands laid over them so a row read offline stays gone and the count drops at once. One store for the app (the tab
 * badge, the inbox screen and a tapped push all read it); it follows whoever is signed in.
 */

import type { AppNotification } from "@culinaire/shared/schemas/notifications";
import type { Outbox } from "../outbox/outbox";
import type { KvStore } from "../storage/kv";
import { NOTIFICATION_READ, NOTIFICATION_TYPES, type NotificationReadCommand } from "./notificationCommands";
import type { NotificationsApi } from "./notificationsApi";

export interface InboxSnapshot {
  /** "loading" until the first answer or saved copy; "failed" when there is neither. */
  phase: "loading" | "ready" | "failed";
  /** Showing the saved copy because the server could not be reached. */
  offline: boolean;
  items: AppNotification[];
  unread: number;
}

export interface InboxDeps {
  api: Pick<NotificationsApi, "list" | "unreadCount">;
  kv: KvStore;
  outbox: Pick<Outbox, "enqueueCommand" | "entriesOfTypes" | "subscribe">;
  /** The signed-in account, or null. */
  getUserId: () => number | null;
  kick: () => void;
}

const EMPTY: InboxSnapshot = { phase: "loading", offline: false, items: [], unread: 0 };

export function createInboxStore({ api, kv, outbox, getUserId, kick }: InboxDeps) {
  let serverRows: AppNotification[] = [];
  let serverCount = 0;
  let userId: number | null = null;
  let snapshot = EMPTY;
  const listeners = new Set<() => void>();
  const set = (next: Partial<InboxSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };

  /** Another account signed in: forget the last one's rows before anything is shown. */
  function follow(): number | null {
    const current = getUserId();
    if (current !== userId) {
      userId = current;
      serverRows = [];
      serverCount = 0;
      snapshot = EMPTY;
    }
    return current;
  }

  async function rebuild() {
    const owner = follow();
    // Accepted reads too: the server answered, but the rows on screen may be from before.
    const read = new Set((await outbox.entriesOfTypes(NOTIFICATION_TYPES)).map((e) => (e.command as NotificationReadCommand).notificationId));
    if (owner !== getUserId()) return;
    const items = serverRows.filter((n) => !read.has(n.notificationId));
    set({ items, unread: Math.max(items.length, serverCount - (serverRows.length - items.length)) });
  }

  outbox.subscribe(() => void rebuild());

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    /** Load the list and the count; with no signal, the copy saved the last time (or what is already shown). */
    async refresh(): Promise<void> {
      const owner = follow();
      if (owner === null) return;
      const key = `inbox.${owner}`;
      try {
        const [rows, count] = await Promise.all([api.list(), api.unreadCount()]);
        if (owner !== getUserId()) return;
        serverRows = rows;
        serverCount = count;
        await kv.set(key, JSON.stringify({ rows, count }));
        set({ phase: "ready", offline: false });
      } catch {
        if (owner !== getUserId()) return;
        if (snapshot.phase !== "ready") {
          const saved = await kv.get(key).catch(() => null);
          if (saved) {
            const parsed = JSON.parse(saved) as { rows: AppNotification[]; count: number };
            serverRows = parsed.rows;
            serverCount = parsed.count;
          }
          set({ phase: saved ? "ready" : "failed" });
        }
        set({ offline: true });
      }
      await rebuild();
    },

    /** Queued, so it works with no signal; the row leaves the list at once. */
    async markRead(notificationId: string): Promise<void> {
      await outbox.enqueueCommand<NotificationReadCommand>(NOTIFICATION_READ, { notificationId });
      await rebuild();
      kick();
    },
  };
}

export type InboxStore = ReturnType<typeof createInboxStore>;

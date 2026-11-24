import { describe, it, expect, vi } from "vitest";
import type { AppNotification } from "@culinaire/shared/schemas/notifications";
import { ApiError } from "../api/client";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../outbox/outbox";
import type { KvStore } from "../storage/kv";
import { notificationHandlers } from "./notificationCommands";
import { createInboxStore } from "./inboxStore";

const row = (id: string, type = "PO_APPROVED"): AppNotification => ({ notificationId: id, type, payload: { poNumber: id }, relatedEntityType: null, relatedEntityId: null, createdAt: "2026-11-24T10:00:00Z" });

function setup(over: { rows?: AppNotification[]; count?: number; markRead?: ReturnType<typeof vi.fn> } = {}) {
  const entries = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...entries.values()].sort((a, b) => a.createdAt - b.createdAt), put: async (e) => void entries.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => entries.delete(i)) };
  const markRead = over.markRead ?? vi.fn(async () => {});
  const user = { current: 1 as number | null };
  let n = 0;
  const outbox = createOutbox({ store, send: async () => {}, handlers: notificationHandlers({ markRead }), now: () => 1000 + n, newId: () => `e${++n}`, getUserId: () => user.current });
  const kvMap = new Map<string, string>();
  const kv: KvStore = { get: async (k) => kvMap.get(k) ?? null, set: async (k, v) => void kvMap.set(k, v), delete: async (k) => void kvMap.delete(k) };
  const server = { rows: over.rows ?? [row("a"), row("b")], count: over.count ?? 2, down: false };
  const api = {
    list: vi.fn(async () => {
      if (server.down) throw new ApiError("network");
      return server.rows;
    }),
    unreadCount: vi.fn(async () => {
      if (server.down) throw new ApiError("network");
      return server.count;
    }),
  };
  const kick = vi.fn();
  const inbox = createInboxStore({ api, kv, outbox, getUserId: () => user.current, kick });
  return { inbox, outbox, server, kv, kick, markRead, user };
}

describe("the inbox", () => {
  it("shows the unread notifications and the server's count, which can be more than the list holds", async () => {
    const t = setup({ count: 75 });
    await t.inbox.refresh();
    expect(t.inbox.getSnapshot()).toMatchObject({ phase: "ready", offline: false, unread: 75 });
    expect(t.inbox.getSnapshot().items.map((n) => n.notificationId)).toEqual(["a", "b"]);
  });

  it("opens from the saved copy with no signal, and says it is offline", async () => {
    const t = setup();
    await t.inbox.refresh();
    t.server.down = true;
    const again = createInboxStore({ api: { list: async () => Promise.reject(new ApiError("network")), unreadCount: async () => 0 }, kv: t.kv, outbox: t.outbox, getUserId: () => 1, kick: vi.fn() });
    await again.refresh();
    expect(again.getSnapshot()).toMatchObject({ phase: "ready", offline: true, unread: 2 });
    expect(again.getSnapshot().items).toHaveLength(2);
  });

  it("fails plainly the first time there is no signal and nothing saved", async () => {
    const t = setup();
    t.server.down = true;
    await t.inbox.refresh();
    expect(t.inbox.getSnapshot()).toMatchObject({ phase: "failed", offline: true, items: [] });
  });

  it("marks a notification read on the phone at once and queues it for the server", async () => {
    const t = setup();
    await t.inbox.refresh();
    await t.inbox.markRead("a");
    expect(t.inbox.getSnapshot().items.map((n) => n.notificationId)).toEqual(["b"]);
    expect(t.inbox.getSnapshot().unread).toBe(1);
    expect(t.kick).toHaveBeenCalled();
    await t.outbox.drain();
    expect(t.markRead).toHaveBeenCalledWith("a");
  });

  it("keeps a read row gone when a refresh lands before the server has it", async () => {
    const t = setup();
    await t.inbox.refresh();
    await t.inbox.markRead("a"); // queued, not sent: the server still lists it
    await t.inbox.refresh();
    expect(t.inbox.getSnapshot().items.map((n) => n.notificationId)).toEqual(["b"]);
    expect(t.inbox.getSnapshot().unread).toBe(1);
  });

  it("counts a notification that is already gone on the server as read", async () => {
    const t = setup({ markRead: vi.fn(async () => Promise.reject(new ApiError("not_found", undefined, 404))) });
    await t.inbox.refresh();
    await t.inbox.markRead("a");
    await t.outbox.drain();
    expect((await t.outbox.entriesOfTypes(["notification.read"]))[0].status).toBe("ACCEPTED");
  });

  it("never shows one account's notifications to the next person who signs in", async () => {
    const t = setup();
    await t.inbox.refresh();
    t.user.current = 2;
    t.server.down = true;
    await t.inbox.refresh();
    expect(t.inbox.getSnapshot()).toMatchObject({ phase: "failed", items: [], unread: 0 });
  });
});

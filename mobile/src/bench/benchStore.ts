/**
 * The Bench: the channels and direct messages, and the one room that is open. Everything is in memory only, and nothing is ever queued: a post
 * either goes out now or is shown as not sent.
 *
 * The server acknowledges neither a join nor a post, so the open room is kept right by reading its latest page again: after every connect, a moment
 * after a join (made twice), and ten seconds after a post that has not come back. What happens on the live channel while a page is on its way is laid over it.
 */

import { BenchMessageSchema, PresenceSchema, ReactionListSchema, type BenchChannel, type BenchMessage, type BenchPerson, type DmThread } from "@culinaire/shared/schemas/bench";
import { ApiError } from "../api/client";
import { PAGE, type BenchApi, type Room } from "./benchApi";
import type { BenchLive } from "./benchLive";

/** A post of one's own the server has not been seen to have. The server stores it under `id`, so sending it again never makes a second one. */
export interface PendingPost {
  id: string;
  body: string;
  status: "sending" | "failed";
}

interface Pending extends PendingPost {
  /** Not sent if a list read from now on does not have it. */
  due: number;
}

export interface RoomState {
  room: Room;
  phase: "loading" | "ready" | "error";
  /** Oldest first, in the server's order. */
  messages: BenchMessage[];
  pending: PendingPost[];
  hasOlder: boolean;
  loadingOlder: boolean;
  error: string | null;
  /** Something that did not go through. */
  notice: string | null;
  typing: { userId: number; userName: string }[];
}

export interface BenchSnapshot {
  lists: "loading" | "ready" | "error";
  listError: string | null;
  channels: BenchChannel[];
  threads: DmThread[];
  /** Threads with a message that came while they were not open. */
  fresh: number[];
  /** Who is in each kitchen's own room now. Everyone's list is the whole platform and is not kept. */
  presence: Record<string, BenchPerson[]>;
  room: RoomState | null;
}

export const MAX_BODY = 5000;
const CONFIRM_MS = 10_000;
const REJOIN_MS = 30_000;
const SECOND_JOIN_MS = 1_500;
const SECOND_READ_MS = 2_500;
const TYPING_SHOWN_MS = 3_000;
const TYPING_SENT_MS = 2_000;
const NO_ACCESS = "You don't have access to this channel any more.";
const NOT_CONNECTED = "Not connected. Try again when you're back online.";

export function benchFailure(err: unknown): string {
  if (!(err instanceof ApiError)) return "Something went wrong. Try again.";
  if (err.code === "network") return "Can't reach the server. Check your signal and try again.";
  if (err.code === "forbidden" || err.code === "not_found") return NO_ACCESS;
  return err.message;
}

const isKitchen = (room: Room) => room.kind === "channel" && room.key.startsWith("org_");
export const sameRoom = (a: Room, b: Room) => (a.kind === "dm" ? b.kind === "dm" && a.threadId === b.threadId : b.kind === "channel" && a.key === b.key);
const nameOf = (room: Room) => (room.kind === "dm" ? `dm_${room.threadId}` : room.key);
const inOrder = (a: BenchMessage, b: BenchMessage) => Date.parse(a.createdDttm) - Date.parse(b.createdDttm) || a.messageId.localeCompare(b.messageId);

type Change = (messages: BenchMessage[]) => BenchMessage[];

export function createBenchStore({ api, live, userId, now, newId }: { api: BenchApi; live: BenchLive; userId: number; now: () => number; newId: () => string }) {
  let snapshot: BenchSnapshot = { lists: "loading", listError: null, channels: [], threads: [], fresh: [], presence: {}, room: null };
  const listeners = new Set<() => void>();
  /** One visit to one room: an answer, a timer or a change that belongs to an earlier visit is dropped. */
  interface Visit {
    room: Room;
    /** Which messages are this room's; known once the lists are. */
    channelId: number | null;
    otherUserId: number | null;
    reading: Promise<boolean> | null;
    queued: Promise<boolean> | null;
    /** Changes that came while a page was on its way. */
    replay: Change[] | null;
    timers: Set<ReturnType<typeof setTimeout>>;
  }
  let visit: Visit | null = null;
  const pendingOf = new Map<string, Pending[]>();
  /** People met in a kitchen's own channel. */
  const colleagues = new Set<number>();
  const typingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  let typingSent = 0;

  const set = (next: Partial<BenchSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };
  const setRoom = (next: Partial<RoomState>) => snapshot.room && set({ room: { ...snapshot.room, ...next } });
  const pendings = (room: Room) => pendingOf.get(nameOf(room)) ?? [];
  function setPendings(room: Room, next: Pending[]) {
    pendingOf.set(nameOf(room), next);
    if (visit && sameRoom(visit.room, room)) setRoom({ pending: next.map(({ id, body, status }) => ({ id, body, status })) });
  }
  function later(v: Visit, ms: number, run: () => void) {
    const timer = setTimeout(() => {
      v.timers.delete(timer);
      if (visit === v) run();
    }, ms);
    v.timers.add(timer);
  }

  // ── Messages ──────────────────────────────────────────────

  const belongs = (v: Visit, m: BenchMessage) => (v.room.kind === "dm" ? m.dmThreadId === v.room.threadId : m.dmThreadId === null && m.channelId === v.channelId);

  function meet(room: Room, messages: BenchMessage[]) {
    if (isKitchen(room)) for (const m of messages) if (m.userId !== userId) colleagues.add(m.userId);
  }

  /** Takes the posts with these ids out of the waiting list: the server has them, or had them and they were deleted since. */
  function settle(room: Room, ids: unknown[]) {
    const waiting = pendings(room);
    const left = waiting.filter((p) => !ids.includes(p.id));
    if (left.length < waiting.length) setPendings(room, left);
  }

  /** A change from the live channel: shown now, and laid again over a page that is on its way. */
  function change(apply: Change) {
    if (!visit || !snapshot.room) return;
    visit.replay?.push(apply);
    setRoom({ messages: apply(snapshot.room.messages) });
  }

  const adding = (m: BenchMessage): Change => (all) => [...all.filter((x) => x.messageId !== m.messageId), m].sort(inOrder);

  /** The latest page laid over what is on screen: what is inside its window and not in it was deleted. */
  function merge(current: BenchMessage[], page: BenchMessage[], hadOlder: boolean): { messages: BenchMessage[]; hasOlder: boolean } {
    if (page.length < PAGE) return { messages: page, hasOlder: false };
    const inPage = new Set(page.map((m) => m.messageId));
    // Nothing in common: more came than a page holds, so start again from here rather than hide the hole.
    if (!current.some((m) => inPage.has(m.messageId))) return { messages: page, hasOlder: true };
    const older = current.filter((m) => !inPage.has(m.messageId) && inOrder(m, page[0]) < 0);
    return { messages: [...older, ...page], hasOlder: older.length > 0 ? hadOlder : true };
  }

  /** True when the server's list was read. */
  async function read(v: Visit): Promise<boolean> {
    const startedAt = now();
    const replay: Change[] = (v.replay = []);
    try {
      const page = (await api.messages(v.room)).filter((m) => belongs(v, m)).sort(inOrder);
      if (visit !== v || !snapshot.room) return false;
      const merged = merge(snapshot.room.messages, page, snapshot.room.hasOlder);
      const messages = replay.reduce((all, apply) => apply(all), merged.messages);
      meet(v.room, messages);
      setRoom({ phase: "ready", error: null, hasOlder: merged.hasOlder, messages });
      settle(v.room, messages.map((m) => m.messageId));
      const waiting = pendings(v.room);
      if (waiting.some((p) => p.status === "sending" && p.due <= startedAt)) setPendings(v.room, waiting.map((p) => (p.status === "sending" && p.due <= startedAt ? { ...p, status: "failed" } : p)));
      return true;
    } catch (err) {
      if (visit !== v || !snapshot.room) return false;
      const refused = err instanceof ApiError && (err.code === "forbidden" || err.code === "not_found");
      // What was read before stays on screen when only the signal is gone; never after a refusal.
      if (refused) setRoom({ phase: "error", messages: [], hasOlder: false, typing: [], error: NO_ACCESS });
      else if (snapshot.room.phase !== "ready") setRoom({ phase: "error", error: benchFailure(err) });
      return false;
    } finally {
      v.replay = null;
    }
  }

  /** One read at a time; one asked for meanwhile starts after it, so its answer is never older than the asking. */
  function resync(): Promise<boolean> {
    const v = visit;
    if (!v) return Promise.resolve(false);
    if (!v.reading) return (v.reading = read(v).finally(() => void (v.reading = null)));
    return (v.queued ??= v.reading.then(() => {
      v.queued = null;
      return visit === v ? resync() : false;
    }));
  }

  /**
   * Into the room (again): join and read, then both once more a moment later. Neither is acknowledged: the second join is for a first that did not
   * take, the second read for what fell between the first answer and the join.
   */
  function enter(v: Visit): Promise<boolean> {
    const join = () => isKitchen(v.room) && live.send("bench:join", { channelKey: nameOf(v.room) });
    join();
    later(v, SECOND_JOIN_MS, join);
    later(v, SECOND_READ_MS, () => void resync());
    return resync();
  }

  /** Ten seconds on, a post that has not come back is looked for on the server's list. */
  function confirmLater(v: Visit, id: string) {
    later(v, CONFIRM_MS, () => {
      if (pendings(v.room).some((p) => p.id === id)) void resync();
    });
  }

  function stayPresent(v: Visit) {
    // Joining again asks for the list of who is here, which would otherwise go stale.
    later(v, REJOIN_MS, () => {
      live.send("bench:join", { channelKey: nameOf(v.room) });
      stayPresent(v);
    });
  }

  function leave() {
    if (!visit) return;
    visit.timers.forEach(clearTimeout);
    typingTimers.forEach(clearTimeout);
    typingTimers.clear();
    if (isKitchen(visit.room)) live.send("bench:leave", { channelKey: nameOf(visit.room) });
    visit = null;
    set({ room: null });
  }

  // ── Lists ─────────────────────────────────────────────────

  let listsRead = 0;
  async function refreshLists(): Promise<void> {
    const mine = ++listsRead;
    try {
      const [channels, threads] = await Promise.all([api.channels(), api.threads()]);
      if (mine !== listsRead) return;
      // A thread just started has no message yet, and the server lists only threads that have one.
      const started = snapshot.threads.filter((t) => t.lastMessage === null && !threads.some((x) => x.dmThreadId === t.dmThreadId));
      set({ lists: "ready", listError: null, channels, threads: [...threads, ...started] });
    } catch (err) {
      if (mine !== listsRead) return;
      set(snapshot.lists === "ready" ? { listError: benchFailure(err) } : { lists: "error", listError: benchFailure(err) });
    }
  }

  // ── The live channel ──────────────────────────────────────

  const obj = (p: unknown) => (p && typeof p === "object" ? (p as Record<string, unknown>) : {});
  const parsed = (p: unknown): BenchMessage | null => {
    const m = BenchMessageSchema.safeParse(p);
    return m.success ? { ...m.data, userPhotoPath: api.whole(m.data.userPhotoPath) } : null;
  };

  function arrived(m: BenchMessage) {
    if (!visit || !belongs(visit, m)) return;
    meet(visit.room, [m]);
    const first = snapshot.room?.messages[0];
    // The answer to a post sent again can be older than what is loaded. It is in the history; here it would hide what lies between.
    if (!snapshot.room?.hasOlder || !first || inOrder(m, first) > 0) change(adding(m));
    stopTyping(m.userId);
    settle(visit.room, [m.messageId]);
  }

  function stopTyping(id: number) {
    clearTimeout(typingTimers.get(id));
    typingTimers.delete(id);
    if (snapshot.room?.typing.some((t) => t.userId === id)) setRoom({ typing: snapshot.room.typing.filter((t) => t.userId !== id) });
  }

  live.on("bench:message:new", (p) => {
    const m = parsed(p);
    if (m && m.dmThreadId === null) arrived(m);
  });
  live.on("bench:dm:new", (p) => {
    const m = parsed(p);
    if (!m || m.dmThreadId === null) return;
    const threadId = m.dmThreadId;
    const open = visit?.room.kind === "dm" && visit.room.threadId === threadId;
    const known = snapshot.threads.find((t) => t.dmThreadId === threadId);
    if (!open && m.userId !== userId && !snapshot.fresh.includes(threadId)) set({ fresh: [...snapshot.fresh, threadId] });
    if (known) set({ threads: [{ ...known, lastMessage: m.messageBody, lastMessageAt: m.createdDttm }, ...snapshot.threads.filter((t) => t !== known)] });
    else void refreshLists();
    arrived(m);
  });
  live.on("bench:message:deleted", (p) => {
    const { messageId } = obj(p);
    change((all) => all.filter((m) => m.messageId !== messageId));
    if (visit) settle(visit.room, [messageId]);
  });
  live.on("bench:message:edited", (p) => {
    const { messageId, newBody } = obj(p);
    if (typeof newBody === "string") change((all) => all.map((m) => (m.messageId === messageId ? { ...m, messageBody: newBody, editedInd: true } : m)));
  });
  live.on("bench:reaction:updated", (p) => {
    const { messageId, reactions } = obj(p);
    const read = ReactionListSchema.safeParse(reactions);
    if (read.success) change((all) => all.map((m) => (m.messageId === messageId ? { ...m, reactions: read.data } : m)));
  });
  live.on("bench:presence:update", (p) => {
    const seen = PresenceSchema.safeParse(p);
    if (!seen.success || !seen.data.channelKey.startsWith("org_")) return;
    const users = seen.data.users.map((u) => ({ ...u, userPhotoPath: api.whole(u.userPhotoPath) }));
    for (const u of users) if (u.userId !== userId) colleagues.add(u.userId);
    set({ presence: { ...snapshot.presence, [seen.data.channelKey]: users } });
  });
  live.on("bench:typing", (p) => {
    const { channelKey, userId: who, userName } = obj(p);
    if (!visit || !snapshot.room || channelKey !== nameOf(visit.room) || typeof who !== "number" || who === userId) return;
    clearTimeout(typingTimers.get(who));
    typingTimers.set(who, setTimeout(() => stopTyping(who), TYPING_SHOWN_MS));
    if (!snapshot.room.typing.some((t) => t.userId === who)) setRoom({ typing: [...snapshot.room.typing, { userId: who, userName: typeof userName === "string" ? userName : "Someone" }] });
  });
  live.on("bench:error", (p) => {
    if (obj(p).code === "FORBIDDEN") setRoom({ phase: "error", messages: [], hasOlder: false, typing: [], error: NO_ACCESS });
    else setRoom({ notice: "That didn't go through. Try again." });
  });
  const offConnect = live.onConnect(() => {
    void refreshLists();
    if (visit) void enter(visit);
  });

  /** False, with a notice, when there is no connection: it was not kept to be sent later. */
  function act(event: string, payload: unknown): boolean {
    const sent = live.send(event, payload);
    setRoom({ notice: sent ? null : NOT_CONNECTED });
    return sent;
  }

  function emitPost(v: Visit, messageId: string, body: string): boolean {
    return v.room.kind === "dm" ? live.send("bench:dm:send", { recipientId: v.otherUserId, body, messageId }) : live.send("bench:message", { channelKey: v.room.key, body, messageId });
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    refreshLists,
    resync,

    async open(room: Room): Promise<void> {
      leave();
      const v: Visit = { room, channelId: null, otherUserId: null, reading: null, queued: null, replay: null, timers: new Set() };
      visit = v;
      const threadId = room.kind === "dm" ? room.threadId : null;
      set({ fresh: snapshot.fresh.filter((id) => id !== threadId), room: { room, phase: "loading", messages: [], pending: [], hasOlder: false, loadingOlder: false, error: null, notice: null, typing: [] } });
      setPendings(room, pendings(room));
      const find = () => {
        v.channelId = room.kind === "channel" ? (snapshot.channels.find((c) => c.channelKey === room.key)?.channelId ?? null) : null;
        v.otherUserId = room.kind === "dm" ? (snapshot.threads.find((t) => t.dmThreadId === room.threadId)?.otherUserId ?? null) : null;
        return v.channelId !== null || v.otherUserId !== null;
      };
      if (!find()) {
        await refreshLists();
        if (visit !== v) return;
        if (!find()) return void setRoom({ phase: "error", error: snapshot.listError ?? NO_ACCESS });
      }
      if (isKitchen(room)) stayPresent(v);
      await enter(v);
    },

    /** Leaves the room, if it is still the open one. */
    close(room: Room) {
      if (visit && sameRoom(visit.room, room)) leave();
    },

    async loadOlder(): Promise<void> {
      const v = visit;
      const first = snapshot.room?.messages[0];
      if (!v || !first || !snapshot.room?.hasOlder || snapshot.room.loadingOlder) return;
      setRoom({ loadingOlder: true, notice: null });
      try {
        const older = (await api.messages(v.room, first.createdDttm)).filter((m) => belongs(v, m)).sort(inOrder);
        if (visit !== v || !snapshot.room) return;
        // The list was started again meanwhile: these are from before the hole.
        if (snapshot.room.messages[0]?.messageId !== first.messageId) {
          setRoom({ loadingOlder: false });
          return;
        }
        const known = new Set(snapshot.room.messages.map((m) => m.messageId));
        meet(v.room, older);
        setRoom({ messages: [...older.filter((m) => !known.has(m.messageId)), ...snapshot.room.messages], hasOlder: older.length >= PAGE, loadingOlder: false });
      } catch (err) {
        if (visit === v) setRoom({ loadingOlder: false, notice: benchFailure(err) });
      }
    },

    /** Posts to the open room. False when there is nothing to post or it is too long. */
    post(text: string): boolean {
      const v = visit;
      const body = text.trim();
      if (!v || !snapshot.room || !body || body.length > MAX_BODY) return false;
      const id = newId();
      const sent = emitPost(v, id, body);
      setPendings(v.room, [...pendings(v.room), { id, body, status: sent ? "sending" : "failed", due: now() + CONFIRM_MS }]);
      if (sent) confirmLater(v, id);
      return true;
    },

    /** Looks on the server first: the post may have arrived after all. Posts again only when a list read now does not have it. */
    async retry(id: string): Promise<void> {
      const v = visit;
      if (!v || live.getStatus() !== "online" || !(await resync()) || visit !== v) return;
      const post = pendings(v.room).find((p) => p.id === id && p.status === "failed");
      if (!post || !emitPost(v, id, post.body)) return;
      setPendings(v.room, pendings(v.room).map((p) => (p.id === id ? { ...p, status: "sending", due: now() + CONFIRM_MS } : p)));
      confirmLater(v, id);
    },

    discard(id: string) {
      if (visit) setPendings(visit.room, pendings(visit.room).filter((p) => p.id !== id));
    },

    typing() {
      if (visit?.room.kind !== "channel" || now() - typingSent < TYPING_SENT_MS) return;
      typingSent = now();
      live.send("bench:typing", { channelKey: visit.room.key });
    },

    react(messageId: string, emoji: string): boolean {
      const mine = snapshot.room?.messages.find((m) => m.messageId === messageId)?.reactions.some((r) => r.emoji === emoji && r.userIds.includes(userId));
      return act(mine ? "bench:reaction:remove" : "bench:reaction:add", { messageId, emoji });
    },
    edit(messageId: string, text: string): boolean {
      const newBody = text.trim();
      return newBody !== "" && newBody.length <= MAX_BODY && act("bench:message:edit", { messageId, newBody });
    },
    remove: (messageId: string) => act("bench:message:delete", { messageId }),

    /** Direct messages go to people of one's own kitchens (met in a kitchen's channel) and to threads there already are. */
    canMessage: (id: number) => id !== userId && (colleagues.has(id) || snapshot.threads.some((t) => t.otherUserId === id)),

    /** The thread with this person, started if there is none; null when it could not be. */
    async startThread(id: number): Promise<number | null> {
      const known = snapshot.threads.find((t) => t.otherUserId === id);
      if (known) return known.dmThreadId;
      if (id === userId || !colleagues.has(id)) return null;
      try {
        const thread = await api.openThread(id);
        set({ threads: [thread, ...snapshot.threads.filter((t) => t.dmThreadId !== thread.dmThreadId)] });
        return thread.dmThreadId;
      } catch (err) {
        setRoom({ notice: benchFailure(err) });
        return null;
      }
    },

    dispose() {
      leave();
      offConnect();
    },
  };
}

export type BenchStore = ReturnType<typeof createBenchStore>;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BenchChannel, BenchMessage, DmThread } from "@culinaire/shared/schemas/bench";
import { ApiError } from "../api/client";
import { PAGE, type BenchApi, type Room } from "./benchApi";
import type { BenchLive } from "./benchLive";
import { createBenchStore } from "./benchStore";

const at = (n: number) => new Date(Date.UTC(2026, 10, 26, 1, 0, n)).toISOString();
const msg = (n: number, over: Partial<BenchMessage> = {}): BenchMessage => ({ messageId: `m${n}`, channelId: 2, dmThreadId: null, userId: 8, userName: "Bo", userPhotoPath: null, messageBody: `text ${n}`, messageType: "text", recipeTitle: null, editedInd: false, createdDttm: at(n), reactions: [], ...over });
const everyone: BenchChannel = { channelId: 1, channelKey: "everyone", channelName: "Everyone", channelType: "global", channelBanner: null };
const kitchen: BenchChannel = { channelId: 2, channelKey: "org_5", channelName: "Main Kitchen", channelType: "organisation", channelBanner: null };
const thread: DmThread = { dmThreadId: 3, otherUserId: 8, otherUserName: "Bo", otherUserPhotoPath: null, lastMessage: "hi", lastMessageAt: at(1) };
const KITCHEN: Room = { kind: "channel", key: "org_5" };
const EVERYONE: Room = { kind: "channel", key: "everyone" };
const DM: Room = { kind: "dm", threadId: 3 };

function setup() {
  /** What the server has for the room being read, oldest first. */
  const server = { rows: [msg(1), msg(2)] as BenchMessage[] };
  const held: (() => void)[] = [];
  let hold = false;
  const api = {
    channels: vi.fn(async () => [everyone, kitchen]),
    threads: vi.fn(async () => [thread]),
    openThread: vi.fn(async (id: number) => ({ ...thread, dmThreadId: 9, otherUserId: id, lastMessage: null })),
    messages: vi.fn(async (_room: Room, before?: string) => {
      const answer = (before ? server.rows.filter((m) => m.createdDttm < before) : server.rows).slice(-PAGE);
      if (hold) await new Promise<void>((r) => held.push(r));
      return answer;
    }),
    whole: (p: string | null) => p,
  };
  const handlers = new Map<string, (p: unknown) => void>();
  const sent: [string, Record<string, unknown>][] = [];
  let online = true;
  let reconnected: () => void = () => undefined;
  const live = {
    getStatus: () => (online ? "online" : "connecting"),
    subscribe: () => () => undefined,
    onConnect: (l: () => void) => ((reconnected = l), () => undefined),
    on: (e: string, h: (p: unknown) => void) => void handlers.set(e, h),
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn((e: string, p: Record<string, unknown>) => (online ? (sent.push([e, p]), true) : false)),
  };
  let n = 0;
  const store = createBenchStore({ api: api as unknown as BenchApi, live: live as unknown as BenchLive, userId: 7, now: () => Date.now(), newId: () => `p${++n}` });
  return {
    store, api, server, sent, live,
    room: () => store.getSnapshot().room!,
    ids: () => store.getSnapshot().room!.messages.map((m) => m.messageId),
    pending: () => store.getSnapshot().room!.pending.map((p) => [p.body, p.status]),
    arrive: (event: string, payload: unknown) => handlers.get(event)!(payload),
    drop: () => void (online = false),
    back: () => ((online = true), reconnected()),
    /** Later answers wait until `release`. */
    holdAnswers: () => void (hold = true),
    release: () => ((hold = false), held.splice(0).forEach((r) => r())),
    tick: (ms = 0) => vi.advanceTimersByTimeAsync(ms),
  };
}

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe("opening a room", () => {
  it("joins a kitchen's room and shows its latest messages; leaving it leaves the room", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    expect(t.sent).toContainEqual(["bench:join", { channelKey: "org_5" }]);
    expect(t.ids()).toEqual(["m1", "m2"]);
    expect(t.room()).toMatchObject({ phase: "ready", hasOlder: false });
    t.store.close(KITCHEN);
    expect(t.sent).toContainEqual(["bench:leave", { channelKey: "org_5" }]);
    expect(t.store.getSnapshot().room).toBeNull();
  });

  it("joins nothing for Everyone and direct messages: the server sends those by itself", async () => {
    const t = setup();
    await t.store.open(EVERYONE);
    await t.store.open(DM);
    expect(t.sent.map(([e]) => e)).not.toContain("bench:join");
  });

  it("reads the list again a moment after opening: a message between the answer and the join would be in neither", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.server.rows.push(msg(3));
    await t.tick(2_500);
    expect(t.ids()).toEqual(["m1", "m2", "m3"]);
  });

  // A join is not acknowledged, so it is sent again.
  it("joins a kitchen's room a second time after each connect, before the second read", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    await t.tick(5_000);
    t.sent.length = 0;
    t.back();
    await t.tick();
    const joins = () => t.sent.filter(([e]) => e === "bench:join").length;
    expect(joins()).toBe(1);
    const reads = t.api.messages.mock.calls.length;
    await t.tick(1_500);
    expect(joins()).toBe(2);
    expect(t.api.messages.mock.calls.length).toBe(reads);
    await t.tick(1_000);
    expect(t.api.messages.mock.calls.length).toBe(reads + 1);
  });

  it("an answer for a room no longer open is dropped", async () => {
    const t = setup();
    t.holdAnswers();
    const first = t.store.open(KITCHEN);
    await t.tick();
    t.server.rows = [msg(9, { channelId: null, dmThreadId: 3 })];
    const second = t.store.open(DM);
    await t.tick();
    t.release();
    await first;
    await second;
    expect(t.ids()).toEqual(["m9"]);
  });

  it("closing a room that is no longer the open one changes nothing", async () => {
    const t = setup();
    await t.store.open(DM);
    t.store.close(KITCHEN);
    expect(t.room().room).toEqual(DM);
  });

  it("loads older messages above, and knows the end of the history", async () => {
    const t = setup();
    t.server.rows = Array.from({ length: PAGE + 10 }, (_, i) => msg(i + 1));
    await t.store.open(KITCHEN);
    expect(t.room().hasOlder).toBe(true);
    await t.store.loadOlder();
    expect(t.ids()).toHaveLength(PAGE + 10);
    expect(t.ids()[0]).toBe("m1");
    expect(t.room().hasOlder).toBe(false);
  });

  it("a refusal clears the room: someone removed from the kitchen keeps nothing on screen", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.api.messages.mockRejectedValueOnce(new ApiError("forbidden", "Not a member of this organisation"));
    t.back();
    await t.tick();
    expect(t.room()).toMatchObject({ phase: "error", messages: [] });
  });

  it("no signal on opening says so; a failed refresh keeps what is on screen", async () => {
    const t = setup();
    t.api.messages.mockRejectedValueOnce(new ApiError("network"));
    await t.store.open(KITCHEN);
    expect(t.room()).toMatchObject({ phase: "error", error: "Can't reach the server. Check your signal and try again." });
    await t.store.resync();
    expect(t.room().phase).toBe("ready");
    t.api.messages.mockRejectedValueOnce(new ApiError("network"));
    await t.store.resync();
    expect(t.room()).toMatchObject({ phase: "ready" });
    expect(t.ids()).toEqual(["m1", "m2"]);
  });
});

describe("messages as they happen", () => {
  it("shows a message in its own room only (the web shows Everyone's in My Kitchen)", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.arrive("bench:message:new", msg(3, { channelId: 1 }));
    t.arrive("bench:dm:new", msg(4, { channelId: null, dmThreadId: 3 }));
    t.arrive("bench:message:new", msg(5));
    t.arrive("bench:message:new", "junk");
    expect(t.ids()).toEqual(["m1", "m2", "m5"]);
  });

  it("keeps the server's order, not the order of arrival, and never shows one twice", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.arrive("bench:message:new", msg(5));
    t.arrive("bench:message:new", msg(4));
    t.arrive("bench:message:new", msg(5));
    expect(t.ids()).toEqual(["m1", "m2", "m4", "m5"]);
  });

  it("applies edits, reactions and deletions", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.arrive("bench:message:edited", { messageId: "m1", newBody: "changed", editedInd: true });
    t.arrive("bench:reaction:updated", { messageId: "m1", reactions: [{ emoji: "fire", count: 1, userIds: [8] }] });
    t.arrive("bench:message:deleted", { messageId: "m2" });
    expect(t.room().messages).toMatchObject([{ messageId: "m1", messageBody: "changed", editedInd: true, reactions: [{ emoji: "fire", userIds: [8] }] }]);
  });

  it("what happens while a list is on its way is kept over the older list", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.holdAnswers();
    const reading = t.store.resync();
    await t.tick();
    t.arrive("bench:message:new", msg(3));
    t.arrive("bench:message:deleted", { messageId: "m1" });
    t.arrive("bench:message:edited", { messageId: "m2", newBody: "new", editedInd: true });
    t.release();
    await reading;
    expect(t.room().messages.map((m) => [m.messageId, m.messageBody])).toEqual([["m2", "new"], ["m3", "text 3"]]);
  });
});

describe("coming back (a drop, or the app from the background)", () => {
  it("joins again and reads what was missed: new, edited and deleted", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.drop();
    t.server.rows = [msg(1, { messageBody: "edited", editedInd: true }), msg(3)];
    t.sent.length = 0;
    t.back();
    await t.tick();
    expect(t.sent).toContainEqual(["bench:join", { channelKey: "org_5" }]);
    expect(t.room().messages.map((m) => m.messageBody)).toEqual(["edited", "text 3"]);
  });

  it("a gap longer than a page starts again from the latest page instead of hiding the hole", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.server.rows = [msg(1), msg(2), ...Array.from({ length: PAGE + 20 }, (_, i) => msg(i + 100))];
    t.back();
    await t.tick();
    expect(t.ids()).toHaveLength(PAGE);
    expect(t.ids()[0]).toBe("m120");
    expect(t.room().hasOlder).toBe(true);
  });

  it("keeps the older pages already loaded when there is no gap", async () => {
    const t = setup();
    t.server.rows = Array.from({ length: PAGE + 10 }, (_, i) => msg(i + 1));
    await t.store.open(KITCHEN);
    await t.store.loadOlder();
    t.server.rows.push(msg(500));
    t.back();
    await t.tick();
    expect(t.ids()).toHaveLength(PAGE + 11);
  });
});

describe("posting", () => {
  it("shows it at once as sending, then as sent when the server's own copy arrives", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.store.post("  Heard  ");
    expect(t.sent).toContainEqual(["bench:message", { channelKey: "org_5", body: "Heard" }]);
    expect(t.pending()).toEqual([["Heard", "sending"]]);
    t.arrive("bench:message:new", msg(3, { userId: 7, messageBody: "Heard" }));
    expect(t.pending()).toEqual([]);
    expect(t.ids()).toEqual(["m1", "m2", "m3"]);
  });

  it("sends a direct message to the other person", async () => {
    const t = setup();
    t.server.rows = [];
    await t.store.open(DM);
    t.store.post("Morning");
    expect(t.sent).toContainEqual(["bench:dm:send", { recipientId: 8, body: "Morning" }]);
    t.arrive("bench:dm:new", msg(3, { channelId: null, dmThreadId: 3, userId: 7, messageBody: "Morning" }));
    expect(t.pending()).toEqual([]);
  });

  it("posts nothing empty or over the server's limit", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    expect(t.store.post("   ")).toBe(false);
    expect(t.store.post("x".repeat(5001))).toBe(false);
    expect(t.pending()).toEqual([]);
  });

  it("with no connection it is not sent, and never sends itself later", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.drop();
    t.store.post("Heard");
    expect(t.pending()).toEqual([["Heard", "failed"]]);
    t.back();
    await t.tick(60_000);
    expect(t.sent.filter(([e]) => e === "bench:message")).toEqual([]);
    expect(t.pending()).toEqual([["Heard", "failed"]]);
  });

  it("a lost echo is found on the server's list instead of being called not sent", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.store.post("Heard");
    t.server.rows.push(msg(3, { userId: 7, messageBody: "Heard" }));
    await t.tick(10_500);
    expect(t.pending()).toEqual([]);
    expect(t.ids()).toEqual(["m1", "m2", "m3"]);
  });

  it("is not sent when the server's list, read after ten seconds, does not have it", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.store.post("Heard");
    await t.tick(10_500);
    expect(t.pending()).toEqual([["Heard", "failed"]]);
  });

  it("stays undecided while there is no connection: only a list read after coming back settles it", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.store.post("Heard");
    t.drop();
    t.api.messages.mockRejectedValue(new ApiError("network"));
    await t.tick(60_000);
    expect(t.pending()).toEqual([["Heard", "sending"]]);
    t.api.messages.mockReset();
    t.api.messages.mockImplementation(async () => [msg(1), msg(2), msg(3, { userId: 7, messageBody: "Heard" })]);
    t.back();
    await t.tick();
    expect(t.pending()).toEqual([]);
  });

  it("an earlier message with the same words does not count as this one", async () => {
    const t = setup();
    t.server.rows = [msg(1, { userId: 7, messageBody: "Heard" }), msg(2)];
    await t.store.open(KITCHEN);
    t.store.post("Heard");
    await t.tick(10_500);
    expect(t.pending()).toEqual([["Heard", "failed"]]);
  });

  it("nor does an older one with the same words loaded from the history", async () => {
    const t = setup();
    t.server.rows = [msg(1, { userId: 7, messageBody: "Heard" }), ...Array.from({ length: PAGE }, (_, i) => msg(i + 2))];
    await t.store.open(KITCHEN);
    t.store.post("Heard");
    await t.store.loadOlder();
    expect(t.pending()).toEqual([["Heard", "sending"]]);
  });

  it("the same words posted twice need two echoes", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.store.post("Heard");
    t.store.post("Heard");
    t.arrive("bench:message:new", msg(3, { userId: 7, messageBody: "Heard" }));
    expect(t.pending()).toEqual([["Heard", "sending"]]);
    // The same echo again (the list has it too) settles nothing more.
    t.arrive("bench:message:new", msg(3, { userId: 7, messageBody: "Heard" }));
    expect(t.pending()).toEqual([["Heard", "sending"]]);
    t.arrive("bench:message:new", msg(4, { userId: 7, messageBody: "Heard" }));
    expect(t.pending()).toEqual([]);
  });

  it("someone else's message with the same words is not this one", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.store.post("Heard");
    t.arrive("bench:message:new", msg(3, { messageBody: "Heard" }));
    expect(t.pending()).toEqual([["Heard", "sending"]]);
  });

  it("an echo that comes after it was called not sent still settles it", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.store.post("Heard");
    await t.tick(10_500);
    t.arrive("bench:message:new", msg(3, { userId: 7, messageBody: "Heard" }));
    expect(t.pending()).toEqual([]);
  });

  it("Try again looks on the server first, and posts only when it is not there", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.store.post("Heard");
    await t.tick(10_500);
    const posts = () => t.sent.filter(([e]) => e === "bench:message").length;
    t.server.rows.push(msg(3, { userId: 7, messageBody: "Heard" }));
    await t.store.retry("p1");
    expect(posts()).toBe(1);
    expect(t.pending()).toEqual([]);
    t.store.post("Again");
    await t.tick(10_500);
    await t.store.retry("p2");
    expect(posts()).toBe(3);
    expect(t.pending()).toEqual([["Again", "sending"]]);
  });

  it("Try again without a connection, or when the list could not be read, posts nothing", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.store.post("Heard");
    await t.tick(10_500);
    t.api.messages.mockRejectedValueOnce(new ApiError("network"));
    await t.store.retry("p1");
    t.drop();
    await t.store.retry("p1");
    expect(t.sent.filter(([e]) => e === "bench:message")).toHaveLength(1);
    expect(t.pending()).toEqual([["Heard", "failed"]]);
  });

  it("Discard drops it for good", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.drop();
    t.store.post("Heard");
    t.store.discard("p1");
    expect(t.pending()).toEqual([]);
  });

  it("an unsent post is still there after leaving the room and coming back", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.drop();
    t.store.post("Heard");
    t.store.close(KITCHEN);
    await t.store.open(KITCHEN);
    expect(t.pending()).toEqual([["Heard", "failed"]]);
  });
});

describe("presence and typing", () => {
  it("keeps who is in each kitchen's own room, and nothing of Everyone's platform-wide list", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.arrive("bench:presence:update", { channelKey: "everyone", users: [{ userId: 99, userName: "Stranger", userPhotoPath: null }] });
    t.arrive("bench:presence:update", { channelKey: "org_5", users: [{ userId: 8, userName: "Bo", userPhotoPath: null }] });
    expect(t.store.getSnapshot().presence).toEqual({ org_5: [{ userId: 8, userName: "Bo", userPhotoPath: null }] });
  });

  it("asks for a kitchen's list again every half minute while it is open: it would otherwise go stale", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    const joins = () => t.sent.filter(([e]) => e === "bench:join").length;
    await t.tick(5_000);
    const settled = joins();
    await t.tick(25_000);
    expect(joins()).toBe(settled + 1);
    await t.tick(30_000);
    expect(joins()).toBe(settled + 2);
    t.store.close(KITCHEN);
    await t.tick(60_000);
    expect(joins()).toBe(settled + 2);
  });

  it("shows who is writing in this room for three seconds, not oneself", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.arrive("bench:typing", { channelKey: "org_5", userId: 8, userName: "Bo" });
    t.arrive("bench:typing", { channelKey: "org_5", userId: 7, userName: "Me" });
    t.arrive("bench:typing", { channelKey: "everyone", userId: 9, userName: "Cy" });
    expect(t.room().typing.map((p) => p.userName)).toEqual(["Bo"]);
    await t.tick(3_100);
    expect(t.room().typing).toEqual([]);
  });

  it("stops showing someone as writing once their message is here", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.arrive("bench:typing", { channelKey: "org_5", userId: 8, userName: "Bo" });
    t.arrive("bench:message:new", msg(3));
    expect(t.room().typing).toEqual([]);
  });

  it("says one is writing at most every two seconds, and not in direct messages (as the web)", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.store.typing();
    t.store.typing();
    await t.tick(2_100);
    t.store.typing();
    expect(t.sent.filter(([e]) => e === "bench:typing")).toHaveLength(2);
    await t.store.open(DM);
    await t.tick(5_000);
    t.store.typing();
    expect(t.sent.filter(([e]) => e === "bench:typing")).toHaveLength(2);
  });
});

describe("reacting, editing, deleting", () => {
  it("goes over the live channel, and says when it could not go out", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.store.react("m1", "fire");
    t.arrive("bench:reaction:updated", { messageId: "m1", reactions: [{ emoji: "fire", count: 1, userIds: [7] }] });
    t.store.react("m1", "fire");
    t.store.edit("m1", " new ");
    t.store.remove("m1");
    expect(t.sent.slice(-4)).toEqual([
      ["bench:reaction:add", { messageId: "m1", emoji: "fire" }],
      ["bench:reaction:remove", { messageId: "m1", emoji: "fire" }],
      ["bench:message:edit", { messageId: "m1", newBody: "new" }],
      ["bench:message:delete", { messageId: "m1" }],
    ]);
    t.drop();
    expect(t.store.remove("m1")).toBe(false);
    expect(t.room().notice).toBe("Not connected. Try again when you're back online.");
  });

  it("a server refusal shows as a notice; losing the channel closes it", async () => {
    const t = setup();
    await t.store.open(KITCHEN);
    t.arrive("bench:error", { error: "Failed to send message" });
    expect(t.room().notice).toBe("That didn't go through. Try again.");
    t.arrive("bench:error", { error: "You cannot join this channel", code: "FORBIDDEN" });
    expect(t.room()).toMatchObject({ phase: "error", messages: [], error: "You don't have access to this channel any more." });
  });
});

describe("the lists", () => {
  it("loads the channels and the threads", async () => {
    const t = setup();
    await t.store.refreshLists();
    expect(t.store.getSnapshot()).toMatchObject({ lists: "ready", channels: [everyone, kitchen], threads: [thread] });
  });

  it("a new direct message moves its thread to the top, with a mark until it is opened", async () => {
    const t = setup();
    t.api.threads.mockResolvedValue([{ ...thread, dmThreadId: 4, otherUserId: 10, otherUserName: "Cy" }, thread]);
    await t.store.refreshLists();
    t.arrive("bench:dm:new", msg(5, { channelId: null, dmThreadId: 3, messageBody: "Lunch?" }));
    expect(t.store.getSnapshot().threads[0]).toMatchObject({ dmThreadId: 3, lastMessage: "Lunch?", lastMessageAt: at(5) });
    expect(t.store.getSnapshot().fresh).toEqual([3]);
    await t.store.open(DM);
    expect(t.store.getSnapshot().fresh).toEqual([]);
  });

  it("one's own message from another device puts no mark; a thread not listed yet is fetched", async () => {
    const t = setup();
    await t.store.refreshLists();
    t.arrive("bench:dm:new", msg(5, { channelId: null, dmThreadId: 3, userId: 7 }));
    expect(t.store.getSnapshot().fresh).toEqual([]);
    const calls = t.api.threads.mock.calls.length;
    t.arrive("bench:dm:new", msg(6, { channelId: null, dmThreadId: 77 }));
    expect(t.api.threads.mock.calls.length).toBe(calls + 1);
    expect(t.store.getSnapshot().fresh).toEqual([77]); // the first message of a thread is as new as any
  });

  it("offers direct messages only to people seen in a kitchen's own channel or already in a thread", async () => {
    const t = setup();
    await t.store.refreshLists();
    expect(t.store.canMessage(8)).toBe(true); // a thread
    expect(t.store.canMessage(20)).toBe(false);
    t.arrive("bench:presence:update", { channelKey: "org_5", users: [{ userId: 20, userName: "Di", userPhotoPath: null }] });
    expect(t.store.canMessage(20)).toBe(true);
    expect(t.store.canMessage(7)).toBe(false); // oneself
    t.server.rows = [msg(1, { userId: 30, channelId: 1 })];
    await t.store.open(EVERYONE);
    expect(t.store.canMessage(30)).toBe(false); // only met in Everyone
    t.server.rows = [msg(1, { userId: 31 })];
    await t.store.open(KITCHEN);
    expect(t.store.canMessage(31)).toBe(true);
  });

  it("starts a thread with a colleague and lists it", async () => {
    const t = setup();
    await t.store.refreshLists();
    t.arrive("bench:presence:update", { channelKey: "org_5", users: [{ userId: 20, userName: "Di", userPhotoPath: null }] });
    expect(await t.store.startThread(20)).toBe(9);
    expect(t.store.getSnapshot().threads.map((x) => x.dmThreadId)).toContain(9);
    expect(await t.store.startThread(8)).toBe(3); // the one there is, without asking the server
    expect(t.api.openThread).toHaveBeenCalledTimes(1);
  });

  it("keeps the lists on screen when a refresh fails, and says so when there is nothing", async () => {
    const t = setup();
    t.api.channels.mockRejectedValueOnce(new ApiError("network"));
    await t.store.refreshLists();
    expect(t.store.getSnapshot()).toMatchObject({ lists: "error", listError: "Can't reach the server. Check your signal and try again." });
    await t.store.refreshLists();
    t.api.channels.mockRejectedValueOnce(new ApiError("network"));
    await t.store.refreshLists();
    expect(t.store.getSnapshot()).toMatchObject({ lists: "ready", channels: [everyone, kitchen] });
  });
});

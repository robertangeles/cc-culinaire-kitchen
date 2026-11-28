import { describe, it, expect, beforeAll, afterAll, inject, vi } from "vitest";
import { io } from "socket.io-client";
import { createApiClient, type Tokens } from "../src/api/client";
import { createAuthApi } from "../src/api/auth";
import { createAccountApi } from "../src/api/account";
import { createBenchApi } from "../src/bench/benchApi";
import { createBenchLive } from "../src/bench/benchLive";
import { createBenchStore } from "../src/bench/benchStore";
import { newUuid } from "../src/outbox/uuid";

/**
 * The Bench against a real server and real sockets, with the phone's own code and no UI: two colleagues (Ann and Bo, who join the E2E user's
 * organisation by its key) and one person in no kitchen (Olga). Posts, reactions, edits, deletes, pins, search, presence, typing and direct
 * messages; a post made with no connection never appears by itself; what was missed while away is there on coming back; Olga gets none of it.
 * Needs the server on E2E_API_URL and the seeded E2E user. Skipped locally without credentials; fails in CI without them.
 */
const baseUrl = process.env.E2E_API_URL ?? "http://localhost:3009";
const tag = Date.now().toString(36);
const PASSWORD = "Phone-Bench-Pass-1!";

async function person(name: string) {
  let tokens: Tokens | null = null;
  const tokenStore = { load: async () => tokens, save: async (t: Tokens) => void (tokens = t), clear: async () => void (tokens = null) };
  const client = createApiClient({ baseUrl, tokenStore, appVersion: "0.1.0-e2e", timeoutMs: 20_000 });
  const authApi = createAuthApi(client, tokenStore);
  const email = `ph-bench-${name.toLowerCase()}-${tag}@culinaire.test`;
  await authApi.register(name, email, PASSWORD);
  const signedIn = await authApi.signIn(email, PASSWORD);
  if (signedIn.status !== "signedIn") throw new Error("expected a plain sign-in");
  // As src/bench/nativeLive.ts, which needs the native modules.
  const socket = io(baseUrl, { autoConnect: false, forceNew: true, transports: ["websocket"], auth: (send) => void tokenStore.load().then((t) => send({ token: t?.accessToken })) });
  const api = createBenchApi(client);
  const live = createBenchLive({ socket, renew: () => api.channels() });
  const userId = signedIn.user.userId;
  const store = createBenchStore({ api, live, userId, now: Date.now, newId: newUuid });
  return {
    name, userId, client, api, live, store, socket,
    room: () => store.getSnapshot().room,
    texts: () => store.getSnapshot().room?.messages.map((m) => m.messageBody) ?? [],
    async end() {
      store.dispose();
      live.stop();
      await createAccountApi(client, tokenStore).deleteAccount({ password: PASSWORD }).catch(() => {});
    },
    /** The sign-in runs out: the next connect carries a token the server refuses, with the refresh token still good. */
    spoilToken: () => void (tokens = { ...tokens!, accessToken: "expired" }),
  };
}
type Person = Awaited<ReturnType<typeof person>>;
const soon = (check: () => void) => vi.waitFor(check, { timeout: 8_000, interval: 100 });

describe.skipIf(!process.env.CI && !process.env.E2E_USER_EMAIL)("the Bench against the real server", () => {
  const people: Person[] = [];
  let ann: Person, bo: Person, olga: Person;
  let key = "";

  beforeAll(async () => {
    const manager = createApiClient({ baseUrl, tokenStore: { load: async () => inject("phoneTokens"), save: async () => {}, clear: async () => {} }, appVersion: "0.1.0-e2e" });
    const { organisation } = await manager.request<{ organisation: { organisationId: number; joinKey: string } }>("GET", "/api/organisations/mine");
    key = `org_${organisation.organisationId}`;
    for (const name of ["Ann", "Bo", "Olga"]) people.push(await person(name));
    [ann, bo, olga] = people;
    for (const p of [ann, bo]) await p.client.request("POST", "/api/organisations/join", { body: { joinKey: organisation.joinKey } });
    for (const p of people) p.live.start();
    await soon(() => expect(people.every((p) => p.live.getStatus() === "online")).toBe(true));
    await Promise.all([ann, bo].map((p) => p.store.open({ kind: "channel", key })));
  });

  afterAll(async () => {
    for (const p of people) await p.end();
  });

  it("a post reaches a colleague, once, and settles on the sender's phone", async () => {
    expect(ann.store.post(`  Fish is in ${tag}  `)).toBe(true);
    await soon(() => expect(bo.texts()).toContain(`Fish is in ${tag}`));
    await soon(() => expect(ann.room()!.pending).toEqual([]));
    expect(ann.texts().filter((t) => t === `Fish is in ${tag}`)).toHaveLength(1);
  });

  it("a post sent twice under one id is one message", async () => {
    const post = { channelKey: key, body: `Once ${tag}`, messageId: newUuid() };
    ann.live.send("bench:message", post);
    ann.live.send("bench:message", post);
    await soon(() => expect(bo.texts()).toContain(post.body));
    expect((await bo.api.messages({ kind: "channel", key })).filter((m) => m.messageBody === post.body).map((m) => m.messageId)).toEqual([post.messageId]);
    expect(ann.room()!.notice).toBeNull();
  });

  it("reactions, edits, pins and search reach the other phone", async () => {
    const id = bo.room()!.messages.at(-1)!.messageId;
    bo.store.react(id, "fire");
    await soon(() => expect(ann.room()!.messages.at(-1)!.reactions).toEqual([{ emoji: "fire", userIds: [bo.userId] }]));
    ann.store.edit(id, `Turbot is in ${tag}`);
    await soon(() => expect(bo.texts()).toContain(`Turbot is in ${tag}`));
    await bo.api.pin(key, id);
    expect((await ann.api.pins(key)).map((p) => p.messageId)).toContain(id);
    expect((await bo.api.search(key, `turbot is in ${tag}`)).map((h) => h.messageId)).toEqual([id]);
    await bo.api.unpin(id);
  });

  it("says who is on the pass and who is writing", async () => {
    await soon(() => expect(ann.store.getSnapshot().presence[key].map((p) => p.userId)).toEqual(expect.arrayContaining([ann.userId, bo.userId])));
    expect(ann.store.getSnapshot().presence[key].map((p) => p.userId)).not.toContain(olga.userId);
    bo.store.typing();
    await soon(() => expect(ann.room()!.typing.map((t) => t.userName)).toEqual(["Bo"]));
  });

  it("what was missed while the app was in the background is there on coming back", async () => {
    ann.live.stop();
    bo.store.post(`While you were out ${tag}`);
    await soon(() => expect(bo.room()!.pending).toEqual([]));
    const first = bo.texts()[bo.texts().length - 2];
    ann.live.start();
    await soon(() => expect(ann.texts()).toContain(`While you were out ${tag}`));
    expect(ann.texts().slice(-2)).toEqual([first, `While you were out ${tag}`]);
  });

  it("is back in the kitchen's live room after a drop, every time", async () => {
    for (let i = 0; i < 5; i++) {
      ann.live.stop();
      ann.live.start();
      await soon(() => expect(ann.live.getStatus()).toBe("online"));
      await new Promise((r) => setTimeout(r, 3_000)); // past the second join and read
      const reads = vi.spyOn(ann.api, "messages");
      bo.store.post(`Live again ${i} ${tag}`);
      await soon(() => expect(ann.texts()).toContain(`Live again ${i} ${tag}`));
      expect(reads).not.toHaveBeenCalled();
      reads.mockRestore();
    }
  });

  it("a post made with no connection never sends itself: not on coming back, not after Discard", async () => {
    ann.live.stop();
    ann.store.post(`Ghost ${tag}`);
    expect(ann.room()!.pending.map((p) => p.status)).toEqual(["failed"]);
    ann.store.discard(ann.room()!.pending[0].id);
    ann.live.start();
    await soon(() => expect(ann.live.getStatus()).toBe("online"));
    await new Promise((r) => setTimeout(r, 1_500));
    expect(bo.texts()).not.toContain(`Ghost ${tag}`);
    expect((await bo.api.search(key, `Ghost ${tag}`))).toEqual([]);
  });

  it("a sign-in that ran out while away is renewed and the connection comes back by itself", async () => {
    ann.live.stop();
    ann.spoilToken();
    ann.live.start();
    await soon(() => expect(ann.live.getStatus()).toBe("online"));
  });

  it("direct messages go between the two, from a colleague's name", async () => {
    const threadId = (await ann.store.startThread(bo.userId))!;
    expect(threadId).not.toBeNull();
    await ann.store.open({ kind: "dm", threadId });
    ann.store.post(`Lunch? ${tag}`);
    await soon(() => expect(ann.room()!.pending).toEqual([]));
    await soon(() => expect(bo.store.getSnapshot().threads[0]).toMatchObject({ dmThreadId: threadId, otherUserId: ann.userId, lastMessage: `Lunch? ${tag}` }));
    // It is not in the kitchen's channel, which Bo still has open.
    expect(bo.texts()).not.toContain(`Lunch? ${tag}`);
  });

  it("someone in no kitchen sees none of it and cannot post to it", async () => {
    await olga.store.open({ kind: "channel", key });
    expect(olga.room()).toMatchObject({ phase: "error", messages: [] });
    await expect(olga.api.messages({ kind: "channel", key })).rejects.toMatchObject({ code: "forbidden" });
    const heard: string[] = [];
    olga.socket.onAny((event: string, payload: { messageBody?: string }) => payload?.messageBody && heard.push(`${event} ${payload.messageBody}`));
    olga.live.send("bench:join", { channelKey: key });
    olga.live.send("bench:join", { channelKey: `user_${bo.userId}` });
    olga.live.send("bench:message", { channelKey: key, body: `Intruder ${tag}` });
    bo.store.post(`Kitchen only ${tag}`);
    await soon(() => expect(bo.room()!.pending).toEqual([]));
    ann.store.post(`Just us ${tag}`);
    await soon(() => expect(ann.room()!.pending).toEqual([]));
    await new Promise((r) => setTimeout(r, 500));
    expect(heard).toEqual([]);
    expect(bo.texts()).not.toContain(`Intruder ${tag}`);
    expect(olga.store.canMessage(bo.userId)).toBe(false);
  });

  it("deleting takes a message off both phones", async () => {
    const mine = bo.room()!.messages.filter((m) => m.userId === bo.userId).at(-1)!;
    bo.store.remove(mine.messageId);
    await soon(() => expect(bo.room()!.messages.map((m) => m.messageId)).not.toContain(mine.messageId));
  });

  it("a block keeps a colleague's posts off the blocker's phone and stops their direct messages; unblocking brings them back", async () => {
    await ann.store.open({ kind: "channel", key });
    expect(await ann.store.block(bo.userId)).toBeNull();
    bo.store.post(`Behind the block ${tag}`);
    await soon(() => expect(bo.room()!.pending).toEqual([]));
    await new Promise((r) => setTimeout(r, 1_000));
    expect(ann.texts()).not.toContain(`Behind the block ${tag}`);
    expect((await ann.api.messages({ kind: "channel", key })).map((m) => m.messageBody)).not.toContain(`Behind the block ${tag}`);
    await expect(bo.api.openThread(ann.userId)).rejects.toMatchObject({ serverCode: "DM_NOT_ALLOWED" });

    const theirs = (await bo.api.messages({ kind: "channel", key })).find((m) => m.messageBody === `Behind the block ${tag}`)!;
    await ann.api.report({ messageId: theirs.messageId, reason: "spam" });
    expect(await ann.store.unblock(bo.userId)).toBeNull();
    await soon(() => expect(ann.texts()).toContain(`Behind the block ${tag}`));
  });
});


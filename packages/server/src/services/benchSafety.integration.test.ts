import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { config } from "dotenv";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import express from "express";
import jwt from "jsonwebtoken";
import { io, type Socket } from "socket.io-client";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  benchBlock,
  benchChannel,
  benchDmThread,
  benchMessage,
  benchPin,
  benchReaction,
  benchReport,
  organisation,
  user,
  userOrganisation,
} from "../db/schema.js";
import { migrations } from "../migrations/index.js";
import { benchRouter } from "../routes/bench.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { initBenchSocket } from "./benchSocketService.js";
import { createMessage, getOrCreateOrgChannel, pinMessage } from "./benchService.js";
import { createDmMessage, getOrCreateThread } from "./benchDmService.js";
import { REPORTS_PER_DAY } from "./benchReportService.js";
import { anonymiseUser } from "./userAnonymisationService.js";

/**
 * Blocking, reporting and moderation on The Bench, over real routes, real sockets and a real database.
 * Anna, Amir and Cara share organisation A; Bea is in B and has written in Everyone; Olga is in none and has written nowhere.
 */
const RUN = process.env.TENANT_IT === "1";

type Event = { name: string; payload: any };
interface Client {
  socket: Socket;
  got: Event[];
  of: (name: string) => any[];
}

describe.skipIf(!RUN)("bench report, block and moderation — real routes, sockets and DB", () => {
  const tag = `bsafe_${Date.now().toString(36)}`;
  let http: HttpServer;
  let base: string;
  let anna: number, amir: number, cara: number, bea: number, olga: number, mod: number;
  let orgA: number, orgB: number;
  let channelA: number;
  let everyoneId: number;
  let createdEveryone = false;
  const open: Socket[] = [];

  const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  const secret = () => process.env.JWT_ACCESS_SECRET ?? "dev-access-secret";
  const token = (userId: number, roles: string[] = [], permissions: string[] = []) => jwt.sign({ sub: userId, roles, permissions }, secret());

  async function api(as: string | null, method: string, path: string, body?: unknown) {
    const res = await fetch(`${base}/api/bench${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(as ? { Authorization: `Bearer ${as}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  }
  const as = (userId: number) => token(userId);

  async function connect(userId: number): Promise<Client> {
    const socket = io(base, { auth: { token: token(userId) }, transports: ["websocket"], forceNew: true, reconnection: false });
    open.push(socket);
    const got: Event[] = [];
    socket.onAny((name, payload) => got.push({ name, payload }));
    await new Promise<void>((ok, fail) => {
      socket.once("bench:presence:update", () => ok());
      socket.once("connect_error", fail);
    });
    await settle(50);
    return { socket, got, of: (name) => got.filter((e) => e.name === name).map((e) => e.payload) };
  }

  async function join(c: Client, channelKey: string) {
    c.socket.emit("bench:join", { channelKey });
    await settle();
  }

  const block = (who: number, whom: number) => api(as(who), "POST", "/blocks", { userId: whom });
  const unblock = (who: number, whom: number) => api(as(who), "DELETE", `/blocks/${whom}`);

  beforeAll(async () => {
    const m = migrations.find((x) => x.id === "0009_bench_safety")!;
    for (const s of m.statements) await db.execute(sql.raw(s));

    const people = await db
      .insert(user)
      .values(["anna", "amir", "cara", "bea", "olga", "mod"].map((n) => ({ userName: `${n}`, userEmail: `${tag}-${n}@it.test` })))
      .returning({ userId: user.userId });
    [anna, amir, cara, bea, olga, mod] = people.map((p) => p.userId);
    const orgs = await db
      .insert(organisation)
      .values([
        { organisationName: `${tag}-A`, joinKey: `${tag}-ka`, createdBy: anna },
        { organisationName: `${tag}-B`, joinKey: `${tag}-kb`, createdBy: bea },
      ])
      .returning({ id: organisation.organisationId });
    [orgA, orgB] = orgs.map((o) => o.id);
    await db.insert(userOrganisation).values([
      { userId: anna, organisationId: orgA, role: "member" },
      { userId: amir, organisationId: orgA, role: "member" },
      { userId: cara, organisationId: orgA, role: "member" },
      { userId: bea, organisationId: orgB, role: "member" },
    ]);

    const made = await db
      .insert(benchChannel)
      .values({ channelKey: "everyone", channelName: "Everyone", channelType: "global" })
      .onConflictDoNothing()
      .returning({ id: benchChannel.channelId });
    createdEveryone = made.length > 0;
    [{ id: everyoneId }] = await db.select({ id: benchChannel.channelId }).from(benchChannel).where(eq(benchChannel.channelKey, "everyone"));
    channelA = (await getOrCreateOrgChannel(orgA, `${tag}-A`)).channelId;
    await createMessage(everyoneId, bea, `${tag} hello from B`);

    const app = express();
    app.use(express.json());
    app.use("/api/bench", benchRouter);
    app.use(errorHandler);
    http = createServer(app);
    initBenchSocket(http);
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    for (const s of open.splice(0)) s.disconnect();
    await db.delete(benchBlock).where(inArray(benchBlock.userId, [anna, amir, cara, bea, olga, mod]));
    await settle(50);
  });

  afterAll(async () => {
    const users = [anna, amir, cara, bea, olga, mod];
    await db.delete(benchReport).where(inArray(benchReport.userId, users));
    const msgs = await db.select({ id: benchMessage.messageId }).from(benchMessage).where(inArray(benchMessage.userId, users));
    const ids = msgs.map((m) => m.id);
    if (ids.length) {
      await db.delete(benchReaction).where(inArray(benchReaction.messageId, ids));
      await db.delete(benchPin).where(inArray(benchPin.messageId, ids));
      await db.delete(benchMessage).where(inArray(benchMessage.messageId, ids));
    }
    await db.delete(benchDmThread).where(inArray(benchDmThread.userAId, users));
    await db.delete(benchChannel).where(inArray(benchChannel.organisationId, [orgA, orgB]));
    if (createdEveryone) await db.delete(benchChannel).where(eq(benchChannel.channelId, everyoneId));
    await db.delete(userOrganisation).where(inArray(userOrganisation.organisationId, [orgA, orgB]));
    await db.delete(organisation).where(inArray(organisation.organisationId, [orgA, orgB]));
    await db.delete(user).where(inArray(user.userId, users));
    http.closeAllConnections();
    await new Promise((r) => http.close(r));
  });

  describe("blocking", () => {
    it("every new route answers 401 without a sign-in", async () => {
      for (const [method, path] of [["GET", "/blocks"], ["POST", "/blocks"], ["DELETE", "/blocks/1"], ["POST", "/reports"], ["GET", "/reports"], ["POST", `/reports/${crypto.randomUUID()}/hide`]] as const) {
        expect((await api(null, method, path, method === "GET" ? undefined : {})).status).toBe(401);
      }
    });

    it("keeps the blocked person's posts, edits and typing from every device of the blocker, and from nobody else", async () => {
      expect((await block(anna, amir)).status).toBe(200);
      const a1 = await connect(anna);
      const a2 = await connect(anna);
      const b = await connect(amir);
      const c = await connect(cara);
      for (const x of [a1, a2, b, c]) await join(x, `org_${orgA}`);
      const kept = await createMessage(channelA, amir, "written before");

      b.socket.emit("bench:message", { channelKey: `org_${orgA}`, body: "from amir" });
      b.socket.emit("bench:message", { channelKey: "everyone", body: "amir to all" });
      b.socket.emit("bench:typing", { channelKey: `org_${orgA}` });
      b.socket.emit("bench:message:edit", { messageId: kept.messageId, newBody: "edited by amir" });
      await settle();

      for (const x of [a1, a2]) {
        expect(x.of("bench:message:new")).toEqual([]);
        expect(x.of("bench:typing")).toEqual([]);
        expect(x.of("bench:message:edited")).toEqual([]);
      }
      expect(c.of("bench:message:new").map((m) => m.messageBody).sort()).toEqual(["amir to all", "from amir"]);
      expect(c.of("bench:typing")).toHaveLength(1);
      expect(c.of("bench:message:edited")).toHaveLength(1);

      // The blocked person is not told: what the blocker writes still reaches them.
      a1.socket.emit("bench:message", { channelKey: `org_${orgA}`, body: "from anna" });
      await settle();
      expect(b.of("bench:message:new").map((m) => m.messageBody)).toContain("from anna");
    });

    it("leaves the blocked person out of the blocker's history, search and pins", async () => {
      const theirs = await createMessage(channelA, amir, `${tag} needle amir`);
      const hers = await createMessage(channelA, cara, `${tag} needle cara`);
      await pinMessage(theirs.messageId, channelA, cara);
      await block(anna, amir);

      const ids = (r: { body: any }) => (r.body.messages ?? r.body).map((m: any) => m.messageId);
      const mine = await api(as(anna), "GET", `/channels/org_${orgA}/messages`);
      expect(ids(mine)).toContain(hers.messageId);
      expect(ids(mine)).not.toContain(theirs.messageId);
      expect(ids(await api(as(anna), "GET", `/channels/org_${orgA}/search?q=${tag}%20needle`))).toEqual([hers.messageId]);
      expect(ids(await api(as(anna), "GET", `/channels/org_${orgA}/pins`))).not.toContain(theirs.messageId);

      expect(ids(await api(as(cara), "GET", `/channels/org_${orgA}/messages`))).toContain(theirs.messageId);
      expect(ids(await api(as(cara), "GET", `/channels/org_${orgA}/pins`))).toContain(theirs.messageId);
    });

    it("counts reactions without the blocked person, for the blocker only", async () => {
      const msg = await createMessage(channelA, cara, "react to me");
      await block(anna, amir);
      const a = await connect(anna);
      const b = await connect(amir);
      const c = await connect(cara);
      for (const x of [a, b, c]) await join(x, `org_${orgA}`);
      b.socket.emit("bench:reaction:add", { messageId: msg.messageId, emoji: "fire" });
      await settle();
      c.socket.emit("bench:reaction:add", { messageId: msg.messageId, emoji: "fire" });
      await settle();

      expect(a.of("bench:reaction:updated")).toEqual([
        { messageId: msg.messageId, reactions: [] },
        { messageId: msg.messageId, reactions: [{ emoji: "fire", count: 1, userIds: [cara] }] },
      ]);
      expect(c.of("bench:reaction:updated").pop().reactions).toEqual([{ emoji: "fire", count: 2, userIds: expect.arrayContaining([amir, cara]) }]);

      const page = await api(as(anna), "GET", `/channels/org_${orgA}/messages`);
      expect(page.body.messages.find((m: any) => m.messageId === msg.messageId).reactions).toEqual([{ emoji: "fire", count: 1, userIds: [cara] }]);
    });

    it("leaves the blocked person out of the blocker's presence lists", async () => {
      await block(anna, amir);
      const b = await connect(amir);
      const c = await connect(cara);
      const a = await connect(anna);
      for (const x of [b, c, a]) await join(x, `org_${orgA}`);
      a.socket.emit("bench:presence:heartbeat");
      await settle();
      const last = (x: Client, key: string) => x.of("bench:presence:update").filter((p) => p.channelKey === key).pop().users.map((u: any) => u.userId);
      expect(last(a, `org_${orgA}`)).not.toContain(amir);
      expect(last(a, "everyone")).not.toContain(amir);
      expect(last(c, `org_${orgA}`)).toEqual(expect.arrayContaining([anna, amir, cara]));
    });

    it("refuses direct messages between the two, both ways, with one code, and stores none", async () => {
      const thread = await getOrCreateThread(anna, amir);
      const before = await createDmMessage(thread.dmThreadId, amir, "before the block");
      await block(anna, amir);
      const a = await connect(anna);
      const b = await connect(amir);
      b.socket.emit("bench:dm:send", { recipientId: anna, body: "let me in" });
      a.socket.emit("bench:dm:send", { recipientId: amir, body: "nor me" });
      b.socket.emit("bench:dm:typing", { recipientId: anna });
      await settle();

      expect(a.of("bench:dm:new")).toEqual([]);
      expect(b.of("bench:dm:new")).toEqual([]);
      expect(a.of("bench:dm:typing")).toEqual([]);
      // One refusal for each of b's two attempts (the message and the typing notice), one for a's message; all the same code.
      expect(b.of("bench:error")).toEqual(Array(2).fill({ error: expect.any(String), code: "DM_NOT_ALLOWED" }));
      expect(a.of("bench:error")).toEqual([{ error: expect.any(String), code: "DM_NOT_ALLOWED" }]);
      const stored = await db.select({ id: benchMessage.messageId }).from(benchMessage).where(eq(benchMessage.dmThreadId, thread.dmThreadId));
      expect(stored).toHaveLength(1);

      for (const [who, whom] of [[anna, amir], [amir, anna]]) {
        expect(await api(as(who), "POST", "/dm/threads", { recipientId: whom })).toEqual({ status: 403, body: { error: expect.any(String), code: "DM_NOT_ALLOWED" } });
      }
      expect((await api(as(anna), "GET", "/dm/threads")).body.map((t: any) => t.dmThreadId)).not.toContain(thread.dmThreadId);
      expect((await api(as(anna), "GET", `/dm/threads/${thread.dmThreadId}/messages`)).body.messages).toEqual([]);
      // The blocked person's own view is as it was.
      expect((await api(as(amir), "GET", `/dm/threads/${thread.dmThreadId}/messages`)).body.messages.map((m: any) => m.messageId)).toEqual([before.messageId]);
    });

    it("brings everything back on unblock", async () => {
      await block(anna, amir);
      expect((await api(as(anna), "GET", "/blocks")).body).toEqual([{ userId: amir, userName: "amir", userPhotoPath: null }]);
      expect((await unblock(anna, amir)).status).toBe(200);
      expect((await api(as(anna), "GET", "/blocks")).body).toEqual([]);
      const a = await connect(anna);
      const b = await connect(amir);
      for (const x of [a, b]) await join(x, `org_${orgA}`);
      b.socket.emit("bench:message", { channelKey: `org_${orgA}`, body: "back again" });
      b.socket.emit("bench:dm:send", { recipientId: anna, body: "hello again" });
      await settle();
      expect(a.of("bench:message:new").map((m) => m.messageBody)).toEqual(["back again"]);
      expect(a.of("bench:dm:new").map((m) => m.messageBody)).toEqual(["hello again"]);
    });

    it("blocks only someone the person can meet, and answers the same for anyone else as for nobody", async () => {
      expect((await block(anna, bea)).status).toBe(200); // wrote in Everyone
      expect(await block(anna, olga)).toEqual({ status: 404, body: { error: expect.any(String), code: "NOT_FOUND" } });
      expect(await block(anna, 2_147_483_000)).toEqual({ status: 404, body: { error: expect.any(String), code: "NOT_FOUND" } });
      expect((await block(anna, anna)).body.code).toBe("VALIDATION");
      expect((await api(as(anna), "POST", "/blocks", { userId: "x" })).body.code).toBe("VALIDATION");
      expect((await block(anna, amir)).status).toBe(200);
      expect((await block(anna, amir)).status).toBe(200); // twice is once
      expect((await unblock(anna, olga)).status).toBe(200); // never blocked: nothing to do
    });
  });

  describe("reporting", () => {
    it("keeps the message's words as they were, who reported and who was reported", async () => {
      const msg = await createMessage(channelA, amir, "rude words");
      const res = await api(as(anna), "POST", "/reports", { messageId: msg.messageId, reason: "harassment", note: "  third time  " });
      expect(res.status).toBe(201);
      await db.update(benchMessage).set({ messageBody: "nice words" }).where(eq(benchMessage.messageId, msg.messageId));
      const [row] = await db.select().from(benchReport).where(eq(benchReport.id, res.body.id));
      expect(row).toMatchObject({ userId: anna, reportedUserId: amir, messageId: msg.messageId, messageBody: "rude words", reason: "harassment", note: "third time", status: "open" });
    });

    it("takes a report of a person, or of a message, only from someone who can see them", async () => {
      expect((await api(as(anna), "POST", "/reports", { userId: bea, reason: "spam" })).status).toBe(201);
      expect((await api(as(anna), "POST", "/reports", { userId: olga, reason: "spam" })).body.code).toBe("NOT_FOUND");
      const msg = await createMessage(channelA, anna, "kitchen only");
      expect(await api(as(olga), "POST", "/reports", { messageId: msg.messageId, reason: "spam" })).toEqual({ status: 404, body: { error: expect.any(String), code: "NOT_FOUND" } });
      expect((await api(as(anna), "POST", "/reports", { messageId: msg.messageId, reason: "spam" })).body.code).toBe("VALIDATION"); // her own
    });

    it("refuses a report with no reason from the list, or about both a message and a person", async () => {
      const msg = await createMessage(channelA, amir, "x");
      for (const body of [{ messageId: msg.messageId, reason: "boring" }, { messageId: msg.messageId, userId: amir, reason: "spam" }, { reason: "spam" }, { userId: amir, reason: "spam", note: "x".repeat(501) }]) {
        expect(await api(as(anna), "POST", "/reports", body)).toEqual({ status: 400, body: { error: expect.any(String), code: "VALIDATION" } });
      }
    });

    it(`takes ${REPORTS_PER_DAY} reports a day from one person`, async () => {
      await db.insert(benchReport).values(Array.from({ length: REPORTS_PER_DAY }, () => ({ userId: cara, reportedUserId: amir, reason: "spam" })));
      expect(await api(as(cara), "POST", "/reports", { userId: amir, reason: "spam" })).toEqual({ status: 429, body: { error: expect.any(String), code: "RATE_LIMITED" } });
      await db.delete(benchReport).where(eq(benchReport.userId, cara));
    });
  });

  it("deleting an account takes its own blocks, keeps blocks of it, and clears its reported words; the reports stay", async () => {
    const [{ userId: leaver }] = await db.insert(user).values({ userName: "leaver", userEmail: `${tag}-leaver@it.test` }).returning({ userId: user.userId });
    await db.insert(userOrganisation).values({ userId: leaver, organisationId: orgA, role: "member" });
    const msg = await createMessage(channelA, leaver, "words to forget");
    await block(anna, leaver);
    await block(leaver, cara);
    const id = (await api(as(anna), "POST", "/reports", { messageId: msg.messageId, reason: "spam" })).body.id;
    await anonymiseUser(leaver);
    expect((await db.select().from(benchBlock).where(inArray(benchBlock.userId, [anna, leaver]))).map((b) => [b.userId, b.blockedUserId])).toEqual([[anna, leaver]]);
    const [row] = await db.select().from(benchReport).where(eq(benchReport.id, id));
    expect(row).toMatchObject({ reportedUserId: leaver, messageBody: "", status: "open" });
    await db.delete(benchReport).where(eq(benchReport.id, id));
    await db.delete(benchMessage).where(eq(benchMessage.userId, leaver));
    await db.delete(user).where(eq(user.userId, leaver));
  });

  describe("moderation", () => {
    const moderator = () => token(mod, [], ["bench:moderate"]);

    it("is for holders of bench:moderate and administrators only", async () => {
      expect(await api(as(amir), "GET", "/reports")).toEqual({ status: 403, body: { error: expect.any(String), code: "FORBIDDEN" } });
      expect((await api(as(amir), "POST", `/reports/${crypto.randomUUID()}/dismiss`, {})).status).toBe(403);
      expect((await api(moderator(), "GET", "/reports")).status).toBe(200);
      expect((await api(token(olga, ["Administrator"]), "GET", "/reports")).status).toBe(200);
    });

    it("shows a moderator the reported message of a channel or a direct message, and none of the words around it", async () => {
      await createMessage(channelA, amir, "channel before");
      const reportedInChannel = await createMessage(channelA, amir, "channel reported");
      await createMessage(channelA, cara, "channel after");
      const thread = await getOrCreateThread(anna, amir);
      await createDmMessage(thread.dmThreadId, anna, "private before");
      const reportedInDm = await createDmMessage(thread.dmThreadId, amir, "private reported");
      await createDmMessage(thread.dmThreadId, anna, "private after");
      const inChannel = (await api(as(anna), "POST", "/reports", { messageId: reportedInChannel.messageId, reason: "spam" })).body.id;
      const inDm = (await api(as(anna), "POST", "/reports", { messageId: reportedInDm.messageId, reason: "spam" })).body.id;

      const queue = (await api(moderator(), "GET", "/reports")).body;
      const text = JSON.stringify([inChannel, inDm].map((id) => queue.find((r: any) => r.id === id)));
      expect(queue.find((r: any) => r.id === inChannel)).toMatchObject({ messageBody: "channel reported", reportedUserName: "amir" });
      expect(queue.find((r: any) => r.id === inDm)).toMatchObject({ messageBody: "private reported", reportedUserName: "amir" });
      for (const neighbour of ["channel before", "channel after", "private before", "private after"]) expect(text).not.toContain(neighbour);
    });

    it("hides a reported message from everyone, keeps it on record, and closes every open report about it", async () => {
      const msg = await createMessage(channelA, amir, "hide me");
      const r1 = (await api(as(anna), "POST", "/reports", { messageId: msg.messageId, reason: "hate" })).body.id;
      const r2 = (await api(as(cara), "POST", "/reports", { messageId: msg.messageId, reason: "spam" })).body.id;
      const queue = (await api(moderator(), "GET", "/reports")).body;
      expect(queue.find((r: any) => r.id === r1)).toMatchObject({ status: "open", reason: "hate", reporterName: "anna", reportedUserId: amir, reportedUserName: "amir", messageBody: "hide me", messageGone: false, channelName: `${tag}-A`, actions: [] });

      const a = await connect(anna);
      const c = await connect(cara);
      for (const x of [a, c]) await join(x, `org_${orgA}`);
      expect((await api(moderator(), "POST", `/reports/${r1}/hide`, {})).status).toBe(200);
      await settle();
      for (const x of [a, c]) expect(x.of("bench:message:deleted")).toEqual([{ messageId: msg.messageId }]);
      expect((await api(as(cara), "GET", `/channels/org_${orgA}/messages`)).body.messages.map((m: any) => m.messageId)).not.toContain(msg.messageId);
      const [row] = await db.select().from(benchMessage).where(eq(benchMessage.messageId, msg.messageId));
      expect(row).toMatchObject({ deletedInd: true, messageBody: "hide me" });

      const closed = (await api(moderator(), "GET", "/reports?status=closed")).body;
      for (const id of [r1, r2]) {
        expect(closed.find((r: any) => r.id === id)).toMatchObject({ status: "hidden", messageGone: true, actions: [{ action: "hide", userName: "mod", note: null, createdAt: expect.any(String) }] });
      }
      expect((await api(moderator(), "GET", "/reports")).body.map((r: any) => r.id)).not.toContain(r1);
      expect(await api(moderator(), "POST", `/reports/${r2}/dismiss`, {})).toEqual({ status: 409, body: { error: expect.any(String), code: "INVALID_STATE" } });
    });

    it("dismisses, and resolves only with a note, recording who and when", async () => {
      const r1 = (await api(as(anna), "POST", "/reports", { userId: amir, reason: "other" })).body.id;
      const r2 = (await api(as(anna), "POST", "/reports", { userId: amir, reason: "other" })).body.id;
      expect((await api(moderator(), "POST", `/reports/${r1}/dismiss`, { note: "not a breach" })).status).toBe(200);
      expect(await api(moderator(), "POST", `/reports/${r2}/resolve`, {})).toEqual({ status: 400, body: { error: expect.any(String), code: "VALIDATION" } });
      expect((await api(moderator(), "POST", `/reports/${r2}/resolve`, { note: "spoke to them" })).status).toBe(200);
      expect(await api(moderator(), "POST", `/reports/${r2}/hide`, {})).toEqual({ status: 409, body: { error: expect.any(String), code: "INVALID_STATE" } });
      expect((await api(moderator(), "POST", `/reports/${crypto.randomUUID()}/dismiss`, {})).body.code).toBe("NOT_FOUND");
      expect((await api(moderator(), "POST", "/reports/not-an-id/dismiss", {})).body.code).toBe("NOT_FOUND");

      const closed = (await api(moderator(), "GET", "/reports?status=closed")).body;
      expect(closed.find((r: any) => r.id === r1)).toMatchObject({ status: "dismissed", actions: [{ action: "dismiss", note: "not a breach", userName: "mod" }] });
      expect(closed.find((r: any) => r.id === r2)).toMatchObject({ status: "resolved", actions: [{ action: "resolve", note: "spoke to them", userName: "mod" }] });
    });
  });
});

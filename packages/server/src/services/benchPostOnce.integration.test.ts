import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import jwt from "jsonwebtoken";
import { io, type Socket } from "socket.io-client";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { benchChannel, benchDmThread, benchMessage, benchReaction, organisation, user, userOrganisation } from "../db/schema.js";
import { initBenchSocket } from "./benchSocketService.js";
import { addReaction, editMessage, getOrCreateOrgChannel, softDeleteMessage } from "./benchService.js";
import { getThreadById } from "./benchDmService.js";

/** A post with a client-made id is stored once, however often it is sent: real sockets, real DB. */
const RUN = process.env.TENANT_IT === "1";

describe.skipIf(!RUN)("bench posts with a client-made id", () => {
  const tag = `benchonce_${Date.now()}`;
  let http: HttpServer;
  let closeBench: () => void;
  let port: number;
  let anna: number, amir: number;
  let orgA: number, orgB: number;
  let keyA: string, keyB: string;
  const open: Socket[] = [];

  const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  const stored = (id: string) => db.select().from(benchMessage).where(eq(benchMessage.messageId, id));

  async function connect(userId: number) {
    const token = jwt.sign({ sub: userId, roles: [], permissions: [] }, process.env.JWT_ACCESS_SECRET ?? "dev-access-secret");
    const socket = io(`http://127.0.0.1:${port}`, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
    open.push(socket);
    const got: { name: string; payload: any }[] = [];
    socket.onAny((name, payload) => got.push({ name, payload }));
    await new Promise<void>((ok, fail) => {
      socket.once("connect", ok);
      socket.once("connect_error", fail);
    });
    for (const channelKey of [keyA, keyB]) socket.emit("bench:join", { channelKey });
    await settle();
    return {
      of: (name: string) => got.filter((e) => e.name === name).map((e) => e.payload),
      clear: () => void (got.length = 0),
      async send(event: string, payload: unknown, times = 1) {
        for (let i = 0; i < times; i++) socket.emit(event, payload);
        await settle();
      },
    };
  }

  beforeAll(async () => {
    [anna, amir] = (
      await db
        .insert(user)
        .values(["anna", "amir"].map((n) => ({ userName: n, userEmail: `${tag}-${n}@it.test` })))
        .returning({ userId: user.userId })
    ).map((p) => p.userId);
    [orgA, orgB] = (
      await db
        .insert(organisation)
        .values(["a", "b"].map((k) => ({ organisationName: `${tag}-${k}`, joinKey: `${tag}-${k}`, createdBy: anna })))
        .returning({ id: organisation.organisationId })
    ).map((o) => o.id);
    await db.insert(userOrganisation).values([anna, amir].flatMap((userId) => [orgA, orgB].map((organisationId) => ({ userId, organisationId, role: "member" }))));
    keyA = (await getOrCreateOrgChannel(orgA, `${tag}-a`)).channelKey;
    keyB = (await getOrCreateOrgChannel(orgB, `${tag}-b`)).channelKey;

    http = createServer();
    closeBench = initBenchSocket(http);
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
    port = (http.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const s of open.splice(0)) s.disconnect();
    await settle(50);
  });

  afterAll(async () => {
    const users = [anna, amir];
    const ids = (await db.select({ id: benchMessage.messageId }).from(benchMessage).where(inArray(benchMessage.userId, users))).map((m) => m.id);
    if (ids.length) {
      await db.delete(benchReaction).where(inArray(benchReaction.messageId, ids));
      await db.delete(benchMessage).where(inArray(benchMessage.messageId, ids));
    }
    await db.delete(benchDmThread).where(inArray(benchDmThread.userAId, users));
    await db.delete(benchChannel).where(inArray(benchChannel.organisationId, [orgA, orgB]));
    await db.delete(userOrganisation).where(inArray(userOrganisation.organisationId, [orgA, orgB]));
    await db.delete(organisation).where(inArray(organisation.organisationId, [orgA, orgB]));
    await db.delete(user).where(inArray(user.userId, users));
    await new Promise<void>((r) => {
      http.close(() => r());
      closeBench();
    });
  });

  it("is stored under the id, told to the room with its channel, and without an id as before", async () => {
    const a = await connect(anna);
    const b = await connect(amir);
    const messageId = randomUUID();
    await a.send("bench:message", { channelKey: keyA, body: "fish is in", messageId });
    await a.send("bench:message", { channelKey: keyA, body: "from an older app" });
    expect(b.of("bench:message:new")).toMatchObject([
      { messageId, channelKey: keyA, messageBody: "fish is in", reactions: [] },
      { messageId: expect.any(String), channelKey: keyA, messageBody: "from an older app" },
    ]);
    expect(b.of("bench:message:new")[0]).not.toHaveProperty("replay");
  });

  it("sent again, even at the same moment, is one message: the room hears it once, the sender gets it again", async () => {
    const a = await connect(anna);
    const b = await connect(amir);
    const post = { channelKey: keyA, body: "  once  ", messageId: randomUUID() };
    await a.send("bench:message", post, 3);
    await addReaction(post.messageId, amir, "fire");
    a.clear();
    await a.send("bench:message", post);
    expect(await stored(post.messageId)).toHaveLength(1);
    expect(b.of("bench:message:new").filter((m) => m.messageBody === "once")).toHaveLength(1);
    expect(a.of("bench:message:new")).toMatchObject([{ messageId: post.messageId, channelKey: keyA, messageBody: "once", reactions: [{ emoji: "fire", userIds: [amir] }] }]);
    expect(a.of("bench:error")).toEqual([]);
  });

  it("answers with the message as it is now when it was edited since", async () => {
    const a = await connect(anna);
    const post = { channelKey: keyA, body: "first words", messageId: randomUUID() };
    await a.send("bench:message", post);
    await editMessage(post.messageId, anna, "better words");
    a.clear();
    await a.send("bench:message", post);
    expect(a.of("bench:message:new")).toMatchObject([{ messageBody: "better words", editedInd: true }]);
  });

  it("does not bring a deleted message back, and tells the sender it is deleted", async () => {
    const a = await connect(anna);
    const b = await connect(amir);
    const post = { channelKey: keyA, body: "regretted", messageId: randomUUID() };
    await a.send("bench:message", post);
    await softDeleteMessage(post.messageId, anna);
    for (const c of [a, b]) c.clear();
    await a.send("bench:message", post);
    expect(a.of("bench:message:new")).toEqual([]);
    expect(a.of("bench:message:deleted")).toEqual([{ messageId: post.messageId }]);
    expect(b.of("bench:message:deleted")).toEqual([]);
    expect((await stored(post.messageId))[0].deletedInd).toBe(true);
  });

  it("refuses the id for anything but the same post, and shows nothing of the one that holds it", async () => {
    const a = await connect(anna);
    const b = await connect(amir);
    const messageId = randomUUID();
    await a.send("bench:message", { channelKey: keyA, body: "mine", messageId });
    for (const c of [a, b]) c.clear();
    await a.send("bench:message", { channelKey: keyA, body: "other words", messageId });
    await a.send("bench:message", { channelKey: keyB, body: "mine", messageId });
    await a.send("bench:message", { channelKey: keyA, body: "mine", messageId, messageType: "recipe_share", recipeId: randomUUID() });
    await a.send("bench:dm:send", { recipientId: amir, body: "mine", messageId });
    await b.send("bench:message", { channelKey: keyA, body: "mine", messageId });
    expect(a.of("bench:error")).toEqual(Array(4).fill({ error: expect.any(String), code: "CONFLICT" }));
    expect(b.of("bench:error")).toEqual([{ error: expect.any(String), code: "CONFLICT" }]);
    expect([...a.of("bench:message:new"), ...b.of("bench:message:new"), ...b.of("bench:dm:new")]).toEqual([]);
    expect(await stored(messageId)).toMatchObject([{ messageBody: "mine", userId: anna, recipeId: null }]);
  });

  it("the same for a direct message: one message, one notice to the other person, the thread not moved", async () => {
    const a = await connect(anna);
    const b = await connect(amir);
    const post = { recipientId: amir, body: "Lunch?", messageId: randomUUID() };
    await a.send("bench:dm:send", post);
    const [{ dmThreadId }] = await stored(post.messageId);
    const before = (await getThreadById(dmThreadId!))!.lastMessageAt;
    await a.send("bench:dm:send", post, 2);
    expect(await stored(post.messageId)).toHaveLength(1);
    expect(b.of("bench:dm:new")).toMatchObject([{ messageId: post.messageId, messageBody: "Lunch?" }]);
    expect(a.of("bench:dm:new").map((m) => m.messageId)).toEqual(Array(3).fill(post.messageId));
    expect((await getThreadById(dmThreadId!))!.lastMessageAt).toEqual(before);
    expect(a.of("bench:dm:new")[2]).not.toHaveProperty("replay");
  });

  it.each([5, "not-a-uuid", null, {}])("refuses %j as an id", async (messageId) => {
    const a = await connect(anna);
    await a.send("bench:message", { channelKey: keyA, body: "never stored", messageId });
    await a.send("bench:dm:send", { recipientId: amir, body: "never stored", messageId });
    expect(a.of("bench:error")).toEqual(Array(2).fill({ error: expect.any(String), code: "VALIDATION" }));
    expect(await db.select().from(benchMessage).where(eq(benchMessage.messageBody, "never stored"))).toEqual([]);
  });
});

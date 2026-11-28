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
import { benchChannel, benchDmThread, benchMessage, organisation, siteSetting, user, userOrganisation } from "../db/schema.js";
import { initBenchSocket } from "./benchSocketService.js";
import { getOrCreateOrgChannel, updateChannelBanner } from "./benchService.js";
import { BLOCKED_TERMS_KEY, __test } from "./benchFilterService.js";

/** The word filter over real sockets and a real DB: a refused post or edit is neither stored nor told to anyone. Made-up terms only. */
const RUN = process.env.TENANT_IT === "1";
const REFUSED = { error: "This message can't be posted.", code: "POST_NOT_ALLOWED" };

describe.skipIf(!RUN)("bench word filter", () => {
  const tag = `benchfilter_${Date.now()}`;
  let http: HttpServer;
  let closeBench: () => void;
  let port: number;
  let anna: number, amir: number;
  let org: number;
  let key: string;
  let before: string | undefined;
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
    socket.emit("bench:join", { channelKey: key });
    await settle();
    return {
      of: (name: string) => got.filter((e) => e.name === name).map((e) => e.payload),
      async send(event: string, payload: unknown) {
        socket.emit(event, payload);
        await settle();
      },
    };
  }

  beforeAll(async () => {
    before = (await db.select().from(siteSetting).where(eq(siteSetting.settingKey, BLOCKED_TERMS_KEY)))[0]?.settingValue;
    await db
      .insert(siteSetting)
      .values({ settingKey: BLOCKED_TERMS_KEY, settingValue: "zorp\nblim flam" })
      .onConflictDoUpdate({ target: siteSetting.settingKey, set: { settingValue: "zorp\nblim flam" } });
    __test.reset();

    [anna, amir] = (
      await db
        .insert(user)
        .values(["anna", "amir"].map((n) => ({ userName: n, userEmail: `${tag}-${n}@it.test` })))
        .returning({ userId: user.userId })
    ).map((p) => p.userId);
    [{ id: org }] = await db.insert(organisation).values({ organisationName: tag, joinKey: tag, createdBy: anna }).returning({ id: organisation.organisationId });
    await db.insert(userOrganisation).values([anna, amir].map((userId) => ({ userId, organisationId: org, role: "member" })));
    key = (await getOrCreateOrgChannel(org, tag)).channelKey;

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
    if (before === undefined) await db.delete(siteSetting).where(eq(siteSetting.settingKey, BLOCKED_TERMS_KEY));
    else await db.update(siteSetting).set({ settingValue: before }).where(eq(siteSetting.settingKey, BLOCKED_TERMS_KEY));
    const users = [anna, amir];
    await db.delete(benchMessage).where(inArray(benchMessage.userId, users));
    await db.delete(benchDmThread).where(inArray(benchDmThread.userAId, users));
    await db.delete(benchChannel).where(eq(benchChannel.organisationId, org));
    await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, org));
    await db.delete(organisation).where(eq(organisation.organisationId, org));
    await db.delete(user).where(inArray(user.userId, users));
    await new Promise<void>((r) => {
      http.close(() => r());
      closeBench();
    });
  });

  it("refuses a channel post with a listed word: not stored, not told to the room, the sender told which post", async () => {
    const a = await connect(anna);
    const b = await connect(amir);
    const messageId = randomUUID();
    await a.send("bench:message", { channelKey: key, body: "well Z0RP to that", messageId });
    expect(a.of("bench:error")).toEqual([{ ...REFUSED, messageId }]);
    expect([...a.of("bench:message:new"), ...b.of("bench:message:new")]).toEqual([]);
    expect(await stored(messageId)).toEqual([]);
  });

  it("refuses a direct message with a listed phrase in the same way", async () => {
    const a = await connect(anna);
    const b = await connect(amir);
    const messageId = randomUUID();
    await a.send("bench:dm:send", { recipientId: amir, body: "such a blim  flam day", messageId });
    expect(a.of("bench:error")).toEqual([{ ...REFUSED, messageId }]);
    expect([...a.of("bench:dm:new"), ...b.of("bench:dm:new")]).toEqual([]);
    expect(await stored(messageId)).toEqual([]);
  });

  it("refuses a post from an older app that sends no id, with the code alone", async () => {
    const a = await connect(anna);
    const b = await connect(amir);
    await a.send("bench:message", { channelKey: key, body: "zorp" });
    expect(a.of("bench:error")).toEqual([REFUSED]);
    expect(b.of("bench:message:new")).toEqual([]);
  });

  it("lets through a post where a listed word is only part of a longer one", async () => {
    const a = await connect(anna);
    const b = await connect(amir);
    const messageId = randomUUID();
    await a.send("bench:message", { channelKey: key, body: "zorpish blim", messageId });
    expect(a.of("bench:error")).toEqual([]);
    expect(b.of("bench:message:new")).toMatchObject([{ messageId, messageBody: "zorpish blim" }]);
  });

  it("refuses an edit that puts a listed word in: the stored text and the room stay as they were", async () => {
    const a = await connect(anna);
    const b = await connect(amir);
    const messageId = randomUUID();
    await a.send("bench:message", { channelKey: key, body: "fish is in", messageId });
    await a.send("bench:message:edit", { messageId, newBody: "fish is z o r p" });
    expect(a.of("bench:error")).toEqual([{ ...REFUSED, messageId }]);
    expect(b.of("bench:message:edited")).toEqual([]);
    expect(await stored(messageId)).toMatchObject([{ messageBody: "fish is in", editedInd: false }]);
  });

  it("refuses a channel banner with a listed word and leaves the stored banner as it was", async () => {
    await updateChannelBanner(key, "menu tasting Friday");
    await expect(updateChannelBanner(key, "all hands, zorp")).rejects.toMatchObject({ statusCode: 422, code: "POST_NOT_ALLOWED", message: REFUSED.error });
    const [channel] = await db.select().from(benchChannel).where(eq(benchChannel.channelKey, key));
    expect(channel.channelBanner).toBe("menu tasting Friday");
  });
});

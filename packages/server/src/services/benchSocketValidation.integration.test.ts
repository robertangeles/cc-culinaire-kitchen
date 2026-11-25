import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { config } from "dotenv";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../../../.env") });
applyEnvPrefix();

import jwt from "jsonwebtoken";
import { io, type Socket } from "socket.io-client";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { benchChannel, benchDmThread, benchMessage, organisation, user, userOrganisation } from "../db/schema.js";

/**
 * Bench socket input validation over real connections: malformed events are dropped and everybody else keeps chatting.
 * The Bench runs in its own process, as in production: Mallory sends the events, Anna must keep chatting.
 */
const RUN = process.env.TENANT_IT === "1";
const TOO_BIG = 99_999_999_999;

const UUID = "00000000-0000-4000-8000-000000000000";
/** Sent for every event. */
const NOT_PAYLOADS: unknown[][] = [[], [null], [5], ["x"], [true], [[]], [{}]];
/** Then each event's own fields. */
const BAD_FIELDS: Record<string, unknown[]> = {
  "bench:join": [{ channelKey: 5 }, { channelKey: null }, { channelKey: ["everyone"] }, { channelKey: `dm_${TOO_BIG}` }, { channelKey: `org_${TOO_BIG}` }],
  "bench:leave": [{ channelKey: 5 }, { channelKey: {} }],
  "bench:message": [{ channelKey: 5, body: "x" }, { channelKey: "everyone", body: 5 }, { channelKey: "everyone", body: { trim: 1 } }, { channelKey: "everyone", body: "x", messageType: 5, recipeId: 5 }],
  "bench:typing": [{ channelKey: 5 }, { channelKey: null }, { channelKey: `org_${TOO_BIG}` }],
  "bench:reaction:add": [{ messageId: 5, emoji: 5 }, { messageId: "not-a-uuid", emoji: "x" }, { messageId: UUID, emoji: { a: 1 } }],
  "bench:reaction:remove": [{ messageId: 5, emoji: 5 }, { messageId: "not-a-uuid", emoji: "x" }, { messageId: UUID, emoji: { a: 1 } }],
  "bench:message:delete": [{ messageId: 5, channelKey: 5 }, { messageId: UUID }, { messageId: "not-a-uuid", channelKey: "everyone" }],
  "bench:message:edit": [{ messageId: 5, channelKey: 5, newBody: 5 }, { messageId: UUID, channelKey: "everyone", newBody: 5 }],
  "bench:dm:send": [{ recipientId: TOO_BIG, body: "x" }, { recipientId: -1, body: "x" }, { recipientId: 1.5, body: "x" }, { recipientId: {}, body: "x" }, { recipientId: 1, body: 5 }],
  "bench:dm:typing": [{ recipientId: TOO_BIG }, { recipientId: {} }],
  "bench:presence:heartbeat": [],
  // Not Bench events.
  "bench:unknown": [],
  error: [],
};

interface Client {
  socket: Socket;
  of: (name: string) => any[];
}

describe.skipIf(!RUN)("bench socket input validation — a real server process, real connections", () => {
  const tag = `benchval_${Date.now()}`;
  let server: ChildProcess | null = null;
  let port: number;
  let output = "";
  let anna: number, mallory: number;
  let orgA: number;
  let channelId: number;
  let createdEveryone = false;
  const open: Socket[] = [];

  const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
  const alive = () => server !== null && server.exitCode === null && server.signalCode === null;

  async function startServer() {
    output = "";
    const url = (file: string) => JSON.stringify(pathToFileURL(resolve(here, file)).href);
    const code = `
      (async () => {
      const { applyEnvPrefix } = await import(${url("../utils/envShim.ts")});
      applyEnvPrefix();
      const { createServer } = await import("node:http");
      const { initBenchSocket } = await import(${url("./benchSocketService.ts")});
      const http = createServer();
      initBenchSocket(http);
      http.listen(0, "127.0.0.1", () => process.send(http.address().port));
      })();
    `;
    const child = spawn(process.execPath, ["--import", "tsx", "-e", code], {
      cwd: resolve(here, "../.."),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    child.stdout!.on("data", (d) => (output += d));
    child.stderr!.on("data", (d) => (output += d));
    server = child;
    port = await new Promise<number>((ok, fail) => {
      child.once("message", (p) => ok(p as number));
      child.once("exit", () => fail(new Error(`server did not start: ${output}`)));
    });
  }

  async function connect(userId: number): Promise<Client> {
    const token = jwt.sign({ sub: userId, roles: [], permissions: [] }, process.env.JWT_ACCESS_SECRET ?? "dev-access-secret");
    const socket = io(`http://127.0.0.1:${port}`, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
    open.push(socket);
    const got: { name: string; payload: any }[] = [];
    socket.onAny((name, payload) => got.push({ name, payload }));
    // The server attaches its handlers just before this first broadcast.
    await new Promise<void>((ok, fail) => {
      socket.once("bench:presence:update", () => ok());
      socket.once("connect_error", fail);
    });
    await settle(50);
    return { socket, of: (name) => got.filter((e) => e.name === name).map((e) => e.payload) };
  }

  /** Anna still receives what Mallory sends, and a new person can still connect. */
  async function expectWorking(a: Client, m: Client, body: string) {
    expect(alive(), output.slice(-600)).toBe(true);
    m.socket.emit("bench:message", { channelKey: "everyone", body });
    await settle();
    expect(a.socket.connected).toBe(true);
    expect(a.of("bench:message:new").map((x) => x.messageBody)).toContain(body);
    const late = await connect(anna);
    expect(late.socket.connected).toBe(true);
  }

  beforeAll(async () => {
    [anna, mallory] = (
      await db
        .insert(user)
        .values(["anna", "mallory"].map((n) => ({ userName: n, userEmail: `${tag}-${n}@it.test` })))
        .returning({ userId: user.userId })
    ).map((p) => p.userId);
    [{ id: orgA }] = await db
      .insert(organisation)
      .values({ organisationName: tag, joinKey: tag, createdBy: anna })
      .returning({ id: organisation.organisationId });
    await db.insert(userOrganisation).values([anna, mallory].map((userId) => ({ userId, organisationId: orgA, role: "member" })));
    const made = await db
      .insert(benchChannel)
      .values({ channelKey: "everyone", channelName: "Everyone", channelType: "global" })
      .onConflictDoNothing()
      .returning({ id: benchChannel.channelId });
    createdEveryone = made.length > 0;
    [{ id: channelId }] = await db.select({ id: benchChannel.channelId }).from(benchChannel).where(eq(benchChannel.channelKey, "everyone"));
  });

  beforeEach(async () => {
    if (!alive()) await startServer();
  });

  afterEach(async () => {
    for (const s of open.splice(0)) s.disconnect();
    await settle(50);
  });

  afterAll(async () => {
    server?.kill();
    await db.delete(benchMessage).where(inArray(benchMessage.userId, [anna, mallory]));
    await db.delete(benchDmThread).where(inArray(benchDmThread.userAId, [anna, mallory]));
    await db.delete(benchChannel).where(eq(benchChannel.organisationId, orgA));
    if (createdEveryone) await db.delete(benchChannel).where(eq(benchChannel.channelId, channelId));
    await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, orgA));
    await db.delete(organisation).where(eq(organisation.organisationId, orgA));
    await db.delete(user).where(inArray(user.userId, [anna, mallory]));
  });

  for (const [event, bad] of Object.entries(BAD_FIELDS)) {
    it(`drops malformed events: ${event}`, async () => {
      const a = await connect(anna);
      const m = await connect(mallory);
      for (const args of [...NOT_PAYLOADS, ...bad.map((b) => [b])]) m.socket.emit(event, ...args);
      await settle();
      await expectWorking(a, m, `after ${event}`);
    });
  }

  it("tells the sender a payload was refused, with a code, and stores nothing from it", async () => {
    const m = await connect(mallory);
    m.socket.emit("bench:dm:send", { recipientId: TOO_BIG, body: "never stored" });
    m.socket.emit("bench:message", { channelKey: "everyone", body: 5 });
    await settle();
    expect(m.of("bench:error")).toEqual(Array(2).fill({ error: expect.any(String), code: "VALIDATION" }));
    const stored = await db.select().from(benchMessage).where(inArray(benchMessage.messageBody, ["never stored", "5"]));
    expect(stored.filter((r) => r.userId === mallory)).toEqual([]);
  });

  it("still sends a direct message when the recipient id arrives as digits in a string", async () => {
    const a = await connect(anna);
    const m = await connect(mallory);
    m.socket.emit("bench:dm:send", { recipientId: String(anna), body: "as a string" });
    await settle();
    expect(a.of("bench:dm:new").map((x) => x.messageBody)).toEqual(["as a string"]);
  });

  describe("typing is accepted only for rooms the socket has joined", () => {
    it("reaches nobody when the sender names a room it is not in", async () => {
      const a = await connect(anna);
      const m = await connect(mallory);
      a.socket.emit("bench:join", { channelKey: `org_${orgA}` });
      await settle();
      m.socket.emit("bench:typing", { channelKey: `user_${anna}` });
      m.socket.emit("bench:typing", { channelKey: `org_${orgA}` });
      await settle();
      expect(a.of("bench:typing")).toEqual([]);
    });

    it("reaches the others in a joined room, and Everyone as before", async () => {
      const a = await connect(anna);
      const m = await connect(mallory);
      for (const c of [a, m]) c.socket.emit("bench:join", { channelKey: `org_${orgA}` });
      await settle();
      m.socket.emit("bench:typing", { channelKey: `org_${orgA}` });
      // The web leaves Everyone when it switches tab; coming back must still show its typing.
      m.socket.emit("bench:leave", { channelKey: "everyone" });
      m.socket.emit("bench:join", { channelKey: "everyone" });
      await settle();
      m.socket.emit("bench:typing", { channelKey: "everyone" });
      await settle();
      const typing = { userId: mallory, userName: "mallory" };
      expect(a.of("bench:typing")).toEqual([{ channelKey: `org_${orgA}`, ...typing }, { channelKey: "everyone", ...typing }]);
    });
  });
});

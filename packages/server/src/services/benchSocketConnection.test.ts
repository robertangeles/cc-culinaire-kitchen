import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent, createServer, get, type Server as HttpServer } from "node:http";
import { connect as tcp, type AddressInfo, type Socket as TcpSocket } from "node:net";
import jwt from "jsonwebtoken";
import { io, type Socket } from "socket.io-client";

/** Connecting to the Bench, leaving it and stopping it, over real connections. Only the database is a stand-in, so a read can be made to wait. */

const { profiles } = vi.hoisted(() => ({ profiles: { held: null as null | (() => void)[], read: vi.fn() } }));
vi.mock("../db/index.js", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: () => profiles.read() }) }) }) },
}));
vi.mock("./benchService.js", () => ({ getUserOrganisationIds: async () => [5] }));
vi.mock("./benchDmService.js", () => ({}));

import { initBenchSocket } from "./benchSocketService.js";

const KITCHEN = { channelKey: "org_5" };
const ANN = 101;
const BO = 102;

describe("the Bench's connections", () => {
  let http: HttpServer;
  let port: number;
  let closeBench: () => void;
  const open: Socket[] = [];
  const keepAlive = new Agent({ keepAlive: true }); // as a browser's long-polling

  const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));
  const token = (userId: number) => jwt.sign({ sub: userId, roles: [], permissions: [] }, process.env.JWT_ACCESS_SECRET ?? "dev-access-secret");

  /** Profile reads from now on wait for `release`. */
  const holdReads = () => void (profiles.held = []);
  const release = () => {
    const held = profiles.held ?? [];
    profiles.held = null;
    held.forEach((r) => r());
  };

  /** `first` is sent the moment the client is connected. */
  async function connect(userId: number, first: [string, unknown][] = [], transport = "websocket") {
    const socket = io(`http://127.0.0.1:${port}`, { auth: { token: token(userId) }, transports: [transport], agent: keepAlive as any, forceNew: true, reconnection: false });
    open.push(socket);
    const got: { name: string; payload: any }[] = [];
    socket.onAny((name, payload) => got.push({ name, payload }));
    await new Promise<void>((ok, fail) => {
      socket.once("connect", () => {
        for (const [event, payload] of first) socket.emit(event, payload);
        ok();
      });
      socket.once("connect_error", fail);
    });
    await settle();
    const inRoom = (key: string) => got.filter((e) => e.name === "bench:presence:update" && e.payload.channelKey === key).map((e) => e.payload.users.map((u: any) => u.userId).sort());
    return { socket, got, inRoom, here: (key = "org_5") => inRoom(key).at(-1) };
  }

  beforeEach(async () => {
    profiles.held = null;
    profiles.read.mockImplementation(async () => {
      if (profiles.held) await new Promise<void>((r) => profiles.held!.push(r));
      return [{ userName: "Someone", userPhotoPath: null }];
    });
    http = createServer((_req, res) => void setTimeout(() => res.end(), 300));
    closeBench = initBenchSocket(http);
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
    port = (http.address() as AddressInfo).port;
  });

  afterEach(async () => {
    release();
    for (const s of open.splice(0)) s.disconnect();
    await settle(50);
    if (http.listening) await new Promise((r) => (http.close(r), http.closeAllConnections()));
  });

  describe("connecting", () => {
    it("takes what a client sends as it connects, while its profile is still being read", async () => {
      const ann = await connect(ANN, [["bench:join", KITCHEN]]);
      holdReads();
      const bo = await connect(BO, [["bench:join", KITCHEN]]);
      ann.socket.emit("bench:typing", KITCHEN);
      await settle();
      expect(bo.got.filter((e) => e.name === "bench:typing").map((e) => e.payload)).toEqual([{ ...KITCHEN, userId: ANN, userName: "Someone" }]);
    });

    it("then lists the person in the kitchen's room and in Everyone", async () => {
      const ann = await connect(ANN, [["bench:join", KITCHEN]]);
      holdReads();
      const bo = await connect(BO, [["bench:join", KITCHEN]]);
      expect(ann.here()).toEqual([ANN]);
      release();
      await settle();
      expect(ann.here()).toEqual([ANN, BO]);
      expect(bo.here()).toEqual([ANN, BO]);
      expect(ann.here("everyone")).toEqual([ANN, BO]);
    });

    it("delivers a direct message's typing notice sent to the person meanwhile", async () => {
      const ann = await connect(ANN);
      holdReads();
      const bo = await connect(BO);
      ann.socket.emit("bench:dm:typing", { recipientId: BO });
      await settle();
      expect(bo.got.map((e) => e.name)).toContain("bench:dm:typing");
    });

    it("does not list someone who was gone before their profile was read", async () => {
      const ann = await connect(ANN, [["bench:join", KITCHEN]]);
      holdReads();
      const bo = await connect(BO, [["bench:join", KITCHEN]]);
      bo.socket.disconnect();
      await settle();
      release();
      await settle();
      ann.socket.emit("bench:presence:heartbeat");
      await settle();
      expect(ann.here("everyone")).toEqual([ANN]);
      expect(ann.here()).toEqual([ANN]);
    });
  });

  describe("a connection that ends", () => {
    it("is told to the kitchen's room", async () => {
      const ann = await connect(ANN, [["bench:join", KITCHEN]]);
      const bo = await connect(BO, [["bench:join", KITCHEN]]);
      expect(ann.here()).toEqual([ANN, BO]);
      bo.socket.disconnect();
      await settle();
      expect(ann.here()).toEqual([ANN]);
      expect(ann.here("everyone")).toEqual([ANN]);
    });

    it("leaves a person listed while another device of theirs is in the room, and not once only elsewhere", async () => {
      const ann = await connect(ANN, [["bench:join", KITCHEN]]);
      const phone = await connect(BO, [["bench:join", KITCHEN]]);
      const web = await connect(BO, [["bench:join", KITCHEN]]);
      await connect(BO);
      phone.socket.disconnect();
      await settle();
      expect(ann.here()).toEqual([ANN, BO]);
      web.socket.disconnect();
      await settle();
      expect(ann.here()).toEqual([ANN]);
      expect(ann.here("everyone")).toEqual([ANN, BO]);
    });

    it("is not told to people outside the kitchen", async () => {
      const olga = await connect(103);
      const bo = await connect(BO, [["bench:join", KITCHEN]]);
      bo.socket.disconnect();
      await settle();
      expect(olga.inRoom("org_5")).toEqual([]);
    });
  });

  describe("stopping", () => {
    /** How long the HTTP server takes to finish, as index.ts stops it. */
    async function stop() {
      const started = Date.now();
      await new Promise<void>((ok, fail) => {
        const late = setTimeout(() => fail(new Error("still running after 5 seconds")), 5_000);
        http.close(() => (clearTimeout(late), ok()));
        closeBench();
      });
      return Date.now() - started;
    }

    it.each(["websocket", "polling"])("ends a %s connection at once, as a drop the client comes back from by itself", async (transport) => {
      const ann = await connect(ANN, [["bench:join", KITCHEN]], transport);
      const bo = await connect(BO, [["bench:join", KITCHEN]], transport);
      const reasons: string[] = [];
      for (const c of [ann, bo]) c.socket.once("disconnect", (reason) => reasons.push(reason));
      expect(await stop()).toBeLessThan(1_900);
      await settle();
      expect(reasons).toHaveLength(2);
      // After "io server disconnect" a client never reconnects.
      expect(reasons).not.toContain("io server disconnect");
    });

    it("does not wait for a client that answers nothing", async () => {
      const silent: TcpSocket = tcp(port, "127.0.0.1");
      silent.on("error", () => undefined);
      silent.write(
        `GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${Buffer.alloc(16).toString("base64")}\r\n\r\n`,
      );
      await new Promise((r) => silent.once("data", r));
      expect(await stop()).toBeLessThan(1_900);
      silent.destroy();
    });

    it("does not wait for a kept-alive connection whose last answer goes out meanwhile", async () => {
      get({ port, host: "127.0.0.1", agent: keepAlive }, (res) => res.resume());
      await settle(50);
      expect(await stop()).toBeLessThan(1_900);
    });
  });
});

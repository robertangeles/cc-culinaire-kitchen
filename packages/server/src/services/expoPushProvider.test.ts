import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createExpoPushProvider, type PushMessage } from "./expoPushProvider.js";

/** A local stand-in for Expo's push service: records what it is sent and answers from `reply`. */
let server: http.Server;
let baseUrl: string;
let seen: Array<{ path: string; auth: string | undefined; body: unknown }>;
let reply: (path: string, body: unknown) => { status: number; json: unknown };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      seen.push({ path: req.url ?? "", auth: req.headers.authorization, body });
      const { status, json } = reply(req.url ?? "", body);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/--/api/v2/push`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
beforeEach(() => {
  seen = [];
  reply = () => ({ status: 200, json: { data: [] } });
});

const msg = (to: string): PushMessage => ({ to, title: "T", body: "B", data: { link: "/shifts" }, sound: "default" });

describe("createExpoPushProvider.send", () => {
  it("posts the messages with the access token and returns one ticket per message, in order", async () => {
    reply = (_p, body) => ({
      status: 200,
      json: { data: (body as PushMessage[]).map((m, i) => (m.to.includes("dead") ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: `t${i}` })) },
    });
    const provider = createExpoPushProvider({ baseUrl, accessToken: "secret" });
    const tickets = await provider.send([msg("ExponentPushToken[a]"), msg("ExponentPushToken[dead]")]);
    expect(seen).toHaveLength(1);
    expect(seen[0].path).toBe("/--/api/v2/push/send");
    expect(seen[0].auth).toBe("Bearer secret");
    expect((seen[0].body as PushMessage[]).map((m) => m.sound)).toEqual(["default", "default"]);
    expect(tickets).toEqual([
      { status: "ok", id: "t0" },
      { status: "error", error: "DeviceNotRegistered", message: "gone" },
    ]);
  });

  it("sends no Authorization header without an access token", async () => {
    reply = () => ({ status: 200, json: { data: [{ status: "ok", id: "x" }] } });
    await createExpoPushProvider({ baseUrl }).send([msg("ExponentPushToken[a]")]);
    expect(seen[0].auth).toBeUndefined();
  });

  it("splits more than 100 messages into requests of at most 100 and keeps the order", async () => {
    reply = (_p, body) => ({ status: 200, json: { data: (body as PushMessage[]).map((m) => ({ status: "ok", id: m.to })) } });
    const messages = Array.from({ length: 205 }, (_, i) => msg(`ExponentPushToken[${i}]`));
    const tickets = await createExpoPushProvider({ baseUrl }).send(messages);
    expect(seen.map((s) => (s.body as unknown[]).length)).toEqual([100, 100, 5]);
    expect(tickets.map((t) => (t.status === "ok" ? t.id : ""))).toEqual(messages.map((m) => m.to));
  });

  it("throws on a server error so the caller keeps its tokens", async () => {
    reply = () => ({ status: 503, json: { errors: [{ code: "SERVICE_UNAVAILABLE" }] } });
    await expect(createExpoPushProvider({ baseUrl }).send([msg("ExponentPushToken[a]")])).rejects.toThrow(/503/);
  });

  it("throws when the answer is not one ticket per message", async () => {
    reply = () => ({ status: 200, json: { data: [] } });
    await expect(createExpoPushProvider({ baseUrl }).send([msg("ExponentPushToken[a]")])).rejects.toThrow(/one ticket/);
  });
});

describe("createExpoPushProvider.receipts", () => {
  it("returns a receipt per ticket id the service has one for", async () => {
    reply = () => ({
      status: 200,
      json: { data: { t1: { status: "ok" }, t2: { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } } } },
    });
    const receipts = await createExpoPushProvider({ baseUrl, accessToken: "secret" }).receipts(["t1", "t2", "t3"]);
    expect(seen[0].path).toBe("/--/api/v2/push/getReceipts");
    expect(seen[0].body).toEqual({ ids: ["t1", "t2", "t3"] });
    expect(receipts.get("t1")).toEqual({ status: "ok" });
    expect(receipts.get("t2")).toEqual({ status: "error", error: "DeviceNotRegistered", message: "gone" });
    expect(receipts.has("t3")).toBe(false);
  });

  it("asks for at most 1000 ids at a time", async () => {
    reply = () => ({ status: 200, json: { data: {} } });
    await createExpoPushProvider({ baseUrl }).receipts(Array.from({ length: 1500 }, (_, i) => `t${i}`));
    expect(seen.map((s) => (s.body as { ids: string[] }).ids.length)).toEqual([1000, 500]);
  });
});

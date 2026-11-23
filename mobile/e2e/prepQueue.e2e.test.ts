import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generate } from "otplib";
import { PrepTodaySchema } from "@culinaire/shared/schemas/prep";
import { createApiClient, type Tokens } from "../src/api/client";
import { createAuthApi } from "../src/api/auth";
import { createSession, type Snapshot } from "../src/auth/session";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../src/outbox/outbox";
import { newUuid } from "../src/outbox/uuid";
import type { KvStore } from "../src/storage/kv";
import { createPrepApi } from "../src/prep/prepApi";
import { prepHandlers } from "../src/prep/prepCommands";
import { createPrepStore } from "../src/prep/prepStore";
import { localDate } from "../src/prep/prepView";

/**
 * Prep against a real server, with the phone's own code and no UI: make the day's list with no signal and send it on reconnect,
 * tick with no signal and send it with the phone's time and the cook's id, see a lost reply and a repeated generate leave the
 * ticks alone, and see a tick on a session that ended come back as a refusal the cook must see.
 * Needs the server on E2E_API_URL (default http://localhost:3009) and the seeded E2E user. Skipped locally without credentials;
 * fails in CI without them.
 */
const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
const totpSecret = process.env.E2E_USER_TOTP_SECRET;
const baseUrl = process.env.E2E_API_URL ?? "http://localhost:3009";

const tag = `pq${Date.now().toString(36)}-`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!process.env.CI && (!email || !password || !totpSecret))("prep queue against the real server", () => {
  let airplane = false;
  let tokens: Tokens | null = null;
  const tokenStore = { load: async () => tokens, save: async (t: Tokens) => void (tokens = t), clear: async () => void (tokens = null) };
  const offlineAwareFetch: typeof fetch = (input, init) => (airplane ? Promise.reject(new TypeError("Network request failed")) : fetch(input, init));
  const client = createApiClient({ baseUrl, tokenStore, appVersion: "0.1.0-e2e", fetchFn: offlineAwareFetch, timeoutMs: 20_000 });
  const authApi = createAuthApi(client, tokenStore);
  let snapshot: Snapshot | null = null;
  const session = createSession({ api: authApi, hasTokens: async () => tokens !== null, snapshots: { load: async () => snapshot, save: async (s) => void (snapshot = s) } });

  const rows = new Map<string, OutboxEntry>();
  const outboxStore: OutboxStore = { list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  const kvMap = new Map<string, string>();
  const kv: KvStore = { get: async (k) => kvMap.get(k) ?? null, set: async (k, v) => void kvMap.set(k, v), delete: async (k) => void kvMap.delete(k) };
  let clock = Date.now();
  let seq = 0;
  let userId: number | null = null;
  const outbox = createOutbox({ store: outboxStore, send: async () => {}, handlers: prepHandlers(client), now: () => clock, newId: () => `e${String(++seq).padStart(4, "0")}`, getUserId: () => userId });
  const api = createPrepApi(client);
  let locationId = "";
  let prep: ReturnType<typeof createPrepStore>;
  let menuItemId = "";

  /** What the server says, read with the network always on; null when nothing is open for today. */
  const serverToday = async () => {
    const res = await fetch(`${baseUrl}/api/prep/sessions/today?date=${localDate(new Date())}&storeLocationId=${locationId}`, { headers: { Authorization: `Bearer ${tokens!.accessToken}` } });
    return res.ok ? PrepTodaySchema.parse(await res.json()) : null;
  };
  const onServer = async () => (await serverToday())!;
  const reconnect = async () => {
    airplane = false;
    clock += 10 * 60_000; // past any backoff
    return outbox.drain();
  };

  beforeAll(async () => {
    await session.signIn(email!, password!);
    expect(session.getSnapshot().state.phase).toBe("mfa");
    await session.submitCode(await generate({ secret: totpSecret! }));
    if (session.getSnapshot().state.phase === "mfa") {
      await wait(31_000); // that code's window was already used (the other phone tests sign in too)
      await session.submitCode(await generate({ secret: totpSecret! }));
    }
    const state = session.getSnapshot().state;
    expect(state.phase).toBe("ready");
    if (state.phase === "ready") userId = state.user.userId;
    locationId = (await authApi.locationContext()).selectedLocationId!;
    prep = createPrepStore({ api, kv, outbox, getUserId: () => userId!, locationId, kick: () => {}, now: () => Date.now(), newId: newUuid });

    const item = await client.request<{ menuItemId: string }>("POST", "/api/menu/items", { body: { name: `${tag}Soup`, category: "Starter", sellingPrice: "9.50" } });
    menuItemId = item.menuItemId;
    for (const [name, qty] of [["Onion", "2"], ["Carrot", "1.5"]]) await client.request("POST", `/api/menu/items/${menuItemId}/ingredients`, { body: { ingredientName: `${tag}${name}`, quantity: qty, unit: "kg" } });
  });

  afterAll(async () => {
    airplane = false;
    const today = await serverToday().catch(() => null);
    if (today && !today.session.isEnded) await client.request("PATCH", `/api/prep/sessions/${today.session.prepSessionId}/end`, { body: {} }).catch(() => {});
    if (menuItemId) await client.request("DELETE", `/api/menu/items/${menuItemId}`).catch(() => {});
  });

  it("makes today's list with no signal: saved on the phone, nothing on the server, then created, filled and generated in order on reconnect", async () => {
    airplane = true;
    await prep.makeList({ selections: [{ menuItemId, dishName: `${tag}Soup`, expectedPortions: 12, category: "Starter" }], expectedCovers: 80 });
    expect(prep.getSnapshot().list.plan).toMatchObject({ sync: "waiting" });
    expect((await outbox.drain()).sent).toBe(0);
    airplane = false;
    expect(await serverToday()).toBeNull(); // nothing reached the server while the phone was offline

    expect((await reconnect()).sent).toBe(3);
    const today = await onServer();
    expect(today.session).toMatchObject({ expectedCovers: 80 });
    expect(today.tasks.map((t) => t.ingredientName).sort()).toEqual([`${tag}Carrot`, `${tag}Onion`]);
    expect(today.tasks.every((t) => t.status === "pending")).toBe(true);
    await prep.refresh();
    expect(prep.getSnapshot().list).toMatchObject({ plan: null, progress: { total: 2 } });
  });

  it("ticks with no signal: the row shows done at once, the server learns it on reconnect with the phone's time and the cook's id", async () => {
    await prep.refresh();
    const onion = prep.getSnapshot().list.rows.find((r) => r.ingredientName === `${tag}Onion`)!;
    airplane = true;
    const tickedAt = new Date().toISOString();
    await prep.setStatus(onion.prepTaskId, "completed");
    expect(prep.getSnapshot().list.rows.find((r) => r.prepTaskId === onion.prepTaskId)).toMatchObject({ status: "completed", sync: "waiting" });
    expect((await onServer()).tasks.find((t) => t.prepTaskId === onion.prepTaskId)!.status).toBe("pending");

    expect((await reconnect()).sent).toBe(1);
    const task = (await onServer()).tasks.find((t) => t.prepTaskId === onion.prepTaskId)!;
    expect(task).toMatchObject({ status: "completed", completedBy: userId });
    expect(Math.abs(new Date(task.completedAt!).getTime() - new Date(tickedAt).getTime())).toBeLessThan(5_000);
  });

  it("a tick sent again after a lost reply changes nothing, and generating again with the same request id leaves the ticks alone", async () => {
    const before = (await onServer()).tasks.find((t) => t.status === "completed")!;
    await client.request("PATCH", `/api/prep/tasks/${before.prepTaskId}`, { body: { status: "completed" } });
    expect((await onServer()).tasks.find((t) => t.prepTaskId === before.prepTaskId)).toMatchObject({ completedAt: before.completedAt, completedBy: userId });

    const generated = (await outbox.entriesOfTypes(["prep.generate"])).at(-1)!.command as { prepSessionId: string; requestId: string };
    const raw = await fetch(`${baseUrl}/api/prep/sessions/${generated.prepSessionId}/generate`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens!.accessToken}` }, body: JSON.stringify({ requestId: generated.requestId }) });
    expect(raw.status).toBe(200);
    expect((await onServer()).tasks.find((t) => t.prepTaskId === before.prepTaskId)).toMatchObject({ status: "completed" });
  });

  it("unticks and skips, newest word wins when the cook changes their mind with no signal", async () => {
    const [done, other] = [(await onServer()).tasks.find((t) => t.status === "completed")!, (await onServer()).tasks.find((t) => t.status === "pending")!];
    await prep.refresh();
    airplane = true;
    await prep.setStatus(done.prepTaskId, "pending");
    await prep.setStatus(other.prepTaskId, "completed");
    await prep.setStatus(other.prepTaskId, "skipped");
    expect((await reconnect()).sent).toBe(2);
    const after = (await onServer()).tasks;
    expect(after.find((t) => t.prepTaskId === done.prepTaskId)).toMatchObject({ status: "pending", completedBy: null, completedAt: null });
    expect(after.find((t) => t.prepTaskId === other.prepTaskId)).toMatchObject({ status: "skipped" });
  });

  it("a tick on a session that has ended is refused, kept on the row with the server's words, and can be discarded", async () => {
    await prep.refresh();
    const pending = prep.getSnapshot().list.rows.find((r) => r.status === "pending")!;
    await prep.setStatus(pending.prepTaskId, "completed");
    await client.request("PATCH", `/api/prep/sessions/${pending.prepSessionId}/end`, { body: {} });
    await outbox.drain();
    const stuck = prep.getSnapshot().list.rows.find((r) => r.prepTaskId === pending.prepTaskId)!;
    expect(stuck).toMatchObject({ sync: "attention", status: "completed" });
    expect(stuck.attentionMessage).toMatch(/ended/i);
    await prep.discard(stuck.entryId!);
    expect(await outbox.open(["prep.tick"])).toEqual([]);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generate } from "otplib";
import { createApiClient, type Tokens } from "../src/api/client";
import { createAuthApi } from "../src/api/auth";
import { createSession, type Snapshot } from "../src/auth/session";
import { createCountApi } from "../src/count/countApi";
import { createCountStore } from "../src/count/countStore";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../src/outbox/outbox";
import { createSendSaveLine } from "../src/outbox/sendSaveLine";
import type { KvStore } from "../src/storage/kv";

/**
 * Release-1 phone flow against a real server, with the phone's own code and no UI: sign in with MFA, find the
 * open area count, claim two areas that share an item, count with no signal, reconnect and send, submit, and see
 * a late count into a submitted area come back as needs-attention. Needs the server on E2E_API_URL (default
 * http://localhost:3009) and the seeded E2E user, so it only runs when E2E_USER_EMAIL is set.
 */
const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
const totpSecret = process.env.E2E_USER_TOTP_SECRET;
const baseUrl = process.env.E2E_API_URL ?? "http://localhost:3009";

const tag = `ph${Date.now().toString(36)}-`;
const API = "/api/inventory";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!email || !password || !totpSecret)("phone flow against the real server", () => {
  // The phone's pieces, wired the way appContext wires them, with memory storage and a fetch we can cut.
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
  let clock = Date.now();
  let seq = 0;
  let userId: number | null = null;
  const outbox = createOutbox({ store: outboxStore, send: createSendSaveLine(client), now: () => clock, newId: () => `e${String(++seq).padStart(4, "0")}`, getUserId: () => userId });
  const kvMap = new Map<string, string>();
  const kv: KvStore = { get: async (k) => kvMap.get(k) ?? null, set: async (k, v) => void kvMap.set(k, v), delete: async (k) => void kvMap.delete(k) };

  const names = { a: `${tag}Bar`, b: `${tag}Cellar` };
  const ids = { shared: "", soloA: "" };
  const cleanups: Array<() => Promise<unknown>> = [];
  let sessionId = "";

  beforeAll(async () => {
    // Sign in the way a chef does: password, then the code. A code can only be used once per 30s window, so a
    // rejected first code (the Playwright setup may have just used this window) gets one retry on the next window.
    await session.signIn(email!, password!);
    expect(session.getSnapshot().state.phase).toBe("mfa");
    await session.submitCode(await generate({ secret: totpSecret! }));
    if (session.getSnapshot().state.phase === "mfa") {
      await wait(31_000);
      await session.submitCode(await generate({ secret: totpSecret! }));
    }
    const state = session.getSnapshot().state;
    expect(state.phase).toBe("ready");
    if (state.phase === "ready") userId = state.user.userId;

    // A manager (the web) sets up two areas that share an item, and opens an area count.
    const mk = async (name: string) => (await client.request<{ ingredientId: string }>("POST", `${API}/ingredients`, { body: { ingredientName: `${tag}${name}`, ingredientCategory: "produce", baseUnit: "kg", unitCost: "1.00" } })).ingredientId;
    ids.shared = await mk("shared");
    ids.soloA = await mk("soloA");
    const loc = (await authApi.locationContext()).selectedLocationId!;
    for (const [i, [name, items]] of Object.entries([[names.a, [ids.shared, ids.soloA]], [names.b, [ids.shared]]] as Array<[string, string[]]>)) {
      const area = await client.request<{ storageAreaId: string }>("POST", `${API}/locations/${loc}/storage-areas`, { body: { areaName: name, sortOrder: 960 + Number(i) } });
      cleanups.push(() => client.request("DELETE", `${API}/storage-areas/${area.storageAreaId}`));
      await client.request("PUT", `${API}/storage-areas/${area.storageAreaId}/items`, { body: { items: items.map((ingredientId) => ({ ingredientId })) } });
    }
    const opened = await client.request<{ sessionId: string }>("POST", `${API}/stock-takes`, { body: { mode: "AREA", categories: [names.a, names.b] } });
    sessionId = opened.sessionId;
  });

  afterAll(async () => {
    airplane = false;
    if (sessionId) {
      let s = await client.request<{ sessionStatus: string }>("GET", `${API}/stock-takes/${sessionId}`).catch(() => null);
      if (s?.sessionStatus === "OPEN") {
        await client.request("POST", `${API}/stock-takes/${sessionId}/submit-for-review`).catch(() => {});
        s = await client.request<{ sessionStatus: string }>("GET", `${API}/stock-takes/${sessionId}`).catch(() => null);
      }
      if (s?.sessionStatus === "PENDING_REVIEW") await client.request("POST", `${API}/stock-takes/${sessionId}/approve`).catch(() => {});
    }
    for (const undo of cleanups.reverse()) await undo().catch(() => {});
  });

  const counts = () =>
    createCountStore({ api: createCountApi(client), kv, outbox, getUserId: () => userId!, locationId: "e2e", kick: () => {} });
  const store = counts();

  it("downloads the open stock take with each area's items in shelf order and the shared item marked", async () => {
    await store.refresh();
    const snap = store.getSnapshot();
    expect(snap.error ?? snap.phase).toBe("ready");
    const bar = snap.sheets.find((s) => s.categoryName === names.a)!;
    expect(bar.items.map((i) => i.ingredientId).sort()).toEqual([ids.shared, ids.soloA].sort());
    expect(bar.items.find((i) => i.ingredientId === ids.shared)!.alsoIn).toEqual([names.b]);
    expect(snap.sheets.find((s) => s.categoryName === names.b)!.items[0].alsoIn).toEqual([names.a]);
  });

  it("claims both areas online", async () => {
    expect(await store.openArea(names.a)).toEqual({ status: "claimed" });
    expect(await store.openArea(names.b)).toEqual({ status: "claimed" });
  });

  it("counts with no signal: everything is saved on the phone, nothing is lost, submit waits", async () => {
    airplane = true;
    await store.saveCount(names.a, { ingredientId: ids.shared, ingredientName: "shared", rawQty: 3, countedUnit: "kg" });
    await store.saveCount(names.a, { ingredientId: ids.soloA, ingredientName: "soloA", rawQty: 2.5, countedUnit: "kg" });
    await store.saveCount(names.b, { ingredientId: ids.shared, ingredientName: "shared", rawQty: 4, countedUnit: "kg" });

    const first = await outbox.drain();
    expect(first.sent).toBe(0);
    expect(first.nextWakeAt).not.toBeNull();
    expect(store.answers(names.a).get(ids.shared)).toMatchObject({ rawQty: 3, saveState: "saved_on_phone" });
    expect(await store.submit(names.a)).toMatchObject({ ok: false, reason: "blocked" });

    // The app reopens with no signal and still shows the stock take and the counts.
    const reopened = counts();
    await reopened.refresh();
    expect(reopened.getSnapshot()).toMatchObject({ phase: "ready", offline: true });
    expect(reopened.answers(names.a).get(ids.soloA)).toMatchObject({ rawQty: 2.5 });
  });

  it("sends the queued counts when the signal returns, and the server holds them", async () => {
    airplane = false;
    clock += 10 * 60_000; // past any backoff
    const out = await outbox.drain();
    expect(out.sent).toBe(3);
    await store.refresh();
    expect(store.answers(names.a).get(ids.shared)).toMatchObject({ rawQty: 3, saveState: "accepted" });

    const lines = await createCountApi(client).areaLines(sessionId, names.a);
    expect(lines.map((l) => [l.ingredientId, l.rawQty]).sort()).toEqual([[ids.shared, 3], [ids.soloA, 2.5]].sort());
  });

  it("submits both areas; the stock take moves to review only when the last area is in", async () => {
    expect(await store.submit(names.a)).toEqual({ ok: true });
    expect((await client.request<{ sessionStatus: string }>("GET", `${API}/stock-takes/${sessionId}`)).sessionStatus).toBe("OPEN");
    expect(await store.submit(names.b)).toEqual({ ok: true });
    expect((await client.request<{ sessionStatus: string }>("GET", `${API}/stock-takes/${sessionId}`)).sessionStatus).toBe("PENDING_REVIEW");
  });

  it("a late count into a submitted area comes back as needs-attention with the server's words", async () => {
    // A count queued earlier (say on another phone) that reaches the server after the area was submitted.
    await outbox.enqueue({ sessionId, categoryName: names.a, ingredientId: ids.soloA, ingredientName: "soloA", rawQty: 9, countedUnit: "kg", claimRevision: 1 });
    clock += 60_000;
    await outbox.drain();
    const [stuck] = (await outbox.entriesFor(sessionId, names.a)).filter((e) => e.status === "NEEDS_ATTENTION");
    expect(stuck.attention).toMatchObject({ reason: "area_closed", message: expect.stringMatching(/^Cannot count: category is/) });
    expect(stuck.command.rawQty).toBe(9);
  });
});

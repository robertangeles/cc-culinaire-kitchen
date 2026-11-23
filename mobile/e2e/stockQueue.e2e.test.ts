import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generate } from "otplib";
import { createApiClient, type Tokens } from "../src/api/client";
import { createAuthApi } from "../src/api/auth";
import { createSession, type Snapshot } from "../src/auth/session";
import { createConsumptionApi } from "../src/consumption/consumptionApi";
import { consumptionHandlers, type ConsumptionLogCommand } from "../src/consumption/consumptionCommands";
import { createMovementApi } from "../src/movements/movementApi";
import { movementHandlers, type MovementLogCommand } from "../src/movements/movementCommands";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../src/outbox/outbox";
import { newUuid } from "../src/outbox/uuid";
import { localDayBounds } from "../src/waste/wasteView";

/**
 * The usage log and stock movements through the offline queue against a real server, with the phone's own code and no UI: log with
 * no signal (one entry edited and one deleted before it leaves the phone), reconnect and send in order, see a lost reply resent
 * without a second row, change and delete an entry that is on the server, record a move, and see a refused entry (a location the
 * person does not work at, units that cannot be converted, an area that is not at the location) stay visible. Needs the server on
 * E2E_API_URL (default http://localhost:3009) and the seeded E2E user. Skipped locally without credentials; fails in CI without them.
 */
const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
const totpSecret = process.env.E2E_USER_TOTP_SECRET;
const baseUrl = process.env.E2E_API_URL ?? "http://localhost:3009";

const tag = `sq${Date.now().toString(36)}-`;
const API = "/api/inventory";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!process.env.CI && (!email || !password || !totpSecret))("usage and moves queue against the real server", () => {
  let airplane = false;
  let tokens: Tokens | null = null;
  const tokenStore = { load: async () => tokens, save: async (t: Tokens) => void (tokens = t), clear: async () => void (tokens = null) };
  const offlineAwareFetch: typeof fetch = (input, init) => (airplane ? Promise.reject(new TypeError("Network request failed")) : fetch(input, init));
  const client = createApiClient({ baseUrl, tokenStore, appVersion: "0.1.0-e2e", fetchFn: offlineAwareFetch, timeoutMs: 20_000 });
  const authApi = createAuthApi(client, tokenStore);
  let snapshot: Snapshot | null = null;
  const session = createSession({ api: authApi, hasTokens: async () => tokens !== null, snapshots: { load: async () => snapshot, save: async (s) => void (snapshot = s) } });

  const rows = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  let clock = Date.now();
  let seq = 0;
  let userId: number | null = null;
  const outbox = createOutbox({ store, send: async () => {}, handlers: [...consumptionHandlers(client), ...movementHandlers(client)], now: () => clock, newId: () => `e${String(++seq).padStart(4, "0")}`, getUserId: () => userId });
  const usageApi = createConsumptionApi(client);
  const moveApi = createMovementApi(client);
  let locationId = "";
  let salt = ""; // a kg item
  let areaA = "";
  let areaB = "";
  const cleanups: Array<() => Promise<unknown>> = [];

  const usage = (over: Partial<ConsumptionLogCommand> = {}): ConsumptionLogCommand => ({ consumptionLogId: newUuid(), storeLocationId: locationId, ingredientId: salt, ingredientName: `${tag}salt`, quantity: 2, unit: "kg", reason: "kitchen_operations", shift: "morning", notes: null, loggedAt: new Date().toISOString(), ...over });
  const move = (over: Partial<MovementLogCommand> = {}): MovementLogCommand => ({ stockMovementId: newUuid(), storeLocationId: locationId, ingredientId: salt, ingredientName: `${tag}salt`, fromStorageAreaId: areaA, fromAreaName: `${tag}Stock`, toStorageAreaId: areaB, toAreaName: `${tag}Bar`, quantity: 3, unit: "kg", notes: null, movedAt: new Date().toISOString(), ...over });
  const usageToday = () => usageApi.list(localDayBounds(new Date()), locationId).then((r) => r.filter((e) => e.ingredientId === salt));
  const movesNow = () => moveApi.list(locationId).then((r) => r.filter((m) => m.ingredientId === salt));
  const post = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens!.accessToken}` }, body: JSON.stringify(body) });

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

    // A manager (the web) sets up an item and two areas.
    salt = (await client.request<{ ingredientId: string }>("POST", `${API}/ingredients`, { body: { ingredientName: `${tag}salt`, ingredientCategory: "dry_goods", baseUnit: "kg", unitCost: "1.00" } })).ingredientId;
    cleanups.push(() => client.request("DELETE", `${API}/ingredients/${salt}`));
    for (const name of ["Stock", "Bar"]) {
      const area = await client.request<{ storageAreaId: string }>("POST", `${API}/locations/${locationId}/storage-areas`, { body: { areaName: `${tag}${name}`, sortOrder: 970 } });
      cleanups.push(() => client.request("DELETE", `${API}/storage-areas/${area.storageAreaId}`));
      if (name === "Stock") areaA = area.storageAreaId;
      else areaB = area.storageAreaId;
    }
  });

  afterAll(async () => {
    airplane = false;
    for (const e of await usageToday().catch(() => [])) await client.request("DELETE", `${API}/consumption-logs/${e.consumptionLogId}`).catch(() => {});
    for (const undo of cleanups.reverse()) await undo().catch(() => {});
  });

  it("logs usage with no signal: saved on the phone, nothing on the server, and an entry edited or deleted before it leaves the phone is sent once, in its final form", async () => {
    airplane = true;
    const kept = usage();
    const edited = usage();
    const withdrawn = usage();
    for (const c of [kept, edited, withdrawn]) await outbox.enqueueCommand("consumption.log", c);
    await outbox.enqueueCommand("consumption.edit", { consumptionLogId: edited.consumptionLogId, label: "salt", changes: { quantity: 7.5, shift: null } });
    expect(await outbox.enqueueCommand("consumption.delete", { consumptionLogId: withdrawn.consumptionLogId, label: "salt" })).toBeNull();

    const first = await outbox.drain();
    expect(first.sent).toBe(0);
    expect(first.nextWakeAt).not.toBeNull();
    expect((await outbox.open(["consumption.log"])).length).toBe(2);

    airplane = false;
    clock += 10 * 60_000; // past any backoff
    expect((await outbox.drain()).sent).toBe(2);
    const onServer = await usageToday();
    expect(onServer.map((e) => e.consumptionLogId).sort()).toEqual([kept.consumptionLogId, edited.consumptionLogId].sort());
    expect(onServer.find((e) => e.consumptionLogId === edited.consumptionLogId)).toMatchObject({ quantity: 7.5, shift: null, unit: "kg", userId });
    expect(onServer.find((e) => e.consumptionLogId === kept.consumptionLogId)).toMatchObject({ quantity: 2, reason: "kitchen_operations", shift: "morning" });
  });

  it("a send whose reply was lost is sent again and finds the same row: still one entry, and the server says 200, not 201", async () => {
    const c = usage();
    await outbox.enqueueCommand("consumption.log", c);
    await outbox.drain();
    const body = { consumptionLogId: c.consumptionLogId, storeLocationId: c.storeLocationId, ingredientId: c.ingredientId, quantity: c.quantity, unit: c.unit, reason: c.reason };
    expect((await usageToday()).filter((e) => e.consumptionLogId === c.consumptionLogId)).toHaveLength(1);
    expect((await post(`${API}/consumption-logs`, body)).status).toBe(200);
    expect((await usageToday()).filter((e) => e.consumptionLogId === c.consumptionLogId)).toHaveLength(1);
  });

  it("changes an entry that is on the server, then deletes it; a repeat of the delete is still success", async () => {
    const c = usage();
    await outbox.enqueueCommand("consumption.log", c);
    await outbox.drain();
    await outbox.enqueueCommand("consumption.edit", { consumptionLogId: c.consumptionLogId, label: "salt", changes: { quantity: 9, notes: "event", reason: "staff_consumption" } });
    await outbox.drain();
    expect((await usageToday()).find((e) => e.consumptionLogId === c.consumptionLogId)).toMatchObject({ quantity: 9, notes: "event", reason: "staff_consumption" });

    await outbox.enqueueCommand("consumption.delete", { consumptionLogId: c.consumptionLogId, label: "salt" });
    await outbox.drain();
    expect((await usageToday()).some((e) => e.consumptionLogId === c.consumptionLogId)).toBe(false);
    await outbox.enqueueCommand("consumption.delete", { consumptionLogId: c.consumptionLogId, label: "salt" });
    await outbox.drain();
    expect(await outbox.open(["consumption.delete"])).toEqual([]); // the repeat was accepted, not stuck
  });

  it("keeps a refused usage entry on the phone with the server's words: a location the person does not work at, units that cannot be converted, an item the server does not know", async () => {
    const refusals = [usage({ storeLocationId: newUuid() }), usage({ unit: "bunch" }), usage({ ingredientId: newUuid() })];
    for (const c of refusals) await outbox.enqueueCommand("consumption.log", c);
    await outbox.drain();
    const stuck = await outbox.open(["consumption.log"]);
    expect(stuck).toHaveLength(3);
    for (const e of stuck) {
      expect(e.status).toBe("NEEDS_ATTENTION");
      expect(e.attention!.message.length).toBeGreaterThan(0);
      await outbox.discard(e.id);
    }
    expect(await outbox.open(["consumption.log"])).toEqual([]);
  });

  it("lists the active areas, records a move with no signal and sends it once; a repeat finds the same row", async () => {
    expect((await moveApi.areas(locationId)).map((a) => a.areaName)).toEqual(expect.arrayContaining([`${tag}Stock`, `${tag}Bar`]));
    airplane = true;
    const m = move({ notes: "Friday service" });
    await outbox.enqueueCommand("movement.log", m);
    expect((await outbox.drain()).sent).toBe(0);
    airplane = false;
    clock += 10 * 60_000;
    expect((await outbox.drain()).sent).toBe(1);
    expect((await movesNow()).filter((x) => x.stockMovementId === m.stockMovementId)).toMatchObject([{ quantity: 3, unit: "kg", fromAreaName: `${tag}Stock`, toAreaName: `${tag}Bar`, notes: "Friday service" }]);
    const again = await post(`${API}/locations/${locationId}/stock-movements`, { stockMovementId: m.stockMovementId, ingredientId: salt, fromStorageAreaId: areaA, toStorageAreaId: areaB, quantity: 3, unit: "kg" });
    expect(again.status).toBe(200);
    expect((await movesNow()).filter((x) => x.stockMovementId === m.stockMovementId)).toHaveLength(1);
  });

  it("keeps a refused move on the phone with the server's words: an area that is not at the location, units that cannot be converted, the same area twice", async () => {
    for (const c of [move({ fromStorageAreaId: newUuid() }), move({ unit: "bunch" }), move({ toStorageAreaId: areaA })]) await outbox.enqueueCommand("movement.log", c);
    await outbox.drain();
    const stuck = await outbox.open(["movement.log"]);
    expect(stuck).toHaveLength(3);
    for (const e of stuck) {
      expect(e.status).toBe("NEEDS_ATTENTION");
      expect(e.attention!.message.length).toBeGreaterThan(0);
      await outbox.discard(e.id);
    }
  });
});

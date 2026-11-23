import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generate } from "otplib";
import { createApiClient, type Tokens } from "../src/api/client";
import { createAuthApi } from "../src/api/auth";
import { createSession, type Snapshot } from "../src/auth/session";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../src/outbox/outbox";
import { newUuid } from "../src/outbox/uuid";
import { createWasteApi } from "../src/waste/wasteApi";
import { wasteHandlers, type WasteLogCommand } from "../src/waste/wasteCommands";
import { localDayBounds } from "../src/waste/wasteView";

/**
 * The offline queue and waste logging against a real server, with the phone's own code and no UI: log with no signal (one entry
 * edited and one deleted before they leave the phone), reconnect and send in order, see a lost reply resent without a second row,
 * change and delete an entry that is on the server, and see a location the person does not work at come back as needs-attention.
 * Needs the server on E2E_API_URL (default http://localhost:3009) and the seeded E2E user. Skipped locally without credentials;
 * fails in CI without them.
 */
const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
const totpSecret = process.env.E2E_USER_TOTP_SECRET;
const baseUrl = process.env.E2E_API_URL ?? "http://localhost:3009";

const tag = `wq${Date.now().toString(36)}-`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!process.env.CI && (!email || !password || !totpSecret))("waste queue against the real server", () => {
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
  const outbox = createOutbox({ store, send: async () => {}, handlers: wasteHandlers(client), now: () => clock, newId: () => `e${String(++seq).padStart(4, "0")}`, getUserId: () => userId });
  const api = createWasteApi(client);
  let locationId = "";

  const command = (name: string, over: Partial<WasteLogCommand> = {}): WasteLogCommand => ({ wasteLogId: newUuid(), storeLocationId: locationId, ingredientName: `${tag}${name}`, quantity: 2, unit: "kg", reason: "Spoilage", shift: "Lunch", estimatedCost: null, notes: null, loggedAt: new Date().toISOString(), ...over });
  const today = () => api.list(localDayBounds(new Date()), locationId).then((r) => r.filter((e) => e.ingredientName.startsWith(tag)));
  const created: string[] = [];

  beforeAll(async () => {
    await session.signIn(email!, password!);
    expect(session.getSnapshot().state.phase).toBe("mfa");
    await session.submitCode(await generate({ secret: totpSecret! }));
    if (session.getSnapshot().state.phase === "mfa") {
      await wait(31_000); // that code's window was already used (the other phone test signs in too)
      await session.submitCode(await generate({ secret: totpSecret! }));
    }
    const state = session.getSnapshot().state;
    expect(state.phase).toBe("ready");
    if (state.phase === "ready") userId = state.user.userId;
    locationId = (await authApi.locationContext()).selectedLocationId!;
  });

  afterAll(async () => {
    airplane = false;
    for (const id of created) await client.request("DELETE", `/api/waste/${id}`).catch(() => {});
    for (const e of await today().catch(() => [])) await client.request("DELETE", `/api/waste/${e.wasteLogId}`).catch(() => {});
  });

  it("logs with no signal: saved on the phone, nothing on the server, and an entry edited or deleted before it leaves the phone is sent once, in its final form", async () => {
    airplane = true;
    const kept = command("kept");
    const edited = command("edited");
    const withdrawn = command("withdrawn");
    created.push(kept.wasteLogId, edited.wasteLogId, withdrawn.wasteLogId);
    for (const c of [kept, edited, withdrawn]) await outbox.enqueueCommand("waste.log", c);
    await outbox.enqueueCommand("waste.edit", { wasteLogId: edited.wasteLogId, label: "edited", changes: { quantity: 7.5, reason: null } });
    expect(await outbox.enqueueCommand("waste.delete", { wasteLogId: withdrawn.wasteLogId, label: "withdrawn" })).toBeNull();

    const first = await outbox.drain();
    expect(first.sent).toBe(0);
    expect(first.nextWakeAt).not.toBeNull();
    expect((await outbox.open(["waste.log"])).length).toBe(2);

    airplane = false;
    clock += 10 * 60_000; // past any backoff
    expect((await outbox.drain()).sent).toBe(2);
    const onServer = await today();
    expect(onServer.map((e) => e.ingredientName).sort()).toEqual([`${tag}edited`, `${tag}kept`]);
    expect(onServer.find((e) => e.wasteLogId === edited.wasteLogId)).toMatchObject({ quantity: 7.5, reason: null, unit: "kg" });
    expect(onServer.find((e) => e.wasteLogId === kept.wasteLogId)).toMatchObject({ quantity: 2, reason: "Spoilage", shift: "Lunch" });
    // (The list leaves each row's location out, but it was asked for this location only, so these entries landed there.)
  });

  it("a send whose reply was lost is sent again and finds the same row: still one entry, and the server says 200, not 201", async () => {
    const c = command("replay");
    created.push(c.wasteLogId);
    await outbox.enqueueCommand("waste.log", c);
    await outbox.drain();
    const body = { wasteLogId: c.wasteLogId, storeLocationId: c.storeLocationId, ingredientName: c.ingredientName, quantity: c.quantity, unit: c.unit, loggedAt: c.loggedAt };
    // The same request again, as a resend after a lost reply: nothing new, no error.
    await client.request("POST", "/api/waste", { body });
    expect((await today()).filter((e) => e.wasteLogId === c.wasteLogId)).toHaveLength(1);
    const raw = await fetch(`${baseUrl}/api/waste`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens!.accessToken}` }, body: JSON.stringify(body) });
    expect(raw.status).toBe(200);
  });

  it("changes an entry that is on the server, then deletes it; a repeat of the delete is still success", async () => {
    const c = command("changed");
    created.push(c.wasteLogId);
    await outbox.enqueueCommand("waste.log", c);
    await outbox.drain();
    await outbox.enqueueCommand("waste.edit", { wasteLogId: c.wasteLogId, label: "changed", changes: { quantity: 9, notes: "off" } });
    await outbox.drain();
    expect((await today()).find((e) => e.wasteLogId === c.wasteLogId)).toMatchObject({ quantity: 9, notes: "off" });

    await outbox.enqueueCommand("waste.delete", { wasteLogId: c.wasteLogId, label: "changed" });
    await outbox.drain();
    expect((await today()).some((e) => e.wasteLogId === c.wasteLogId)).toBe(false);
    await outbox.enqueueCommand("waste.delete", { wasteLogId: c.wasteLogId, label: "changed" });
    await outbox.drain();
    expect((await outbox.open(["waste.delete"]))).toEqual([]); // the repeat was accepted, not stuck
  });

  it("an entry for a location the person does not work at is refused and kept on the phone with the server's words", async () => {
    const c = command("elsewhere", { storeLocationId: newUuid() });
    await outbox.enqueueCommand("waste.log", c);
    await outbox.drain();
    const [stuck] = await outbox.open(["waste.log"]);
    expect(stuck).toMatchObject({ status: "NEEDS_ATTENTION", attention: { reason: expect.stringMatching(/no_access|rejected/) } });
    expect(stuck.attention!.message.length).toBeGreaterThan(0);
    await outbox.discard(stuck.id);
    expect(await outbox.open(["waste.log"])).toEqual([]);
  });
});

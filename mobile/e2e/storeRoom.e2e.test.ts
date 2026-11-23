import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generate } from "otplib";
import { createApiClient, type Tokens } from "../src/api/client";
import { createAuthApi } from "../src/api/auth";
import { createSession, type Snapshot } from "../src/auth/session";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../src/outbox/outbox";
import { newUuid } from "../src/outbox/uuid";
import { createTransferApi } from "../src/transfers/transferApi";
import { TRANSFER_CANCEL, TRANSFER_CREATE, TRANSFER_RECEIVE, TRANSFER_SEND, transferHandlers, type TransferCreateCommand } from "../src/transfers/transferCommands";
import { CATALOG_REQUEST, catalogRequestHandlers, type CatalogRequestCommand } from "../src/stock/catalogRequestCommands";
import { createStockApi } from "../src/stock/stockApi";

/**
 * Transfers and catalogue requests through the offline queue against a real server, with the phone's own code and no UI: make and send a
 * transfer with no signal, reconnect and see it sent once (a lost reply resent finds the same transfer, a second send counts as done),
 * receive it at the other location with a short line (and a replayed receive counts as done because it was this person's), cancel one
 * that never left the phone (the server never hears of it) and one that did, see a send after a cancel stay visible, and ask for a new
 * item twice under one id (one request). Then read the dashboard, the item list and an item's stock everywhere through the phone's schemas.
 * Needs the server on E2E_API_URL (default http://localhost:3009) and the seeded E2E user (an Administrator). Skipped locally without
 * credentials; fails in CI without them.
 */
const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
const totpSecret = process.env.E2E_USER_TOTP_SECRET;
const baseUrl = process.env.E2E_API_URL ?? "http://localhost:3009";

const tag = `sr${Date.now().toString(36)}-`;
const API = "/api/inventory";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!process.env.CI && (!email || !password || !totpSecret))("transfers and catalogue requests against the real server", () => {
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
  const outbox = createOutbox({ store, send: async () => {}, handlers: [...transferHandlers(client), ...catalogRequestHandlers(client)], now: () => clock, newId: () => `e${String(++seq).padStart(4, "0")}`, getUserId: () => userId });
  const transfers = createTransferApi(client);
  const stock = createStockApi(client);
  let here = "";
  let there = "";
  let gin = ""; // an item in litres
  const cleanups: Array<() => Promise<unknown>> = [];
  const drain = async () => {
    clock += 10 * 60_000; // past any backoff
    return outbox.drain();
  };
  const entry = (id: string) => [...rows.values()].find((e) => { const c = e.command as unknown as { transferId?: string; requestId?: string }; return c.transferId === id || c.requestId === id; });
  const create = (over: Partial<TransferCreateCommand> = {}): TransferCreateCommand => ({ transferId: newUuid(), fromLocationId: here, fromLocationName: "Here", toLocationId: there, toLocationName: `${tag}Bar`, lines: [{ ingredientId: gin, ingredientName: `${tag}gin`, sentQty: 4, sentUnit: "L" }], notes: tag, createdAt: new Date().toISOString(), ...over });
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
    const ctx = await authApi.locationContext();
    here = ctx.selectedLocationId!;

    // A manager (the web) sets up a second location and an item.
    const made = await client.request<{ storeLocation: { storeLocationId: string } }>("POST", "/api/store-locations", { body: { organisationId: ctx.organisationId, locationName: `${tag}Bar`, classification: "branch" } });
    there = made.storeLocation.storeLocationId;
    cleanups.push(() => client.request("POST", `/api/store-locations/${there}/deactivate`));
    gin = (await client.request<{ ingredientId: string }>("POST", `${API}/ingredients`, { body: { ingredientName: `${tag}gin`, ingredientCategory: "spirits", baseUnit: "L", unitCost: "30.00" } })).ingredientId;
    cleanups.push(() => client.request("DELETE", `${API}/ingredients/${gin}`));
    // In use here: the location's item list holds only items active there (a receive makes it active at the other end).
    await client.request("POST", `${API}/locations/${here}/activate-items`, { body: { ingredientIds: [gin] } });
  });

  afterAll(async () => {
    airplane = false;
    for (const undo of cleanups.reverse()) await undo().catch(() => {});
  });

  it("makes and sends a transfer with no signal: nothing on the server until it reconnects, then one transfer, sent once", async () => {
    airplane = true;
    const c = create();
    await outbox.enqueueCommand(TRANSFER_CREATE, c);
    await outbox.enqueueCommand(TRANSFER_SEND, { transferId: c.transferId, label: "Here to Bar" });
    expect((await outbox.drain()).sent).toBe(0);

    airplane = false;
    expect((await drain()).sent).toBe(2);
    const stored = await transfers.detail(c.transferId);
    expect(stored).toMatchObject({ status: "SENT", fromLocationId: here, toLocationId: there, notes: tag });
    expect(stored.lines).toEqual([expect.objectContaining({ ingredientId: gin, sentQty: 4, sentUnit: "L", receivedQty: null })]);
    expect((await transfers.list(here)).filter((t) => t.transferId === c.transferId)).toHaveLength(1);
    expect((await transfers.pending(there)).map((t) => t.transferId)).toContain(c.transferId);

    // A reply that was lost: the create is sent again and finds the same transfer (200, not a second one); a second send counts as done.
    const body = { transferId: c.transferId, fromLocationId: here, toLocationId: there, lines: [{ ingredientId: gin, sentQty: 4, sentUnit: "L" }] };
    expect((await post(`${API}/transfers`, body)).status).toBe(200);
    await outbox.enqueueCommand(TRANSFER_SEND, { transferId: c.transferId, label: "Here to Bar" });
    await drain();
    expect([...rows.values()].filter((e) => e.type === TRANSFER_SEND).map((e) => e.status)).toEqual(["ACCEPTED", "ACCEPTED"]);
  });

  it("receives at the other location with a short line; a receive sent again counts as done because it was this person's", async () => {
    const [sent] = (await transfers.pending(there)).filter((t) => t.notes === tag);
    const detail = await transfers.detail(sent.transferId);
    const receive = { transferId: sent.transferId, label: "Here to Bar", userId: userId!, receivedLines: [{ lineId: detail.lines[0].lineId, receivedQty: 3.5 }], hasDifference: true };
    await outbox.enqueueCommand(TRANSFER_RECEIVE, receive);
    await drain();
    const received = await transfers.detail(sent.transferId);
    expect(received).toMatchObject({ status: "DISCREPANCY", receivedByUserId: userId });
    expect(received.lines[0]).toMatchObject({ receivedQty: 3.5, lineStatus: "DISCREPANCY" });

    await outbox.enqueueCommand(TRANSFER_RECEIVE, receive);
    await drain();
    expect([...rows.values()].filter((e) => e.type === TRANSFER_RECEIVE).map((e) => e.status)).toEqual(["ACCEPTED", "ACCEPTED"]);
  });

  it("cancels a transfer that never left the phone without telling the server, and one on the server; a send after the cancel stays visible", async () => {
    airplane = true;
    const unsent = create();
    await outbox.enqueueCommand(TRANSFER_CREATE, unsent);
    expect(await outbox.enqueueCommand(TRANSFER_CANCEL, { transferId: unsent.transferId, label: "Here to Bar" })).toBeNull();
    airplane = false;
    await drain();
    await expect(transfers.detail(unsent.transferId)).rejects.toMatchObject({ status: 404 });

    const kept = create();
    await outbox.enqueueCommand(TRANSFER_CREATE, kept);
    await drain(); // on the server now, so the cancel goes after it rather than folding it away
    await outbox.enqueueCommand(TRANSFER_CANCEL, { transferId: kept.transferId, label: "Here to Bar" });
    await drain();
    expect((await transfers.detail(kept.transferId)).status).toBe("CANCELLED");
    await outbox.enqueueCommand(TRANSFER_SEND, { transferId: kept.transferId, label: "Here to Bar" });
    await drain();
    const refused = [...rows.values()].find((e) => e.type === TRANSFER_SEND && (e.command as unknown as { transferId: string }).transferId === kept.transferId);
    expect(refused).toMatchObject({ status: "NEEDS_ATTENTION", attention: { reason: "rejected" } });
    expect(refused!.attention!.message).toMatch(/CANCELLED/);
  });

  it("asks for a new item once, even when the request is sent twice", async () => {
    const ask: CatalogRequestCommand = { requestId: newUuid(), storeLocationId: here, itemName: `${tag}yuzu`, itemType: "KITCHEN_INGREDIENT", category: "beverages", baseUnit: "L", countedQty: 2, requestedAt: new Date().toISOString() };
    airplane = true;
    await outbox.enqueueCommand(CATALOG_REQUEST, ask);
    expect((await outbox.drain()).sent).toBe(0);
    airplane = false;
    await drain();
    expect(entry(ask.requestId)).toMatchObject({ status: "ACCEPTED" });
    expect((await post(`${API}/catalog-requests`, { requestId: ask.requestId, storeLocationId: here, itemName: ask.itemName })).status).toBe(200);
    const pending = await client.request<Array<{ requestId: string; itemName: string; countedQty: string }>>("GET", `${API}/catalog-requests/pending`);
    expect(pending.filter((r) => r.itemName === ask.itemName)).toEqual([expect.objectContaining({ requestId: ask.requestId })]);
    cleanups.push(() => client.request("POST", `${API}/catalog-requests/${ask.requestId}/reject`, { body: { reason: "e2e cleanup" } }));
  });

  it("reads the dashboard, the item list and an item's stock everywhere through the phone's schemas", async () => {
    const dashboard = await stock.dashboard(here);
    expect(dashboard.stockSummary).toEqual(expect.objectContaining({ lowIngredientIds: expect.any(Array), criticalIngredientIds: expect.any(Array) }));
    expect(typeof dashboard.stockSummary.stockValue).toBe("number"); // the E2E user is an Administrator, so holds inventory:cost
    const items = await stock.items(here);
    expect(items.find((i) => i.ingredientId === gin)).toMatchObject({ ingredientName: `${tag}gin`, baseUnit: "L", currentQty: -4 }); // sent 4 with none on the books
    expect((await stock.items(there)).find((i) => i.ingredientId === gin)).toMatchObject({ activeInd: true, currentQty: 3.5 }); // receiving put it in use there
    const everywhere = await stock.elsewhere(gin);
    expect(everywhere.find((l) => l.storeLocationId === there)).toMatchObject({ currentQty: 3.5 });
    expect(await stock.assignments(here)).toEqual(expect.any(Object));
  });
});

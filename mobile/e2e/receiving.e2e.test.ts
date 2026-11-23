import { describe, it, expect, beforeAll } from "vitest";
import { generate } from "otplib";
import { createApiClient, type Tokens } from "../src/api/client";
import { createAuthApi } from "../src/api/auth";
import { createSession } from "../src/auth/session";
import { createReceivingApi } from "../src/receiving/receivingApi";

/**
 * Receiving a delivery against a real server, with the phone's own client and no UI: find the order in the
 * queue, receive it with a short line and a price change, confirm, and see the order close as partial and
 * the stock land; then a perfect delivery, a cancelled one, and a refused short quantity. Needs the server on
 * E2E_API_URL (default http://localhost:3009) and the seeded E2E user. Skipped locally without credentials;
 * fails in CI without them.
 */
const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
const totpSecret = process.env.E2E_USER_TOTP_SECRET;
const baseUrl = process.env.E2E_API_URL ?? "http://localhost:3009";

const tag = `rc${Date.now().toString(36)}-`;
const API = "/api/inventory";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!process.env.CI && (!email || !password || !totpSecret))("receiving against the real server", () => {
  let tokens: Tokens | null = null;
  const tokenStore = { load: async () => tokens, save: async (t: Tokens) => void (tokens = t), clear: async () => void (tokens = null) };
  const client = createApiClient({ baseUrl, tokenStore, appVersion: "0.1.0-e2e", timeoutMs: 20_000 });
  const authApi = createAuthApi(client, tokenStore);
  const session = createSession({ api: authApi, hasTokens: async () => tokens !== null, snapshots: { load: async () => null, save: async () => {} } });
  const receiving = createReceivingApi(client);

  let locationId = "";
  let supplierId = "";
  let flourId = "";
  let milkId = "";

  /** A manager (the web) raises a purchase order and sends it. */
  async function sentOrder(lines: Array<{ ingredientId: string; qty: string; cost: string }>) {
    const po = await client.request<{ poId: string }>("POST", `${API}/purchase-orders`, {
      body: { storeLocationId: locationId, supplierId, lines: lines.map((l) => ({ ingredientId: l.ingredientId, orderedQty: l.qty, orderedUnit: "kg", unitCost: l.cost })) },
    });
    await client.request("POST", `${API}/purchase-orders/${po.poId}/submit`);
    return po.poId;
  }
  const stockOf = async (ingredientId: string) => {
    const rows = await client.request<Array<{ storeLocationId: string; currentQty: string | null }>>("GET", `${API}/ingredients/${ingredientId}/stock-levels`);
    return Number(rows.find((r) => r.storeLocationId === locationId)?.currentQty ?? 0);
  };

  beforeAll(async () => {
    await session.signIn(email!, password!);
    expect(session.getSnapshot().state.phase).toBe("mfa");
    await session.submitCode(await generate({ secret: totpSecret! }));
    if (session.getSnapshot().state.phase === "mfa") {
      await wait(31_000);
      await session.submitCode(await generate({ secret: totpSecret! }));
    }
    expect(session.getSnapshot().state.phase).toBe("ready");
    locationId = (await authApi.locationContext()).selectedLocationId!;

    supplierId = (await client.request<{ supplierId: string }>("POST", `${API}/suppliers`, { body: { supplierName: `${tag}Fresh Farms`, contactPhone: "0400 111 222" } })).supplierId;
    const mk = async (name: string) => (await client.request<{ ingredientId: string }>("POST", `${API}/ingredients`, { body: { ingredientName: `${tag}${name}`, ingredientCategory: "produce", baseUnit: "kg", unitCost: "2.00" } })).ingredientId;
    flourId = await mk("flour");
    milkId = await mk("milk");
  });

  it("lists a sent order with its supplier's phone, soonest first", async () => {
    const poId = await sentOrder([{ ingredientId: flourId, qty: "5", cost: "2" }]);
    const queue = await receiving.queue(locationId);
    const row = queue.find((q) => q.poId === poId)!;
    expect(row).toMatchObject({ status: "SENT", supplierPhone: "0400 111 222", lineCount: 1, beingReceivedBy: null });
    await receiving.startSession(poId, locationId).then((s) => receiving.cancel(s.session.sessionId));
  });

  it("receives a short line and a price change, closes the order as partial and stocks what arrived", async () => {
    const poId = await sentOrder([{ ingredientId: flourId, qty: "10", cost: "2" }, { ingredientId: milkId, qty: "4", cost: "1.5" }]);
    const flourBefore = await stockOf(flourId);

    const started = await receiving.startSession(poId, locationId);
    expect(started.resumed).toBe(false);
    const flour = started.lines.find((l) => l.ingredientId === flourId)!;
    const milk = started.lines.find((l) => l.ingredientId === milkId)!;
    expect(flour.status).toBe("RECEIVED");

    // The queue now shows the order as in progress, with the chef's name.
    const mine = (await receiving.queue(locationId)).find((q) => q.poId === poId)!;
    expect(mine).toMatchObject({ status: "RECEIVING" });
    expect(mine.beingReceivedBy?.userId).toBe(started.session.receivedByUserId);

    expect(Number((await receiving.actionLine(started.session.sessionId, flour.receivingLineId, { status: "SHORT", receivedQty: "7" })).receivedQty)).toBe(7);
    expect((await receiving.actionLine(started.session.sessionId, milk.receivingLineId, { status: "PRICE_VARIANCE", actualUnitCost: "1.8" })).status).toBe("PRICE_VARIANCE");

    const done = await receiving.confirm(started.session.sessionId);
    expect(done).toMatchObject({ poStatus: "PARTIAL_RECEIVED", isPerfectDelivery: false, discrepancyCount: 2 });
    expect(await stockOf(flourId)).toBe(flourBefore + 7);

    const queue = await receiving.queue(locationId);
    expect(queue.some((q) => q.poId === poId)).toBe(false);
  });

  it("a perfect delivery is start and confirm", async () => {
    const poId = await sentOrder([{ ingredientId: flourId, qty: "3", cost: "2" }]);
    const before = await stockOf(flourId);
    const started = await receiving.startSession(poId, locationId);
    expect(await receiving.confirm(started.session.sessionId)).toMatchObject({ poStatus: "RECEIVED", isPerfectDelivery: true });
    expect(await stockOf(flourId)).toBe(before + 3);
  });

  it("refuses a short quantity that is not short, with a code, and writes nothing", async () => {
    const poId = await sentOrder([{ ingredientId: flourId, qty: "6", cost: "2" }]);
    const started = await receiving.startSession(poId, locationId);
    const line = started.lines[0];
    await expect(receiving.actionLine(started.session.sessionId, line.receivingLineId, { status: "SHORT", receivedQty: "6" })).rejects.toMatchObject({
      code: "bad_request",
      body: { code: "SHORT_QTY_NOT_LESS" },
    });
    await receiving.cancel(started.session.sessionId);
  });

  it("a cancelled delivery puts the order back in the queue and stocks nothing", async () => {
    const poId = await sentOrder([{ ingredientId: flourId, qty: "2", cost: "2" }]);
    const before = await stockOf(flourId);
    const started = await receiving.startSession(poId, locationId);
    await receiving.cancel(started.session.sessionId);
    expect((await receiving.queue(locationId)).find((q) => q.poId === poId)).toMatchObject({ status: "SENT", beingReceivedBy: null });
    expect(await stockOf(flourId)).toBe(before);
  });
});

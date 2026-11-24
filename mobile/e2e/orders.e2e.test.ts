import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generate } from "otplib";
import { ApiError, createApiClient, type Tokens } from "../src/api/client";
import { createAuthApi } from "../src/api/auth";
import { createSession } from "../src/auth/session";
import { newUuid } from "../src/outbox/uuid";
import { createOrders, type OrdersCtx } from "../src/orders/orders";
import { createOrdersApi, type OrdersApi } from "../src/orders/ordersApi";
import { orderActions } from "../src/orders/orderView";
import { createReceivingApi } from "../src/receiving/receivingApi";
import type { KvStore } from "../src/storage/kv";

/**
 * Purchasing against a real server, with the phone's own client, lists and order form and no UI: write an order (by hand and from a guide),
 * submit it, have a large one wait for approval, approve and reject, receive a short delivery and credit it, reorder. A repeated save, approval
 * and credit note never act twice. Same server and user as `receiving.e2e.test.ts`.
 */
const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
const totpSecret = process.env.E2E_USER_TOTP_SECRET;
const baseUrl = process.env.E2E_API_URL ?? "http://localhost:3009";

const tag = `po${Date.now().toString(36)}-`;
const API = "/api/inventory";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!process.env.CI && (!email || !password || !totpSecret))("orders against the real server", () => {
  let tokens: Tokens | null = null;
  const tokenStore = { load: async () => tokens, save: async (t: Tokens) => void (tokens = t), clear: async () => void (tokens = null) };
  const client = createApiClient({ baseUrl, tokenStore, appVersion: "0.1.0-e2e", timeoutMs: 20_000 });
  const authApi = createAuthApi(client, tokenStore);
  const session = createSession({ api: authApi, hasTokens: async () => tokens !== null, snapshots: { load: async () => null, save: async () => {} } });
  const api = createOrdersApi(client);
  const receiving = createReceivingApi(client);
  const kv = (): KvStore => {
    const data = new Map<string, string>();
    return { get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
  };

  let locationId = "";
  let supplierId = "";
  let flourId = "";
  let ctx: OrdersCtx;
  const user = () => {
    const s = session.getSnapshot().state;
    if (s.phase !== "ready") throw new Error("not signed in");
    return s.user;
  };
  const orders = (over: Partial<OrdersApi> = {}) => createOrders({ api: { ...api, ...over }, kv: kv(), user: user(), locationId, now: () => new Date().toISOString() });

  /** The order form, filled in by hand: one line of flour. */
  async function written(qty: string, over: Partial<OrdersApi> = {}) {
    const { draft } = orders(over);
    await draft.load();
    draft.chooseSupplier(draft.getSnapshot().suppliers.find((s) => s.supplierId === supplierId)!);
    await wait(300); // the supplier's item list
    draft.add(flourId);
    draft.setLine({ ...draft.getSnapshot().draft.lines[0], qty });
    draft.update({ notes: `${tag}note`, expectedDate: "2030-05-06" });
    return draft;
  }
  const saved = async (qty: string, submit: boolean) => {
    const out = await (await written(qty)).save(submit);
    expect(out?.notSubmitted).toBeNull();
    return out!.poId;
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
    flourId = (
      await client.request<{ ingredientId: string }>("POST", `${API}/ingredients`, { body: { ingredientName: `${tag}flour`, ingredientCategory: "produce", baseUnit: "kg", unitCost: "1.40", purchaseUnit: "bag", packQty: "12.5", parLevel: "25" } })
    ).ingredientId;
    await client.request("POST", `${API}/locations/${locationId}/activate-items`, { body: { ingredientIds: [flourId] } });
    // Orders of $100 or more at this location need approval; put back in afterAll.
    await client.request("PUT", `${API}/thresholds/location`, { body: { storeLocationId: locationId, amount: 100 } });
    ctx = orders();
  });
  afterAll(async () => {
    if (locationId) await client.request("DELETE", `${API}/thresholds/location/${locationId}`).catch(() => undefined);
  });

  it("writes an order in bags at the bag price, saves it as a draft and lists it", async () => {
    const poId = await saved("2", false);
    const order = await api.detail(poId);
    expect(order).toMatchObject({ status: "DRAFT", supplierName: `${tag}Fresh Farms`, notes: `${tag}note`, totalValue: null });
    expect(order.expectedDeliveryDate).toMatch(/^2030-05-06T00:00/);
    expect(order.lines[0]).toMatchObject({ orderedQty: 2, orderedUnit: "bag", unitCost: 17.5 });
    const drafts = ctx.list("Draft");
    await drafts.refresh();
    expect(drafts.getSnapshot().items.find((o) => o.poId === poId)).toMatchObject({ lineCount: 1 });
    await api.cancel(poId);
    expect((await api.detail(poId)).status).toBe("CANCELLED");
  });

  it("a save whose reply was lost, saved again, is one order; changed first, that order is brought up to date", async () => {
    const before = (await api.list(locationId, ["DRAFT"])).length;
    let drop = true;
    const draft = await written("1", {
      create: async (body) => {
        const made = await api.create(body);
        if (drop) throw new ApiError("timeout");
        return made;
      },
    });
    expect(await draft.save(false)).toBeNull();
    drop = false;
    const again = await draft.save(false);
    expect(again?.notSubmitted).toBeNull();
    expect(await api.list(locationId, ["DRAFT"])).toHaveLength(before + 1);
    await api.cancel(again!.poId);

    drop = true;
    const changed = await written("1", { create: async (body) => { const made = await api.create(body); if (drop) throw new ApiError("timeout"); return made; } });
    expect(await changed.save(false)).toBeNull();
    drop = false;
    changed.setLine({ ...changed.getSnapshot().draft.lines[0], qty: "3" });
    const out = await changed.save(false);
    expect((await api.detail(out!.poId)).lines[0].orderedQty).toBe(3);
    expect(await api.list(locationId, ["DRAFT"])).toHaveLength(before + 1);
    await api.cancel(out!.poId);
  });

  it("a saved draft is changed, and a sent order refuses it with a code", async () => {
    const poId = await saved("2", false);
    const edit = ctx.editDraft(poId);
    await edit.load();
    expect(edit.getSnapshot().draft).toMatchObject({ expectedDate: "2030-05-06", notes: `${tag}note`, lines: [{ qty: "2", unit: "bag", cost: "17.5" }] });
    edit.setLine({ ...edit.getSnapshot().draft.lines[0], qty: "4" });
    edit.update({ notes: "", expectedDate: "2030-05-07" });
    expect(await edit.save(false)).toEqual({ poId, notSubmitted: null });
    const order = await api.detail(poId);
    expect(order).toMatchObject({ status: "DRAFT", notes: null });
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({ orderedQty: 4, unitCost: 17.5 });
    expect(order.expectedDeliveryDate).toMatch(/^2030-05-07T00:00/);
    await api.submit(poId);
    expect(await edit.save(false)).toBeNull();
    expect(edit.getSnapshot().saveError).toBe("This order is no longer a draft, so it can't be changed.");
    await api.cancel(poId);
  });

  it("a small order goes straight to sent; submitting it again is refused as already moved on", async () => {
    const poId = await saved("2", true);
    const order = await api.detail(poId);
    expect(order).toMatchObject({ status: "SENT", totalValue: 35 });
    await expect(api.submit(poId)).rejects.toMatchObject({ serverCode: "INVALID_STATE" });
    expect(orderActions(order, ctx.rights, Date.now())).toMatchObject({ receive: true, submit: false, cancel: false });
    await api.cancel(poId);
  });

  it("a large order waits for approval and is in the queue; approving it once sends it, twice is refused", async () => {
    const poId = await saved("10", true);
    await ctx.approvals.refresh();
    const row = ctx.approvals.getSnapshot().items.find((o) => o.poId === poId)!;
    // The only approver in their organisation may approve their own order.
    expect(row).toMatchObject({ status: "PENDING_APPROVAL", totalValue: 175, canApprove: true });
    expect(row.submittedAt).not.toBeNull();
    await api.approve(poId);
    await expect(api.approve(poId)).rejects.toMatchObject({ serverCode: "INVALID_STATE" });
    expect((await api.detail(poId)).status).toBe("SENT");
    await api.cancel(poId);
  });

  it("a rejected order is back in draft with the reason", async () => {
    const poId = await saved("10", true);
    await api.reject(poId, "Too much flour");
    expect(await api.detail(poId)).toMatchObject({ status: "DRAFT", rejectedReason: "Too much flour" });
    await api.cancel(poId);
  });

  it("a guide fills the order to par in whole bags", async () => {
    const guide = await client.request<{ orderGuideId: string }>("POST", `${API}/locations/${locationId}/order-guides`, { body: { name: `${tag}Weekly`, supplierId } });
    await client.request("PUT", `${API}/order-guides/${guide.orderGuideId}/items`, { body: { items: [{ ingredientId: flourId }] } });
    const { draft } = orders();
    await draft.load();
    await draft.applyGuide(draft.getSnapshot().guides.find((g) => g.orderGuideId === guide.orderGuideId)!);
    expect(draft.getSnapshot().draft).toMatchObject({ supplierId, lines: [{ ingredientId: flourId, qty: "2", unit: "bag", cost: "17.5" }] });
    await client.request("DELETE", `${API}/order-guides/${guide.orderGuideId}`);
  });

  it("a short delivery can be credited once, for no more than it is worth, and is linked to its order", async () => {
    const poId = await saved("2", true);
    const started = await receiving.startSession(poId, locationId);
    expect((await api.detail(poId)).beingReceivedBy?.userId).toBe(user().userId);
    await receiving.actionLine(started.session.sessionId, started.lines[0].receivingLineId, { status: "SHORT", receivedQty: "1" });
    await receiving.confirm(started.session.sessionId);

    const order = await api.detail(poId);
    expect(order).toMatchObject({ status: "PARTIAL_RECEIVED" });
    expect(order.lines[0]).toMatchObject({ receivedQty: 1, lineStatus: "SHORT" });
    expect(order.lines[0].receivedDttm).not.toBeNull();

    const found = (await api.discrepancies(0, supplierId)).find((d) => d.poId === poId)!;
    expect(found).toMatchObject({ type: "SHORT", shortageQty: 1, maxCreditAmount: 17.5 });
    const body = { creditNoteId: newUuid(), discrepancyId: found.discrepancyId, creditAmount: 17.5, creditReference: `${tag}CN` };
    await expect(api.credit({ ...body, creditAmount: 17.51 })).rejects.toMatchObject({ serverCode: "CREDIT_EXCEEDS_DISCREPANCY" });
    const note = await api.credit(body);
    expect((await api.credit(body)).creditNoteId).toBe(note.creditNoteId); // a repeat after a lost reply
    await expect(api.credit({ ...body, creditNoteId: newUuid() })).rejects.toMatchObject({ serverCode: "ALREADY_CREDITED" });
    expect((await api.discrepancies(0, supplierId)).some((d) => d.poId === poId)).toBe(false);
    expect((await api.creditNotes()).find((n) => n.creditNoteId === note.creditNoteId)).toMatchObject({ creditAmount: 17.5, creditReference: `${tag}CN` });
  });

  it("a supplier who does not take email is answered, not an error", async () => {
    const poId = await saved("2", true);
    const reply = await api.email(poId);
    expect(reply.emailed).toBe(false);
    expect(reply.message).toBeTruthy();
    await api.cancel(poId);
  });

  it("a received order is ordered again into a new draft", async () => {
    const poId = await saved("1", true);
    const started = await receiving.startSession(poId, locationId);
    await receiving.confirm(started.session.sessionId);
    const copy = await api.clone(poId, locationId);
    expect(await api.detail(copy.poId)).toMatchObject({ status: "DRAFT", supplierId });
    await api.cancel(copy.poId);
  });
});

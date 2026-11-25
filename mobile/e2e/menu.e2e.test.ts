import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generate } from "otplib";
import { createApiClient, type Tokens } from "../src/api/client";
import { createAuthApi } from "../src/api/auth";
import { createSession, type Snapshot } from "../src/auth/session";
import { newUuid } from "../src/outbox/uuid";
import { createMenuApi } from "../src/menu/menuApi";
import { blankLine, checkDraft, draftCosts, draftOf, emptyDraft, pickInto, saveMenuItem, saveSession, type CheckedDraft, type MenuDraft } from "../src/menu/menuEditor";
import { createMenuStore } from "../src/menu/menuStore";
import { costsOf } from "../src/menu/menuView";

/**
 * The menu against a real server, with the phone's own code and no UI: build an item linked to a catalogue ingredient (a create whose reply is
 * lost is found, not repeated), see the server store what the preview showed, change one line and the price, record a sale whose reply is lost
 * and send it again (one sale, stock taken once), void it, set a category target, and be refused deleting an item with sales history.
 * Needs the server on E2E_API_URL (default http://localhost:3009) and the seeded E2E user (an Administrator). Skipped locally without
 * credentials; fails in CI without them.
 */
const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
const totpSecret = process.env.E2E_USER_TOTP_SECRET;
const baseUrl = process.env.E2E_API_URL ?? "http://localhost:3009";

const tag = `mn${Date.now().toString(36)}-`;
const INV = "/api/inventory";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!process.env.CI && (!email || !password || !totpSecret))("the menu against the real server", () => {
  let tokens: Tokens | null = null;
  /** The next request whose path matches reaches the server, and its reply is lost. */
  let loseReplyTo: RegExp | null = null;
  const tokenStore = { load: async () => tokens, save: async (t: Tokens) => void (tokens = t), clear: async () => void (tokens = null) };
  const lossyFetch: typeof fetch = async (input, init) => {
    const reply = await fetch(input, init);
    if (init?.method === "POST" && loseReplyTo?.test(String(input))) {
      loseReplyTo = null;
      throw new TypeError("Network request failed");
    }
    return reply;
  };
  const client = createApiClient({ baseUrl, tokenStore, appVersion: "0.1.0-e2e", fetchFn: lossyFetch, timeoutMs: 20_000 });
  const authApi = createAuthApi(client, tokenStore);
  let snapshot: Snapshot | null = null;
  const session = createSession({ api: authApi, hasTokens: async () => tokens !== null, snapshots: { load: async () => snapshot, save: async (s) => void (snapshot = s) } });
  const api = createMenuApi(client);
  const kvMap = new Map<string, string>();
  const kv = { get: async (k: string) => kvMap.get(k) ?? null, set: async (k: string, v: string) => void kvMap.set(k, v), delete: async (k: string) => void kvMap.delete(k) };
  let store: ReturnType<typeof createMenuStore>;
  let userId = 0;
  let here = "";
  let flour = "";
  let itemId = "";
  const cleanups: Array<() => Promise<unknown>> = [];
  const checked = (d: MenuDraft): CheckedDraft => {
    const c = checkDraft(d);
    if ("error" in c) throw new Error(c.error);
    return c;
  };
  const onHand = async () => {
    const { stockLevels } = await client.request<{ stockLevels: { ingredientId: string; currentQty: string }[] }>("GET", `${INV}/locations/${here}/dashboard`);
    return Number(stockLevels.find((l) => l.ingredientId === flour)?.currentQty ?? 0);
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
    here = (await authApi.locationContext()).selectedLocationId!;
    flour = (await client.request<{ ingredientId: string }>("POST", `${INV}/ingredients`, { body: { ingredientName: `${tag}flour`, ingredientCategory: "dry_goods", baseUnit: "kg", unitCost: "2.00" } })).ingredientId;
    cleanups.push(() => client.request("DELETE", `${INV}/ingredients/${flour}`));
    await client.request("POST", `${INV}/locations/${here}/activate-items`, { body: { ingredientIds: [flour] } });
    store = createMenuStore({ api, kv, userId, locationId: here, canSeeCost: true, now: Date.now, newId: newUuid });
  });

  afterAll(async () => {
    loseReplyTo = null;
    for (const undo of cleanups.reverse()) await undo().catch(() => {});
  });

  it("builds an item with a linked line; a create whose reply was lost is found, not made twice; the server stores what the preview showed", async () => {
    const item = (await api.catalogue()).find((i) => i.ingredientId === flour)!;
    const draft: MenuDraft = { ...emptyDraft(), name: `${tag}focaccia`, category: `${tag}Breads`, sellingPrice: "8", servings: "2", qFactorPct: "10", lines: [{ ...pickInto(blankLine(), item), quantity: "500", unit: "g" }] };
    const open = saveSession();
    loseReplyTo = /\/api\/menu\/items$/;
    await expect(saveMenuItem(api, open, checked(draft), userId)).rejects.toMatchObject({ code: "network" });
    itemId = await saveMenuItem(api, open, checked(draft), userId);

    await store.refresh();
    const mine = store.getSnapshot().items.filter((i) => i.name === draft.name);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ menuItemId: itemId, canManage: true, servings: 2, qFactorPct: 10 });
    const preview = draftCosts(draft, () => []);
    expect(costsOf(mine[0])).toEqual({ foodCost: Number(preview.foodCostPerSale.toFixed(2)), foodCostPct: Number(preview.foodCostPct.toFixed(2)), margin: Number(preview.contributionMargin.toFixed(2)) });
    await store.loadLines(itemId);
    expect(store.getSnapshot().lines[itemId]).toEqual([expect.objectContaining({ ingredientId: flour, quantity: 500, unit: "g", unitCost: 2, lineCost: 1, baseUnit: "kg" })]);
  });

  it("changes the price and one line; a line reply that was lost is not added twice", async () => {
    const item = (await api.items()).find((i) => i.menuItemId === itemId)!;
    const lines = await api.lines(itemId);
    const draft = draftOf(item, lines);
    draft.sellingPrice = "9,50";
    draft.lines[0].quantity = "600";
    draft.lines.push({ ...blankLine(), ingredientName: `${tag}salt`, quantity: "0.01", unit: "kg" });
    const open = saveSession(item, lines);
    loseReplyTo = /\/ingredients$/;
    await expect(saveMenuItem(api, open, checked(draft), userId)).rejects.toMatchObject({ code: "network" });
    await saveMenuItem(api, open, checked(draft), userId);
    const after = await api.lines(itemId);
    expect(after.map((l) => [l.ingredientName, l.quantity])).toEqual([[`${tag}flour`, 600], [`${tag}salt`, 0.01]]);
    expect((await api.items()).find((i) => i.menuItemId === itemId)).toMatchObject({ sellingPrice: 9.5 });
  });

  it("records a sale once when its reply is lost and it is sent again, and voids it", async () => {
    const before = await onHand();
    loseReplyTo = /\/sales$/;
    await expect(store.sell({ kind: "dish", id: itemId, name: "focaccia" }, 3)).rejects.toMatchObject({ code: "network" });
    expect(store.getSnapshot().pendingSale).not.toBeNull();
    await expect(store.retrySale()).resolves.toMatchObject({ alreadyExists: true, voided: false });
    expect(store.getSnapshot().pendingSale).toBeNull();
    expect(before - (await onHand())).toBeCloseTo(0.9, 5); // 600 g makes 2, 3 sold
    const sold = (await store.sales()).filter((s) => s.menuItemName === `${tag}focaccia`);
    expect(sold).toEqual([expect.objectContaining({ qtySold: 3, voidedAt: null, canManage: true })]);

    await store.voidSale(sold[0].saleId);
    await store.voidSale(sold[0].saleId); // a second void counts as done
    expect(before - (await onHand())).toBeCloseTo(0, 5);
    expect((await store.sales()).find((s) => s.saleId === sold[0].saleId)?.voidedAt).toBeTruthy();
  });

  it("sets a category's target, and is refused deleting an item with sales history in the server's words", async () => {
    await store.setTarget(`${tag}Breads`, "28.5");
    expect((await api.targets())[`${tag}Breads`]).toBe(28.5);
    await expect(store.remove(itemId)).rejects.toMatchObject({ status: 409, serverCode: "CONFLICT" });
    expect((await api.items()).some((i) => i.menuItemId === itemId)).toBe(true);
  });

  it("deletes an item nobody has sold, and counts one already gone as deleted", async () => {
    const { menuItemId } = await api.create({ name: `${tag}spare`, category: `${tag}Breads`, sellingPrice: "1.00", servings: 1, servingsPerSale: 1, qFactorPct: "0" });
    await store.remove(menuItemId);
    await store.remove(menuItemId);
    expect((await api.items()).some((i) => i.menuItemId === menuItemId)).toBe(false);
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { conversation, guestSession, message, recipe, user } from "../db/schema.js";

// A bearer token here is just the payload as JSON; the real signature check is covered by the auth suites.
vi.mock("../services/authService.js", async (orig) => ({
  ...(await orig<object>()),
  verifyAccessToken: (token: string) => {
    const payload = JSON.parse(token);
    if (!payload.sub) throw new Error("bad token");
    return payload;
  },
}));
const streamChat = vi.fn();
vi.mock("../services/aiService.js", async (orig) => ({ ...(await orig<object>()), streamChat: (...a: unknown[]) => streamChat(...a) }));
const generateRecipe = vi.fn();
vi.mock("../services/recipeService.js", async (orig) => ({ ...(await orig<object>()), generateRecipe: (...a: unknown[]) => generateRecipe(...a) }));
const sendRecipeEmail = vi.fn().mockResolvedValue({ sent: true });
vi.mock("../services/emailService.js", async (orig) => ({ ...(await orig<object>()), sendRecipeEmail: (...a: unknown[]) => sendRecipeEmail(...a) }));
vi.mock("../services/brainCaptureService.js", () => ({ recordOpsEvent: vi.fn(), recordChatTurn: vi.fn() }));

const { chatRouter } = await import("./chat.js");
const { recipesRouter } = await import("./recipes.js");
const { conversationsRouter } = await import("./conversations.js");
const { errorHandler } = await import("../middleware/errorHandler.js");

/**
 * The routes the phone will call for chat, recipes and conversations, through the real routers, middleware and
 * database: what an anonymous caller, a guest, a signed-in user and a stranger each get, what a session costs,
 * and what a limit answers. Model calls and mail are stubbed. Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

const tag = `w6_${Date.now().toString(36)}`;
let server: Server;
let owner: number;
let stranger: number;
const guests: string[] = [];
const recipeIds: string[] = [];
const conversationIds: string[] = [];

const asUser = (sub: number) => ({ authorization: `Bearer ${JSON.stringify({ sub, roles: [], permissions: [] })}` });
const asGuest = (token: string) => ({ "x-guest-token": token });

async function call(method: string, path: string, headers: Record<string, string> = {}, body?: object) {
  const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { json = JSON.parse(text); } catch { /* a stream */ }
  return { status: res.status, text, body: json };
}
/** The charge is made after the answer has gone out, so a test waits for it (or, to prove there is none, for long enough). */
const chargedTo = (read: () => Promise<number>, expected: number) => vi.waitFor(async () => expect(await read()).toBe(expected));
const settle = () => new Promise((r) => setTimeout(r, 150));
const freeOf = async (id: number) => (await db.select({ n: user.freeSessions }).from(user).where(eq(user.userId, id)))[0].n;
const usedOf = async (token: string) => (await db.select({ n: guestSession.sessionsUsed }).from(guestSession).where(eq(guestSession.sessionToken, token)))[0].n;
async function makeUser(freeSessions = 5) {
  const [{ id }] = await db.insert(user).values({ userName: tag, userEmail: `${tag}-${Math.random().toString(36).slice(2)}@it.test`, freeSessions }).returning({ id: user.userId });
  return id;
}
async function makeGuest(sessionsUsed = 0) {
  const token = randomUUID();
  guests.push(token);
  await db.insert(guestSession).values({ sessionToken: token, sessionsUsed });
  return token;
}
async function makeRecipe(over: Partial<typeof recipe.$inferInsert> = {}) {
  const [{ id }] = await db.insert(recipe).values({ title: `${tag} dish`, recipeData: { name: "dish" }, kitchenContext: "private profile", ...over }).returning({ id: recipe.recipeId });
  recipeIds.push(id);
  return id;
}
const writesText = (text: string, ok: boolean) => async (_m: unknown, res: { write: (s: string) => void; end: () => void }) => {
  res.write(`0:${JSON.stringify(text)}\n`);
  res.end();
  return ok;
};
const recipeResult = { recipe: { name: "Dish" }, imageUrl: null, recipeId: "r1", slug: "s", proseResponse: null, memories: null };

describe.skipIf(!RUN)("wave 6 server hardening, over HTTP (real DB)", () => {
  beforeAll(async () => {
    owner = await makeUser();
    stranger = await makeUser();
    const app = express();
    app.use(express.json());
    app.use("/api/chat", chatRouter);
    app.use("/api/recipes", recipesRouter);
    app.use("/api/conversations", conversationsRouter);
    app.use(errorHandler);
    server = app.listen(0);
  });
  afterAll(async () => {
    server?.close();
    if (conversationIds.length) {
      await db.delete(message).where(inArray(message.conversationId, conversationIds));
      await db.delete(conversation).where(inArray(conversation.conversationId, conversationIds));
    }
    if (recipeIds.length) await db.delete(recipe).where(inArray(recipe.recipeId, recipeIds));
    await db.delete(conversation).where(inArray(conversation.userId, [owner, stranger]));
    await db.delete(user).where(eq(user.userName, tag));
    if (guests.length) await db.delete(guestSession).where(inArray(guestSession.sessionToken, guests));
  });

  describe("POST /api/chat", () => {
    const history = { messages: [{ role: "user", content: "How long do I rest a steak?" }] };

    it("401 UNAUTHENTICATED with no credentials", async () => {
      const out = await call("POST", "/api/chat", {}, history);
      expect(out.status).toBe(401);
      expect(out.body.code).toBe("UNAUTHENTICATED");
    });

    it("400 VALIDATION for the old single-message shape, and it costs nothing", async () => {
      const out = await call("POST", "/api/chat", asUser(owner), { message: "hi" });
      expect(out.status).toBe(400);
      expect(out.body.code).toBe("VALIDATION");
      expect(typeof out.body.error).toBe("string");
      await settle();
      expect(await freeOf(owner)).toBe(5);
    });

    it("200 streams the answer, and costs one session", async () => {
      streamChat.mockImplementationOnce(writesText("Half the cook time.", true));
      const out = await call("POST", "/api/chat", asUser(owner), history);
      expect(out.status).toBe(200);
      expect(out.text).toContain("Half the cook time.");
      await chargedTo(() => freeOf(owner), 4);
    });

    it("an answer that failed costs nothing", async () => {
      streamChat.mockImplementationOnce(writesText("", false));
      await call("POST", "/api/chat", asUser(owner), history);
      await settle();
      expect(await freeOf(owner)).toBe(4);
    });

    it("a guest is charged on the guest counter, not a user's", async () => {
      const token = await makeGuest();
      streamChat.mockImplementationOnce(writesText("Rest it.", true));
      expect((await call("POST", "/api/chat", asGuest(token), history)).status).toBe(200);
      await chargedTo(() => usedOf(token), 1);
    });

    it("403 FREE_SESSIONS_EXHAUSTED for a user with none left, and the model is not called", async () => {
      const broke = await makeUser(0);
      streamChat.mockClear();
      const out = await call("POST", "/api/chat", asUser(broke), history);
      expect(out.status).toBe(403);
      expect(out.body).toMatchObject({ code: "FREE_SESSIONS_EXHAUSTED", upgradeRequired: true });
      expect(streamChat).not.toHaveBeenCalled();
    });

    it("403 GUEST_QUOTA_EXHAUSTED for a guest at the limit", async () => {
      const token = await makeGuest(10);
      const out = await call("POST", "/api/chat", asGuest(token), history);
      expect(out.status).toBe(403);
      expect(out.body).toMatchObject({ code: "GUEST_QUOTA_EXHAUSTED", registrationRequired: true });
    });
  });

  describe("POST /api/recipes/generate", () => {
    const ask = { request: "a roast chicken" };

    it("401 with no credentials", async () => {
      expect((await call("POST", "/api/recipes/generate", {}, ask)).status).toBe(401);
    });

    it("400 VALIDATION for a request too short, and it costs nothing", async () => {
      const before = await freeOf(stranger);
      const out = await call("POST", "/api/recipes/generate", asUser(stranger), { request: "x" });
      expect(out.status).toBe(400);
      expect(out.body.code).toBe("VALIDATION");
      await settle();
      expect(await freeOf(stranger)).toBe(before);
    });

    it("200 with the recipe, and it costs one session", async () => {
      generateRecipe.mockResolvedValueOnce(recipeResult);
      const before = await freeOf(stranger);
      const out = await call("POST", "/api/recipes/generate", asUser(stranger), ask);
      expect(out.status).toBe(200);
      expect(out.body.recipeId).toBe("r1");
      await chargedTo(() => freeOf(stranger), before - 1);
    });

    it("a prose fallback is 200 but costs nothing", async () => {
      generateRecipe.mockResolvedValueOnce({ ...recipeResult, recipe: null, recipeId: null, proseResponse: "Try a dish name" });
      const before = await freeOf(stranger);
      const out = await call("POST", "/api/recipes/generate", asUser(stranger), ask);
      expect(out.body.prose).toBe("Try a dish name");
      await settle();
      expect(await freeOf(stranger)).toBe(before);
    });

    it("a failure costs nothing", async () => {
      generateRecipe.mockRejectedValueOnce(new Error("boom"));
      const before = await freeOf(stranger);
      const out = await call("POST", "/api/recipes/generate", asUser(stranger), ask);
      expect([out.status, out.body.code]).toEqual([503, "AI_UNAVAILABLE"]);
      await settle();
      expect(await freeOf(stranger)).toBe(before);
    });

    it("a guest's recipe costs a guest session", async () => {
      const token = await makeGuest();
      generateRecipe.mockResolvedValueOnce(recipeResult);
      expect((await call("POST", "/api/recipes/generate", asGuest(token), ask)).status).toBe(200);
      await chargedTo(() => usedOf(token), 1);
    });

    it("429 RATE_LIMITED after ten in ten minutes, per user", async () => {
      const busy = await makeUser(100);
      generateRecipe.mockResolvedValue(recipeResult);
      for (let i = 0; i < 10; i++) expect((await call("POST", "/api/recipes/generate", asUser(busy), ask)).status).toBe(200);
      const out = await call("POST", "/api/recipes/generate", asUser(busy), ask);
      expect(out.status).toBe(429);
      expect(out.body.code).toBe("RATE_LIMITED");
      expect((await call("POST", "/api/recipes/generate", asUser(owner), ask)).status).toBe(200);
    });
  });

  describe("GET /api/recipes/:id", () => {
    it("200 for an anonymous reader of a public recipe, without the owner's id or kitchen profile", async () => {
      const id = await makeRecipe({ userId: owner, isPublicInd: true });
      const out = await call("GET", `/api/recipes/${id}`, asGuest(await makeGuest()));
      expect(out.status).toBe(200);
      expect(out.body).not.toHaveProperty("userId");
      expect(out.body).not.toHaveProperty("kitchenContext");
    });

    it("404 on a private recipe for a stranger, 200 with everything for its owner", async () => {
      const id = await makeRecipe({ userId: owner, isPublicInd: false });
      expect((await call("GET", `/api/recipes/${id}`, asUser(stranger))).status).toBe(404);
      const mine = await call("GET", `/api/recipes/${id}`, asUser(owner));
      expect(mine.status).toBe(200);
      expect(mine.body).toMatchObject({ userId: owner, kitchenContext: "private profile" });
    });

    it("401 with no credentials at all", async () => {
      expect((await call("GET", `/api/recipes/${randomUUID()}`)).status).toBe(401);
    });
  });

  describe("PATCH /api/recipes/:id", () => {
    it("403 FORBIDDEN for a guest, and a guest-made recipe stays as it was", async () => {
      const id = await makeRecipe({ userId: null, isPublicInd: true });
      const out = await call("PATCH", `/api/recipes/${id}`, asGuest(await makeGuest()), { isPublicInd: false });
      expect(out.status).toBe(403);
      expect(out.body.code).toBe("FORBIDDEN");
      expect((await db.select().from(recipe).where(eq(recipe.recipeId, id)))[0].isPublicInd).toBe(true);
    });

    it("404 NOT_FOUND for someone else's recipe, 400 for nothing to change, 200 for the owner", async () => {
      const id = await makeRecipe({ userId: owner });
      expect((await call("PATCH", `/api/recipes/${id}`, asUser(stranger), { isPublicInd: true })).body.code).toBe("NOT_FOUND");
      expect((await call("PATCH", `/api/recipes/${id}`, asUser(owner), {})).status).toBe(400);
      expect((await call("PATCH", `/api/recipes/${id}`, asUser(owner), { isPublicInd: true })).status).toBe(200);
    });
  });

  describe("GET /api/recipes/my", () => {
    it("401, then 200 filtered by domain, then 400 for a domain that does not exist", async () => {
      await makeRecipe({ userId: owner, domain: "spirits" });
      const anonymous = await call("GET", "/api/recipes/my");
      expect(anonymous.status).toBe(401);
      expect(anonymous.body.code).toBe("UNAUTHENTICATED");
      const spirits = await call("GET", "/api/recipes/my?domain=spirits", asUser(owner));
      expect(spirits.status).toBe(200);
      expect(spirits.body.recipes.every((r: { domain: string }) => r.domain === "spirits")).toBe(true);
      expect((await call("GET", "/api/recipes/my?domain=nope", asUser(owner))).status).toBe(400);
    });
  });

  describe("POST /api/recipes/:id/email", () => {
    it("400 for a bad address, 404 for a private recipe of someone else's, 200 for a public one", async () => {
      const pub = await makeRecipe({ userId: owner, isPublicInd: true });
      const priv = await makeRecipe({ userId: owner, isPublicInd: false });
      expect((await call("POST", `/api/recipes/${pub}/email`, asUser(stranger), { to: "not-an-address" })).status).toBe(400);
      expect((await call("POST", `/api/recipes/${priv}/email`, asUser(stranger), { to: "a@example.com" })).status).toBe(404);
      expect((await call("POST", `/api/recipes/${pub}/email`, asUser(stranger), { to: "a@example.com" })).status).toBe(200);
    });

    it("429 RATE_LIMITED on the fourth mail to one inbox, however it is spelled, and other inboxes are fine", async () => {
      const pub = await makeRecipe({ userId: owner, isPublicInd: true });
      const send = (to: string, who = stranger) => call("POST", `/api/recipes/${pub}/email`, asUser(who), { to });
      sendRecipeEmail.mockClear();

      expect((await send("target@example.com")).status).toBe(200);
      expect((await send("Target+one@example.com")).status).toBe(200);
      expect((await send("target+two@EXAMPLE.com")).status).toBe(200);
      const blocked = await send("target+three@example.com");
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe("RATE_LIMITED");
      expect((await send("target+four@example.com", owner)).status).toBe(429);
      expect((await send("someone-else@example.com", owner)).status).toBe(200);
      expect(sendRecipeEmail).toHaveBeenCalledTimes(4);
    });
  });

  describe("conversations", () => {
    it("201 on create, 200 on the replay, 409 CONFLICT for another account, 401 with no credentials", async () => {
      const id = randomUUID();
      conversationIds.push(id);
      const body = { id, title: "Stocks" };
      expect((await call("POST", "/api/conversations", asUser(owner), body)).status).toBe(201);
      expect((await call("POST", "/api/conversations", asUser(owner), body)).status).toBe(200);
      expect((await call("POST", "/api/conversations", asUser(stranger), body)).body.code).toBe("CONFLICT");
      expect((await call("POST", "/api/conversations", {}, body)).status).toBe(401);
    });

    it("400 VALIDATION with a text error for a create or a save that is malformed, 403 FORBIDDEN for saving into someone else's", async () => {
      const id = randomUUID();
      conversationIds.push(id);
      const create = await call("POST", "/api/conversations", asUser(owner), { id: "not-a-uuid" });
      expect([create.status, create.body.code, typeof create.body.error]).toEqual([400, "VALIDATION", "string"]);
      await call("POST", "/api/conversations", asUser(owner), { id, title: "Mine" });
      const save = await call("POST", `/api/conversations/${id}/messages`, asUser(owner), { messages: [] });
      expect([save.status, save.body.code, typeof save.body.error]).toEqual([400, "VALIDATION", "string"]);
      const messages = [{ messageId: randomUUID(), messageRole: "user", messageBody: "hi", messageSequence: 0 }];
      const intruder = await call("POST", `/api/conversations/${id}/messages`, asUser(stranger), { messages });
      expect([intruder.status, intruder.body.code]).toEqual([403, "FORBIDDEN"]);
    });

    it("200 when the same messages are saved twice", async () => {
      const id = randomUUID();
      conversationIds.push(id);
      await call("POST", "/api/conversations", asUser(owner), { id, title: "Replay" });
      const messages = [{ messageId: randomUUID(), messageRole: "user", messageBody: "hi", messageSequence: 0 }];
      expect((await call("POST", `/api/conversations/${id}/messages`, asUser(owner), { messages })).status).toBe(200);
      expect((await call("POST", `/api/conversations/${id}/messages`, asUser(owner), { messages })).status).toBe(200);
      expect((await call("GET", `/api/conversations/${id}`, asUser(owner))).body.conversation.messages).toHaveLength(1);
    });
  });
});

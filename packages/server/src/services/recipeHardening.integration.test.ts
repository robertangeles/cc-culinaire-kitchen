import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { db } from "../db/index.js";
import { conversation, message, recipe, user } from "../db/schema.js";
import { errorHandler } from "../middleware/errorHandler.js";
import type { TokenPayload } from "./authService.js";

const sendRecipeEmail = vi.fn().mockResolvedValue({ sent: true });
vi.mock("./emailService.js", async (orig) => ({ ...(await orig<object>()), sendRecipeEmail }));

const { handleGetRecipe, handleUpdateRecipe, handleMyRecipes, handleEmailRecipe } = await import("../controllers/recipeController.js");
const { handleCreateConversation, handleSaveMessages } = await import("../controllers/conversationController.js");

/**
 * Recipe and conversation routes the phone will call: what a stranger may read or change, and what a
 * retried request does. Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

interface Who { user?: TokenPayload; guestToken?: string }
const tokenFor = (sub: number): TokenPayload => ({ sub, roles: [], permissions: [] });

function call(handler: (req: Request, res: Response, next: (e?: unknown) => void) => unknown, who: Who, parts: { params?: object; body?: object; query?: object } = {}) {
  return new Promise<{ status: number; body: Record<string, any> }>((done) => {
    let status = 200;
    const res = {
      headersSent: false,
      status(code: number) { status = code; return this; },
      json(b: unknown) { done({ status, body: b as Record<string, any> }); return this; },
    } as unknown as Response;
    const next = (e?: unknown) => errorHandler(e as Error, {} as Request, res, () => {});
    const req = { user: who.user, guestToken: who.guestToken, params: parts.params ?? {}, body: parts.body ?? {}, query: parts.query ?? {} } as unknown as Request;
    Promise.resolve(handler(req, res, next)).catch(next);
  });
}

const tag = `rh_${Date.now().toString(36)}`;
let owner: number;
let other: number;
const recipeIds: string[] = [];
const conversationIds: string[] = [];

async function makeRecipe(over: Partial<typeof recipe.$inferInsert> = {}) {
  const [{ id }] = await db
    .insert(recipe)
    .values({ title: `${tag} dish`, recipeData: { name: "dish", ingredients: [], steps: [] }, kitchenContext: "Chef's private kitchen profile", ...over })
    .returning({ id: recipe.recipeId });
  recipeIds.push(id);
  return id;
}
const rowOf = async (id: string) => (await db.select().from(recipe).where(eq(recipe.recipeId, id)))[0];

describe.skipIf(!RUN)("recipe and conversation hardening (real DB)", () => {
  beforeAll(async () => {
    for (const key of ["owner", "other"]) {
      const [{ id }] = await db.insert(user).values({ userName: `RH ${key}`, userEmail: `${tag}-${key}@it.test` }).returning({ id: user.userId });
      if (key === "owner") owner = id; else other = id;
    }
  });
  afterAll(async () => {
    if (conversationIds.length) {
      await db.delete(message).where(inArray(message.conversationId, conversationIds));
      await db.delete(conversation).where(inArray(conversation.conversationId, conversationIds));
    }
    if (recipeIds.length) await db.delete(recipe).where(inArray(recipe.recipeId, recipeIds));
    await db.delete(user).where(inArray(user.userId, [owner, other]));
  });

  describe("GET /recipes/:id", () => {
    it("a stranger reading a public recipe gets no kitchenContext and no userId", async () => {
      const id = await makeRecipe({ userId: owner, isPublicInd: true });
      for (const who of [{ user: tokenFor(other) }, { guestToken: "g" }, {}]) {
        const out = await call(handleGetRecipe, who, { params: { id } });
        expect(out.status).toBe(200);
        expect(out.body.title).toBe(`${tag} dish`);
        expect(out.body).not.toHaveProperty("kitchenContext");
        expect(out.body).not.toHaveProperty("userId");
      }
    });

    it("the owner still gets both, so the web can show edit controls", async () => {
      const id = await makeRecipe({ userId: owner, isPublicInd: true });
      const out = await call(handleGetRecipe, { user: tokenFor(owner) }, { params: { id } });
      expect(out.body.userId).toBe(owner);
      expect(out.body.kitchenContext).toBe("Chef's private kitchen profile");
    });

    it("a private recipe is a 404 to everyone but its owner", async () => {
      const id = await makeRecipe({ userId: owner, isPublicInd: false });
      expect((await call(handleGetRecipe, { user: tokenFor(other) }, { params: { id } })).status).toBe(404);
    });
  });

  describe("PATCH /recipes/:id", () => {
    it("a guest cannot flip a guest-created recipe public or private", async () => {
      const id = await makeRecipe({ userId: null, isPublicInd: true });
      const out = await call(handleUpdateRecipe, { guestToken: "any-guest" }, { params: { id }, body: { isPublicInd: false } });

      expect(out.status).toBe(403);
      expect(out.body.code).toBe("FORBIDDEN");
      expect((await rowOf(id)).isPublicInd).toBe(true);
    });

    it("a signed-in user cannot flip a guest-created recipe either", async () => {
      const id = await makeRecipe({ userId: null, isPublicInd: true });
      const out = await call(handleUpdateRecipe, { user: tokenFor(other) }, { params: { id }, body: { isPublicInd: false } });

      expect(out.status).toBe(404);
      expect((await rowOf(id)).isPublicInd).toBe(true);
    });

    it("the owner can still flip their own", async () => {
      const id = await makeRecipe({ userId: owner, isPublicInd: false });
      const out = await call(handleUpdateRecipe, { user: tokenFor(owner) }, { params: { id }, body: { isPublicInd: true } });

      expect(out.status).toBe(200);
      expect((await rowOf(id)).isPublicInd).toBe(true);
    });
  });

  describe("GET /recipes/my", () => {
    it("honours the domain parameter", async () => {
      await makeRecipe({ userId: owner, domain: "recipe" });
      const spirits = await makeRecipe({ userId: owner, domain: "spirits" });

      const out = await call(handleMyRecipes, { user: tokenFor(owner) }, { query: { domain: "spirits" } });

      expect(out.status).toBe(200);
      expect(out.body.recipes.map((r: { recipeId: string }) => r.recipeId)).toEqual([spirits]);
      expect(out.body.total).toBe(1);
    });

    it("rejects a domain it does not know with 400 VALIDATION", async () => {
      const out = await call(handleMyRecipes, { user: tokenFor(owner) }, { query: { domain: "x'; drop table recipe;--" } });
      expect(out.status).toBe(400);
      expect(out.body.code).toBe("VALIDATION");
    });
  });

  describe("POST /recipes/:id/email", () => {
    it("will not send a private recipe for someone who does not own it", async () => {
      sendRecipeEmail.mockClear();
      const id = await makeRecipe({ userId: owner, isPublicInd: false });
      const out = await call(handleEmailRecipe, { user: tokenFor(other) }, { params: { id }, body: { to: "friend@example.com" } });

      expect(out.status).toBe(404);
      expect(sendRecipeEmail).not.toHaveBeenCalled();
    });

    it("sends a public recipe, with the recipe's own data and the address asked for", async () => {
      sendRecipeEmail.mockClear();
      const id = await makeRecipe({ userId: owner, isPublicInd: true });
      const out = await call(handleEmailRecipe, { user: tokenFor(other) }, { params: { id }, body: { to: "friend@example.com" } });

      expect(out.status).toBe(200);
      expect(sendRecipeEmail).toHaveBeenCalledWith("friend@example.com", expect.anything(), null, null, id);
    });

    it("a mail failure is a 502 EMAIL_FAILED, not a bare 500", async () => {
      sendRecipeEmail.mockResolvedValueOnce({ sent: false, error: "provider down" });
      const id = await makeRecipe({ userId: owner, isPublicInd: true });
      const out = await call(handleEmailRecipe, { user: tokenFor(owner) }, { params: { id }, body: { to: "friend@example.com" } });

      expect(out.status).toBe(502);
      expect(out.body.code).toBe("EMAIL_FAILED");
    });
  });

  describe("conversation replays", () => {
    it("creating the same conversation twice answers both with success and stores one row", async () => {
      const id = randomUUID();
      conversationIds.push(id);
      const send = () => call(handleCreateConversation, { user: tokenFor(owner) }, { body: { id, title: "Stocks" } });

      expect((await send()).status).toBe(201);
      const again = await send();
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ success: true, conversationId: id });
      expect(await db.select().from(conversation).where(eq(conversation.conversationId, id))).toHaveLength(1);
    });

    it("creating an id that another account holds is 409 CONFLICT and leaves their conversation alone", async () => {
      const id = randomUUID();
      conversationIds.push(id);
      await call(handleCreateConversation, { user: tokenFor(owner) }, { body: { id, title: "Mine" } });
      const out = await call(handleCreateConversation, { user: tokenFor(other) }, { body: { id, title: "Yours now" } });

      expect(out.status).toBe(409);
      expect(out.body.code).toBe("CONFLICT");
      expect((await db.select().from(conversation).where(eq(conversation.conversationId, id)))[0].conversationTitle).toBe("Mine");
    });

    it("a guest replaying their own create is a success too", async () => {
      const id = randomUUID();
      conversationIds.push(id);
      await call(handleCreateConversation, { guestToken: "guest-a" }, { body: { id, title: "Hi" } });
      expect((await call(handleCreateConversation, { guestToken: "guest-a" }, { body: { id, title: "Hi" } })).status).toBe(200);
      expect((await call(handleCreateConversation, { guestToken: "guest-b" }, { body: { id, title: "Hi" } })).status).toBe(409);
    });

    it("saving the same messages twice stores them once and answers success", async () => {
      const id = randomUUID();
      conversationIds.push(id);
      await call(handleCreateConversation, { user: tokenFor(owner) }, { body: { id, title: "Replay" } });
      const messages = [
        { messageId: randomUUID(), messageRole: "user", messageBody: "How long do I rest a steak?", messageSequence: 0 },
        { messageId: randomUUID(), messageRole: "assistant", messageBody: "Half the cook time.", messageSequence: 1 },
      ];
      const save = (msgs: typeof messages) => call(handleSaveMessages, { user: tokenFor(owner) }, { params: { id }, body: { messages: msgs } });

      expect((await save(messages)).status).toBe(200);
      const again = await save(messages);
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ success: true });
      expect(await db.select().from(message).where(eq(message.conversationId, id))).toHaveLength(2);
    });

    it("a replay with one new message adds only the new one", async () => {
      const id = randomUUID();
      conversationIds.push(id);
      await call(handleCreateConversation, { user: tokenFor(owner) }, { body: { id, title: "Partial" } });
      const first = { messageId: randomUUID(), messageRole: "user", messageBody: "a", messageSequence: 0 };
      const second = { messageId: randomUUID(), messageRole: "assistant", messageBody: "b", messageSequence: 1 };
      await call(handleSaveMessages, { user: tokenFor(owner) }, { params: { id }, body: { messages: [first] } });
      await call(handleSaveMessages, { user: tokenFor(owner) }, { params: { id }, body: { messages: [first, second] } });

      expect(await db.select().from(message).where(eq(message.conversationId, id))).toHaveLength(2);
    });
  });
});

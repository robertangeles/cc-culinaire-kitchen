import { describe, it, expect, beforeAll, inject } from "vitest";
import { ApiError, createApiClient, type Tokens } from "../src/api/client";
import { createAuthApi } from "../src/api/auth";
import { createSession, type Snapshot } from "../src/auth/session";
import { createChatApi } from "../src/chat/chatApi";
import { createRecipeApi } from "../src/recipes/recipeApi";
import { newUuid } from "../src/outbox/uuid";

/**
 * Saved conversations and My Recipes through the phone's own client against a real server: the parts that need no model, so the
 * run spends nothing. A conversation saved twice (a retried save after a lost reply) is stored once; the phone's recipe reads parse;
 * and the refusals the screens branch on carry the server's code. Needs the server on E2E_API_URL (default http://localhost:3009)
 * and the seeded E2E user. Skipped locally without credentials; fails in CI without them.
 */
const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
const totpSecret = process.env.E2E_USER_TOTP_SECRET;
const baseUrl = process.env.E2E_API_URL ?? "http://localhost:3009";

async function refusal(p: Promise<unknown>): Promise<ApiError> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

describe.skipIf(!process.env.CI && (!email || !password || !totpSecret))("chat conversations and my recipes against the real server", () => {
  let tokens = inject("phoneTokens");
  const tokenStore = { load: async () => tokens, save: async (t: Tokens) => void (tokens = t), clear: async () => void (tokens = null) };
  const client = createApiClient({ baseUrl, tokenStore, appVersion: "0.1.0-e2e", timeoutMs: 20_000 });
  const authApi = createAuthApi(client, tokenStore);
  let snapshot: Snapshot | null = null;
  const session = createSession({ api: authApi, hasTokens: async () => tokens !== null, snapshots: { load: async () => snapshot, save: async (s) => void (snapshot = s) } });
  const chat = createChatApi(client);
  const recipes = createRecipeApi(client);

  beforeAll(async () => {
    await session.restore();
    expect(session.getSnapshot().state.phase).toBe("ready");
  });

  it("saves a conversation once however often the save is repeated, lists and opens it, then deletes it", async () => {
    const id = newUuid();
    const messages = [
      { messageId: newUuid(), messageRole: "user" as const, messageBody: "How do I crisp fish skin?", messageSequence: 0 },
      { messageId: newUuid(), messageRole: "assistant" as const, messageBody: "Dry it, salt it late, press it flat.", messageSequence: 1 },
    ];
    await chat.create(id, "Fish skin");
    await chat.create(id, "Fish skin");
    await chat.save(id, messages);
    await chat.save(id, messages);
    await chat.save(id, [...messages, { messageId: newUuid(), messageRole: "user", messageBody: "And scallops?", messageSequence: 2 }]);
    try {
      expect((await chat.list()).find((c) => c.conversationId === id)?.conversationTitle).toBe("Fish skin");
      const detail = await chat.get(id);
      expect(detail.messages.map((m) => m.messageBody)).toEqual(["How do I crisp fish skin?", "Dry it, salt it late, press it flat.", "And scallops?"]);
    } finally {
      await chat.remove(id);
    }
    expect((await chat.list()).some((c) => c.conversationId === id)).toBe(false);
  });

  it("reads My Recipes in each lab, and refuses an unknown recipe with its code", async () => {
    for (const domain of [undefined, "recipe", "patisserie", "spirits"] as const) {
      const page = await recipes.mine(1, domain);
      expect(page.page).toBe(1);
      expect(page.total).toBeGreaterThanOrEqual(page.recipes.length);
    }
    const err = await refusal(recipes.get(newUuid()));
    expect(err.status).toBe(404);
    expect(err.hasCode("NOT_FOUND")).toBe(true);
  });

  it("refuses a request the server will not take before any model is called, with VALIDATION", async () => {
    const tooShort = await refusal(recipes.generate({ request: "ab", servings: 4 }, new AbortController().signal));
    expect(tooShort.status).toBe(400);
    expect(tooShort.hasCode("VALIDATION")).toBe(true);
  });

  it("answers a signed-out phone with UNAUTHENTICATED, which the chat and recipe screens show as signed out", async () => {
    const signedOut = createApiClient({ baseUrl, tokenStore: { load: async () => ({ accessToken: "not-a-token", refreshToken: "nope" }), save: async () => {}, clear: async () => {} }, appVersion: "0.1.0-e2e" });
    const err = await refusal(createRecipeApi(signedOut).mine(1));
    expect(err.code).toBe("unauthorized");
  });
});

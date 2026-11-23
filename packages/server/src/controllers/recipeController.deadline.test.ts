import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { Request, Response } from "express";

/**
 * Generate, refine and image regeneration stop when the client hangs up or the time runs out, and report
 * whether they produced something worth a session. All I/O is mocked.
 */
const generateRecipe = vi.fn();
vi.mock("../services/recipeService.js", () => ({ generateRecipe: (...a: unknown[]) => generateRecipe(...a), RECIPE_DOMAINS: ["recipe", "patisserie", "spirits"] }));
vi.mock("../services/userContextService.js", () => ({ buildContextString: vi.fn(async () => "") }));
vi.mock("../services/activeOrgService.js", () => ({ resolveActiveOrg: vi.fn(async () => null) }));
const refineRecipe = vi.fn();
vi.mock("../services/recipeRefinementService.js", () => ({ refineRecipe: (...a: unknown[]) => refineRecipe(...a) }));
const getRecipe = vi.fn();
vi.mock("../services/recipePersistenceService.js", () => ({ getRecipe: (...a: unknown[]) => getRecipe(...a) }));
const generateImage = vi.fn();
vi.mock("../services/imageService.js", () => ({ generateImage: (...a: unknown[]) => generateImage(...a) }));
vi.mock("../services/brainCaptureService.js", () => ({ recordOpsEvent: vi.fn() }));
vi.mock("../services/emailService.js", () => ({ sendRecipeEmail: vi.fn() }));
vi.mock("../services/orgContextService.js", () => ({ getUserOrgContext: vi.fn() }));

const updates: unknown[] = [];
const rows = [{ recipeId: "r1", userId: 5, title: "Dish", imagePrompt: "a dish", recipeData: {} }];
vi.mock("../db/index.js", () => {
  const select = { from: () => select, where: () => select, limit: async () => rows };
  return { db: { select: () => select, update: () => ({ set: (v: unknown) => ({ where: async () => updates.push(v) }) }) } };
});

const {
  recipeHandler,
  handleRefineRecipe,
  handleRegenerateImage,
  handleMyRecipes,
  handleGetRecipe,
  handleUpdateRecipe,
  handleEmailRecipe,
} = await import("./recipeController.js");

function reqRes(over: Partial<Request> = {}) {
  const res = Object.assign(new EventEmitter(), {
    writableFinished: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }) as unknown as Response & EventEmitter;
  const req = { user: { sub: 5 }, body: { request: "a dish", instruction: "less salt" }, params: { id: "r1" }, ...over } as unknown as Request;
  return { req, res, next: vi.fn() };
}

/** A model call that never answers by itself and rejects when the signal fires. */
const hangsUntilAborted = (signalOf: (args: unknown[]) => AbortSignal) => (...args: unknown[]) =>
  new Promise((_resolve, reject) => {
    const signal = signalOf(args);
    signal.addEventListener("abort", () => reject(signal.reason));
  });

afterEach(() => vi.useRealTimers());

describe("recipeHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updates.length = 0;
  });

  it("gives generateRecipe a signal, sends the recipe, and says a session was earned", async () => {
    generateRecipe.mockResolvedValue({ recipe: { name: "Dish" }, imageUrl: null, recipeId: "r1", slug: "s", proseResponse: null, memories: null });
    const { req, res, next } = reqRes();

    expect(await recipeHandler("recipe")(req, res, next)).toBe(true);
    expect(generateRecipe.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("a prose fallback (every attempt failed) is sent but earns no session", async () => {
    generateRecipe.mockResolvedValue({ recipe: null, imageUrl: null, recipeId: null, slug: null, proseResponse: "Try asking for a dish", memories: null });
    const { req, res, next } = reqRes();

    expect(await recipeHandler("recipe")(req, res, next)).toBe(false);
    expect(res.json).toHaveBeenCalledWith({ prose: "Try asking for a dish" });
  });

  it("a client that hangs up gets nothing sent, and no session is earned", async () => {
    generateRecipe.mockImplementation(hangsUntilAborted((a) => (a[0] as { signal: AbortSignal }).signal));
    const { req, res, next } = reqRes();

    const done = recipeHandler("recipe")(req, res, next);
    await new Promise((r) => setImmediate(r));
    res.emit("close");

    expect(await done).toBe(false);
    expect(res.json).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("a generation that outlasts the time limit is a 504 AI_TIMEOUT, and earns no session", async () => {
    vi.useFakeTimers();
    generateRecipe.mockImplementation(hangsUntilAborted((a) => (a[0] as { signal: AbortSignal }).signal));
    const { req, res, next } = reqRes();

    const done = recipeHandler("recipe")(req, res, next);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(await done).toBe(false);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 504, code: "AI_TIMEOUT" }));
  });

  it("any other failure goes to the error handler, and earns no session", async () => {
    const boom = new Error("boom");
    generateRecipe.mockRejectedValue(boom);
    const { req, res, next } = reqRes();

    expect(await recipeHandler("recipe")(req, res, next)).toBe(false);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 503, code: "AI_UNAVAILABLE" }));
  });

  it("a malformed request is a 400 and earns no session", async () => {
    const { req, res, next } = reqRes({ body: { request: "x" } });
    expect(await recipeHandler("recipe")(req, res, next)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(generateRecipe).not.toHaveBeenCalled();
  });
});

describe("every refusal carries a code a phone can branch on", () => {
  const mine = { userId: 5, isPublicInd: false, recipeData: {} };
  const theirs = { userId: 6, isPublicInd: false, recipeData: {} };
  const noUser = { user: undefined } as Partial<Request>;
  const generate: typeof handleGetRecipe = async (req, res, next) => void (await recipeHandler("recipe")(req, res, next));

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => void rows.splice(0, rows.length, { recipeId: "r1", userId: 5, title: "Dish", imagePrompt: "a dish", recipeData: {} }));

  it.each([
    ["generate, request too short", generate, { body: { request: "x" } }, mine, 400, "VALIDATION"],
    ["my recipes, not signed in", handleMyRecipes, { ...noUser, query: {} }, mine, 401, "UNAUTHENTICATED"],
    ["get, no such recipe", handleGetRecipe, {}, null, 404, "NOT_FOUND"],
    ["get, someone else's private recipe", handleGetRecipe, {}, theirs, 404, "NOT_FOUND"],
    ["update, nothing to change", handleUpdateRecipe, { body: {} }, mine, 400, "VALIDATION"],
    ["refine, not signed in", handleRefineRecipe, noUser, mine, 401, "UNAUTHENTICATED"],
    ["refine, instruction too short", handleRefineRecipe, { body: { instruction: "x" } }, mine, 400, "VALIDATION"],
    ["refine, someone else's recipe", handleRefineRecipe, {}, theirs, 404, "NOT_FOUND"],
    ["email, not an address", handleEmailRecipe, { body: { to: "nope" } }, mine, 400, "VALIDATION"],
    ["email, no such recipe", handleEmailRecipe, { body: { to: "a@example.com" } }, null, 404, "NOT_FOUND"],
    ["email, someone else's private recipe", handleEmailRecipe, { body: { to: "a@example.com" } }, theirs, 404, "NOT_FOUND"],
  ] as const)("%s", async (_name, handler, over, stored, status, code) => {
    getRecipe.mockResolvedValue(stored);
    const { req, res, next } = reqRes(over as Partial<Request>);

    await handler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String), code }));
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ["regenerate image, no such recipe", [], 404, "NOT_FOUND"],
    ["regenerate image, someone else's recipe", [{ recipeId: "r1", userId: 6, title: "Dish", imagePrompt: "a dish", recipeData: {} }], 403, "FORBIDDEN"],
    ["regenerate image, recipe with no image prompt", [{ recipeId: "r1", userId: 5, title: "Dish", imagePrompt: "", recipeData: {} }], 400, "INVALID_STATE"],
  ] as const)("%s", async (_name, stored, status, code) => {
    rows.splice(0, rows.length, ...stored);
    const { req, res, next } = reqRes();

    await handleRegenerateImage(req, res, next);

    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String), code }));
    expect(generateImage).not.toHaveBeenCalled();
  });
});

describe("a model provider failure is a 503 AI_UNAVAILABLE that never repeats the provider's words", () => {
  const providerError = new Error("401 Unauthorized: invalid API key sk-live-123");

  beforeEach(() => {
    vi.clearAllMocks();
    getRecipe.mockResolvedValue({ userId: 5, recipeData: { name: "Dish" }, kitchenContext: null });
  });

  it.each([
    ["refine", handleRefineRecipe, refineRecipe],
    ["regenerate image", handleRegenerateImage, generateImage],
  ] as const)("%s", async (_name, handler, model) => {
    model.mockRejectedValue(providerError);
    const { req, res, next } = reqRes();

    await handler(req, res, next);

    const sent = next.mock.calls[0][0] as Error;
    expect(sent).toMatchObject({ statusCode: 503, code: "AI_UNAVAILABLE" });
    expect(sent.message).not.toMatch(/key|sk-live|401/i);
    expect(res.json).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });
});

describe("handleRefineRecipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecipe.mockResolvedValue({ userId: 5, recipeData: { name: "Dish" }, kitchenContext: null });
  });

  it("hands refineRecipe a signal, and sends nothing to a client that left", async () => {
    refineRecipe.mockImplementation(hangsUntilAborted((a) => a[5] as AbortSignal));
    const { req, res, next } = reqRes();

    const done = handleRefineRecipe(req, res, next);
    await new Promise((r) => setImmediate(r));
    res.emit("close");
    await done;

    expect(refineRecipe.mock.calls[0][5]).toBeInstanceOf(AbortSignal);
    expect(res.json).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("answers 504 AI_TIMEOUT when the time runs out", async () => {
    vi.useFakeTimers();
    refineRecipe.mockImplementation(hangsUntilAborted((a) => a[5] as AbortSignal));
    const { req, res, next } = reqRes();

    const done = handleRefineRecipe(req, res, next);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    await done;

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 504, code: "AI_TIMEOUT" }));
  });
});

describe("handleRegenerateImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updates.length = 0;
  });

  it("does not replace the stored image when the client left while it was being made", async () => {
    const { req, res, next } = reqRes();
    generateImage.mockImplementation(async () => {
      res.emit("close");
      return { url: "/uploads/new.png" };
    });

    await handleRegenerateImage(req, res, next);

    expect(generateImage.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    expect(updates).toEqual([]);
    expect(res.json).not.toHaveBeenCalled();
  });

  it("stores and returns the new image when the client waited", async () => {
    const { req, res, next } = reqRes();
    generateImage.mockResolvedValue({ url: "/uploads/new.png" });

    await handleRegenerateImage(req, res, next);

    expect(updates).toEqual([{ imageUrl: "/uploads/new.png" }]);
    expect(res.json).toHaveBeenCalledWith({ imageUrl: "/uploads/new.png" });
  });
});

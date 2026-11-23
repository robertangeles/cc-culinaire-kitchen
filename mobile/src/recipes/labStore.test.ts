import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { RecipeSummary } from "@culinaire/shared/schemas/recipe";
import type { RecipeApi, RecipeRequest } from "./recipeApi";
import { createLabStore } from "./labStore";

const row = (recipeId: string): RecipeSummary => ({ recipeId, slug: null, title: recipeId, description: null, domain: "recipe", imageUrl: null, isPublicInd: false, createdDttm: "" });
const form: RecipeRequest = { request: "Chicken braise", servings: 4 };

function setup() {
  let shelf = [row("old")];
  let finish: ((v: unknown) => void) | null = null;
  let fail: ((e: unknown) => void) | null = null;
  const signals: AbortSignal[] = [];
  const api = {
    mine: vi.fn(async () => ({ recipes: shelf, total: shelf.length, page: 1 })),
    generate: vi.fn((_body: RecipeRequest, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
        signal.addEventListener("abort", () => reject(new ApiError("aborted")), { once: true });
      });
    }),
  } as unknown as RecipeApi & { mine: ReturnType<typeof vi.fn>; generate: ReturnType<typeof vi.fn> };
  const store = createLabStore({ api, now: () => 1000 });
  return {
    store,
    api,
    signals,
    shelve: (...ids: string[]) => void (shelf = [...ids.map(row), ...shelf]),
    finish: (v: unknown) => finish!(v),
    fail: (e: unknown) => fail!(e),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("recipe lab store", () => {
  it("sends the form and hands over the saved recipe", async () => {
    const t = setup();
    const done = t.store.generate(form);
    await flush();
    expect(t.store.getSnapshot()).toMatchObject({ phase: "generating", startedAt: 1000 });
    expect(t.api.generate).toHaveBeenCalledWith(form, expect.anything());
    t.finish({ recipe: {}, recipeId: "r1", imageUrl: null });
    await done;
    expect(t.store.getSnapshot()).toMatchObject({ phase: "made", made: { recipeId: "r1", recovered: false } });
  });

  it("shows a prose answer (nothing saved, nothing charged)", async () => {
    const t = setup();
    const done = t.store.generate(form);
    await flush();
    t.finish({ prose: "That is a drink, try the Cocktail Lab." });
    await done;
    expect(t.store.getSnapshot()).toMatchObject({ phase: "prose", prose: "That is a drink, try the Cocktail Lab." });
  });

  it("ignores a second press while it works", async () => {
    const t = setup();
    void t.store.generate(form);
    await flush();
    await t.store.generate(form);
    expect(t.api.generate).toHaveBeenCalledTimes(1);
  });

  it("stop ends the request; the server saves nothing, and the form says so", async () => {
    const t = setup();
    const done = t.store.generate(form);
    await flush();
    t.store.stop();
    await done;
    expect(t.signals[0].aborted).toBe(true);
    expect(t.store.getSnapshot()).toMatchObject({ phase: "form", note: "Stopped. Nothing was saved." });
  });

  it("a lost reply after the server saved the recipe opens that recipe instead of making a second one", async () => {
    const t = setup();
    const done = t.store.generate(form);
    await flush();
    t.shelve("r-new");
    t.fail(new ApiError("network"));
    await done;
    expect(t.store.getSnapshot()).toMatchObject({ phase: "made", made: { recipeId: "r-new", recovered: true } });
  });

  it("a lost reply with nothing saved offers to try again, which starts over", async () => {
    const t = setup();
    const done = t.store.generate(form);
    await flush();
    t.fail(new ApiError("timeout"));
    await done;
    expect(t.store.getSnapshot()).toMatchObject({ phase: "failed", failure: { message: "That took too long. Nothing was saved. Try again.", canRetry: true } });
    const again = t.store.retry();
    await flush();
    expect(t.api.generate).toHaveBeenCalledTimes(2);
    t.finish({ recipe: {}, recipeId: "r2", imageUrl: null });
    await again;
    expect(t.store.getSnapshot().made).toEqual({ recipeId: "r2", recovered: false });
  });

  it.each([
    [new ApiError("rate_limited", "x", 429, undefined, "RATE_LIMITED"), "You've made a lot of recipes in a short time. Wait a few minutes, then try again.", true],
    [new ApiError("server", "x", 503, undefined, "AI_UNAVAILABLE"), "Recipe generation isn't available right now. Nothing was saved. Try again in a few minutes.", true],
    [new ApiError("server", "x", 504, undefined, "AI_TIMEOUT"), "That took too long. Nothing was saved. Try again.", true],
    [new ApiError("forbidden", "x", 403, undefined, "FREE_SESSIONS_EXHAUSTED"), "You've used all your free sessions.", false],
    [new ApiError("unauthorized", "x", 401, undefined, "UNAUTHENTICATED"), "You've been signed out. Sign in again to make recipes.", false],
    [new ApiError("bad_request", "Request is too short.", 400, undefined, "VALIDATION"), "Request is too short.", false],
  ])("a coded refusal (%s) is shown plainly and needs no shelf check", async (err, message, canRetry) => {
    const t = setup();
    const done = t.store.generate(form);
    await flush();
    t.api.mine.mockClear();
    t.fail(err);
    await done;
    expect(t.store.getSnapshot()).toMatchObject({ phase: "failed", failure: { message, canRetry } });
    expect(t.api.mine).not.toHaveBeenCalled();
  });

  it("without a first look at the shelf (no signal) a lost reply is a plain failure", async () => {
    const t = setup();
    t.api.mine.mockRejectedValueOnce(new ApiError("network"));
    const done = t.store.generate(form);
    await flush();
    t.fail(new ApiError("network"));
    await done;
    expect(t.store.getSnapshot()).toMatchObject({ phase: "failed", failure: { canRetry: true } });
  });

  it("reset clears a result for the next recipe", async () => {
    const t = setup();
    const done = t.store.generate(form);
    await flush();
    t.finish({ prose: "x" });
    await done;
    t.store.reset();
    expect(t.store.getSnapshot()).toMatchObject({ phase: "form", prose: null, made: null, note: null });
  });
});

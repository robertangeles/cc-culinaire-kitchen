import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { RecipeSummary } from "@culinaire/shared/schemas/recipe";
import type { RecipeApi, RecipeRequest } from "./recipeApi";
import { createLabStore } from "./labStore";

const row = (recipeId: string): RecipeSummary => ({ recipeId, slug: null, title: recipeId, description: null, domain: "recipe", imageUrl: null, isPublicInd: false, createdDttm: "" });
const form: RecipeRequest = { request: "Chicken braise", servings: 4 };

// The server stops a generation at 150 s (PR 215); the phone treats 160 s after sending as past that.
const PAST_SERVER_LIMIT = 161_000;

function setup(now: () => number = () => 1000) {
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
  const store = createLabStore({ api, now });
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

afterEach(() => void vi.useRealTimers());

describe("recipe lab store", () => {
  it("sends the form and hands over the saved recipe", async () => {
    const t = setup();
    const done = t.store.generate(form);
    await flush();
    expect(t.store.getSnapshot()).toMatchObject({ phase: "generating", startedAt: 1000 });
    expect(t.api.generate).toHaveBeenCalledWith(form, expect.anything());
    t.finish({ recipe: {}, recipeId: "r1", imageUrl: null });
    await done;
    expect(t.store.getSnapshot()).toMatchObject({ phase: "made", made: { recipeId: "r1", grounded: [] } });
  });

  it("keeps the titles of the kitchen notes the recipe drew on", async () => {
    const t = setup();
    const done = t.store.generate(form);
    await flush();
    t.finish({ recipe: {}, recipeId: "r1", brainGrounded: [{ title: "Fish supplier" }, { title: null }] });
    await done;
    expect(t.store.getSnapshot().made).toEqual({ recipeId: "r1", grounded: ["Fish supplier", null] });
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

  it("a lost reply with a recipe that was not there when the request began offers that recipe, as a question", async () => {
    const t = setup();
    const done = t.store.generate(form);
    await flush();
    t.shelve("r-new");
    t.fail(new ApiError("network"));
    await done;
    expect(t.store.getSnapshot()).toMatchObject({ phase: "found", found: { recipeId: "r-new", title: "r-new" }, made: null });
    expect(t.api.generate).toHaveBeenCalledTimes(1);
  });

  it("a connection that drops while the server may still be writing (wifi to mobile data at 10 s) keeps looking instead of saying nothing was saved, and shows the recipe when it lands", async () => {
    vi.useFakeTimers();
    const t = setup(() => Date.now());
    const done = t.store.generate(form);
    await vi.advanceTimersByTimeAsync(10_000);
    t.fail(new ApiError("network"));
    await done;
    expect(t.store.getSnapshot()).toMatchObject({ phase: "pending", failure: null });
    await t.store.retry();
    await t.store.generate(form);
    expect(t.api.generate).toHaveBeenCalledTimes(1);
    const looks = t.api.mine.mock.calls.length;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(t.api.mine.mock.calls.length).toBe(looks + 1);
    expect(t.store.getSnapshot().phase).toBe("pending");
    t.shelve("r-late");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(t.store.getSnapshot()).toMatchObject({ phase: "found", found: { recipeId: "r-late" } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.api.mine.mock.calls.length).toBe(looks + 2);
  });

  it("after a dropped connection, nothing was saved is said only once the server's limit has passed and the shelf shows no new recipe", async () => {
    vi.useFakeTimers();
    const t = setup(() => Date.now());
    const done = t.store.generate(form);
    await vi.advanceTimersByTimeAsync(10_000);
    t.fail(new ApiError("network"));
    await done;
    await vi.advanceTimersByTimeAsync(140_000);
    expect(t.store.getSnapshot().phase).toBe("pending");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(t.store.getSnapshot()).toMatchObject({ phase: "failed", unchecked: false, failure: { message: "The connection dropped and nothing was saved. Try again.", canRetry: true } });
  });

  it("Check now looks at once while the recipe may still be on its way", async () => {
    vi.useFakeTimers();
    const t = setup(() => Date.now());
    const done = t.store.generate(form);
    await vi.advanceTimersByTimeAsync(10_000);
    t.fail(new ApiError("network"));
    await done;
    t.shelve("r-late");
    await t.store.checkAgain();
    expect(t.store.getSnapshot()).toMatchObject({ phase: "found", found: { recipeId: "r-late" } });
  });

  it("the phone's own time-out is past the server's limit: nothing was saved is said after one look", async () => {
    const t = setup();
    const done = t.store.generate(form);
    await flush();
    t.fail(new ApiError("timeout"));
    await done;
    expect(t.store.getSnapshot()).toMatchObject({ phase: "failed", unchecked: false, failure: { message: "That took too long. Nothing was saved. Try again." } });
  });

  it("a Try again while the earlier attempt is still unchecked looks first, and offers the recipe that attempt saved instead of making a second", async () => {
    const t = setup();
    const done = t.store.generate(form);
    await flush();
    t.api.mine.mockRejectedValueOnce(new ApiError("network"));
    t.fail(new ApiError("timeout"));
    await done;
    expect(t.store.getSnapshot()).toMatchObject({ phase: "failed", unchecked: true });
    t.api.mine.mockRejectedValueOnce(new ApiError("network"));
    await t.store.retry();
    expect(t.store.getSnapshot()).toMatchObject({ phase: "failed", unchecked: true, failure: { message: "Can't reach the server. Check your signal and try again." } });
    t.shelve("r-late");
    await t.store.retry();
    expect(t.store.getSnapshot()).toMatchObject({ phase: "found", found: { recipeId: "r-late" } });
    expect(t.api.generate).toHaveBeenCalledTimes(1);
  });

  it.each([
    [new ApiError("network"), "The reply was lost."],
    [new ApiError("timeout"), "The reply was lost."],
  ])("a lost reply (%s) whose check cannot be made does not claim nothing was saved; Check again finds the recipe the server saved", async (err, start) => {
    let clock = 1000;
    const t = setup(() => clock);
    const done = t.store.generate(form);
    await flush();
    clock += PAST_SERVER_LIMIT;
    t.shelve("r-new");
    t.api.mine.mockRejectedValueOnce(new ApiError("network"));
    t.fail(err);
    await done;
    const snap = t.store.getSnapshot();
    expect(snap).toMatchObject({ phase: "failed", unchecked: true, failure: { message: `${start} The phone could not check whether a recipe was saved. Look in My Recipes before trying again.`, canRetry: true } });
    expect(snap.failure?.message).not.toMatch(/nothing was saved/i);
    await t.store.checkAgain();
    expect(t.store.getSnapshot()).toMatchObject({ phase: "found", found: { recipeId: "r-new" } });
    expect(t.api.generate).toHaveBeenCalledTimes(1);
  });

  it("Check again that reads the shelf and finds no new recipe says nothing was saved", async () => {
    let clock = 1000;
    const t = setup(() => clock);
    const done = t.store.generate(form);
    await flush();
    clock += PAST_SERVER_LIMIT;
    t.api.mine.mockRejectedValueOnce(new ApiError("network"));
    t.fail(new ApiError("network"));
    await done;
    await t.store.checkAgain();
    expect(t.store.getSnapshot()).toMatchObject({ phase: "failed", unchecked: false, failure: { message: "The connection dropped and nothing was saved. Try again." } });
    await t.store.checkAgain();
    expect(t.api.mine).toHaveBeenCalledTimes(3);
  });

  it("a stop whose check cannot be made does not claim nothing was saved", async () => {
    const t = setup();
    const done = t.store.generate(form);
    await flush();
    t.api.mine.mockRejectedValueOnce(new ApiError("network"));
    t.store.stop();
    await done;
    expect(t.store.getSnapshot()).toMatchObject({ phase: "failed", unchecked: true, failure: { message: "Stopped. The phone could not check whether a recipe was saved. Look in My Recipes before trying again." } });
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
    expect(t.store.getSnapshot().made).toEqual({ recipeId: "r2", grounded: [] });
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

  it("without a first look at the shelf (no signal) the request is not sent, so nothing can be lost", async () => {
    const t = setup();
    t.api.mine.mockRejectedValueOnce(new ApiError("network"));
    await t.store.generate(form);
    expect(t.api.generate).not.toHaveBeenCalled();
    expect(t.store.getSnapshot()).toMatchObject({ phase: "failed", unchecked: false, failure: { message: "Can't reach the server. Check your signal and try again.", canRetry: true } });
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

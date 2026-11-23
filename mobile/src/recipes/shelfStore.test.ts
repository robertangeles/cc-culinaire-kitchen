import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { RecipeSummary } from "@culinaire/shared/schemas/recipe";
import type { RecipeApi } from "./recipeApi";
import { createShelfStore } from "./shelfStore";

const row = (recipeId: string, domain = "recipe"): RecipeSummary => ({ recipeId, slug: null, title: recipeId, description: null, domain, imageUrl: null, isPublicInd: false, createdDttm: "" });

function setup() {
  const mine = vi.fn(async (page: number, domain?: string) => ({ recipes: domain === "spirits" ? [row("s1", "spirits")] : page === 1 ? [row("a"), row("b")] : [row("b"), row("c")], total: domain === "spirits" ? 1 : 3, page }));
  const store = createShelfStore({ api: { mine } as unknown as RecipeApi });
  return { store, mine };
}

describe("my recipes (shelf) store", () => {
  it("loads the first page, then more without repeating a recipe", async () => {
    const { store, mine } = setup();
    await store.refresh();
    expect(store.getSnapshot()).toMatchObject({ phase: "ready", total: 3 });
    await store.loadMore();
    expect(mine).toHaveBeenLastCalledWith(2, undefined);
    expect(store.getSnapshot().recipes.map((r) => r.recipeId)).toEqual(["a", "b", "c"]);
    await store.loadMore();
    expect(mine).toHaveBeenCalledTimes(2);
  });

  it("a refresh keeps the pages already loaded, with new and changed recipes from the fresh first page on top", async () => {
    const { store, mine } = setup();
    await store.refresh();
    await store.loadMore();
    mine.mockResolvedValueOnce({ recipes: [row("new"), { ...row("a"), title: "a, renamed" }], total: 4, page: 1 });
    await store.refresh();
    expect(store.getSnapshot().recipes.map((r) => r.title)).toEqual(["new", "a, renamed", "b", "c"]);
    expect(store.getSnapshot().total).toBe(4);
  });

  it("a refresh drops a recipe removed elsewhere, with one page loaded and with more", async () => {
    const one = setup();
    await one.store.refresh();
    one.mine.mockResolvedValueOnce({ recipes: [row("a")], total: 1, page: 1 });
    await one.store.refresh();
    expect(one.store.getSnapshot()).toMatchObject({ recipes: [{ recipeId: "a" }], total: 1 });
    expect(one.store.getSnapshot().recipes).toHaveLength(1);

    const more = setup();
    await more.store.refresh();
    await more.store.loadMore();
    more.mine.mockResolvedValueOnce({ recipes: [row("new"), row("b")], total: 3, page: 1 });
    await more.store.refresh();
    expect(more.store.getSnapshot().recipes.map((r) => r.recipeId)).toEqual(["new", "b", "c"]);
    expect(more.store.getSnapshot().total).toBe(3);
  });

  it("a refresh after a removal elsewhere, with two pages loaded, skips no recipe and Load more still reaches the end", async () => {
    let all = ["r1", "r2", "r3", "r4", "r5", "r6"];
    const mine = vi.fn(async (page: number) => ({ recipes: all.slice((page - 1) * 2, page * 2).map((id) => row(id)), total: all.length, page }));
    const store = createShelfStore({ api: { mine } as unknown as RecipeApi });
    await store.refresh();
    await store.loadMore();
    expect(store.getSnapshot().recipes.map((r) => r.recipeId)).toEqual(["r1", "r2", "r3", "r4"]);
    all = all.filter((id) => id !== "r2");
    await store.refresh();
    expect(store.getSnapshot().recipes.map((r) => r.recipeId)).toEqual(["r1", "r3", "r4", "r5"]);
    expect(store.getSnapshot().total).toBe(5);
    await store.loadMore();
    expect(store.getSnapshot().recipes.map((r) => r.recipeId)).toEqual(["r1", "r3", "r4", "r5", "r6"]);
    const calls = mine.mock.calls.length;
    await store.loadMore();
    expect(mine.mock.calls.length).toBe(calls);
  });

  it("a Load more that overtakes a refresh keeps its page when the slower refresh answers", async () => {
    const { store, mine } = setup();
    await store.refresh();
    let release: () => void = () => undefined;
    mine.mockImplementationOnce(() => new Promise((r) => (release = () => r({ recipes: [row("a"), row("b")], total: 3, page: 1 }))));
    const slow = store.refresh();
    await store.loadMore();
    expect(store.getSnapshot().recipes.map((r) => r.recipeId)).toEqual(["a", "b", "c"]);
    release();
    await slow;
    expect(store.getSnapshot().recipes.map((r) => r.recipeId)).toEqual(["a", "b", "c"]);
    expect(store.getSnapshot()).toMatchObject({ phase: "ready", more: false });
  });

  it("a refresh that overtakes Load more leaves Load more usable", async () => {
    const { store, mine } = setup();
    await store.refresh();
    let release: () => void = () => undefined;
    mine.mockImplementationOnce(() => new Promise((r) => (release = () => r({ recipes: [row("c")], total: 3, page: 2 }))));
    const slow = store.loadMore();
    expect(store.getSnapshot().more).toBe(true);
    await store.refresh();
    release();
    await slow;
    expect(store.getSnapshot().more).toBe(false);
    await store.loadMore();
    expect(store.getSnapshot().recipes.map((r) => r.recipeId)).toEqual(["a", "b", "c"]);
  });

  it("asks the server for one lab only", async () => {
    const { store, mine } = setup();
    await store.refresh();
    await store.setDomain("spirits");
    expect(mine).toHaveBeenLastCalledWith(1, "spirits");
    expect(store.getSnapshot().recipes.map((r) => r.recipeId)).toEqual(["s1"]);
  });

  it("a slower answer for the tab left behind does not replace the new tab", async () => {
    const { store, mine } = setup();
    let release: () => void = () => undefined;
    mine.mockImplementationOnce(() => new Promise((r) => (release = () => r({ recipes: [row("late")], total: 1, page: 1 }))));
    const old = store.refresh();
    await store.setDomain("spirits");
    release();
    await old;
    expect(store.getSnapshot().recipes.map((r) => r.recipeId)).toEqual(["s1"]);
  });

  it("an error with nothing on screen says so; a failed refresh keeps the list", async () => {
    const { store, mine } = setup();
    mine.mockRejectedValueOnce(new ApiError("network"));
    await store.refresh();
    expect(store.getSnapshot()).toMatchObject({ phase: "error", error: "Can't reach the server. Check your signal and try again." });
    await store.refresh();
    mine.mockRejectedValueOnce(new ApiError("network"));
    await store.refresh();
    expect(store.getSnapshot()).toMatchObject({ phase: "ready", recipes: [{ recipeId: "a" }, { recipeId: "b" }] });
  });
});

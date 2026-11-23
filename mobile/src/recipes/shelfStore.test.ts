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

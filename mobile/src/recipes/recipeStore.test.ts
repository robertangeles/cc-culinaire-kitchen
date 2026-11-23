import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { Recipe } from "@culinaire/shared/schemas/recipe";
import type { RecipeApi } from "./recipeApi";
import { createRecipeStore } from "./recipeStore";

const data = { name: "Braise", ingredients: [], steps: [], extra: { kept: true } };
const recipe = (over: Partial<Recipe> = {}): Recipe => ({ recipeId: "r1", slug: "braise", userId: 7, domain: "recipe", title: "Braise", description: null, recipeData: data, imageUrl: null, isPublicInd: false, createdDttm: "", ...over });
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(start = recipe()) {
  let current = start;
  const api = {
    get: vi.fn(async () => current),
    refine: vi.fn(async () => ({ refinedData: { name: "Braise, dairy-free", steps: [] }, changeSummary: "Swapped butter for oil." })),
    accept: vi.fn(async (_id: string, recipeData: unknown) => void (current = { ...current, recipeData, title: "Braise, dairy-free" })),
    setPublic: vi.fn(async (_id: string, isPublic: boolean) => void (current = { ...current, isPublicInd: isPublic })),
  } as unknown as RecipeApi & Record<"get" | "refine" | "accept" | "setPublic", ReturnType<typeof vi.fn>>;
  const store = createRecipeStore({ api, recipeId: "r1", userId: 7 });
  return { store, api };
}

describe("recipe store", () => {
  it("loads the recipe and knows whether this person owns it", async () => {
    const { store } = setup();
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ phase: "ready", isOwner: true });
    const other = setup(recipe({ userId: undefined }));
    await other.store.load();
    expect(other.store.getSnapshot().isOwner).toBe(false);
  });

  it("says when the recipe cannot be loaded", async () => {
    const { store, api } = setup();
    api.get.mockRejectedValueOnce(new ApiError("not_found", "Recipe not found.", 404, undefined, "NOT_FOUND"));
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ phase: "error", error: "This recipe isn't available. It may be private or deleted." });
  });

  it("a refinement is only a proposal until accepted, then the saved recipe is shown", async () => {
    const { store, api } = setup();
    await store.load();
    await store.refine("  Make it dairy-free ");
    expect(api.refine).toHaveBeenCalledWith("r1", "Make it dairy-free", expect.anything());
    expect(store.getSnapshot().refine).toMatchObject({ phase: "proposal", changeSummary: "Swapped butter for oil." });
    expect(api.accept).not.toHaveBeenCalled();
    await store.accept();
    expect(api.accept).toHaveBeenCalledWith("r1", { name: "Braise, dairy-free", steps: [] }, "Swapped butter for oil.");
    expect(store.getSnapshot()).toMatchObject({ refine: { phase: "idle" }, recipe: { title: "Braise, dairy-free" } });
  });

  it("an accept whose reload fails is still accepted: the proposal goes, and it cannot be sent a second time", async () => {
    const { store, api } = setup();
    await store.load();
    await store.refine("Make it dairy-free");
    api.get.mockRejectedValueOnce(new ApiError("network"));
    await store.accept();
    expect(store.getSnapshot()).toMatchObject({ phase: "ready", refine: { phase: "idle", failure: null }, recipe: { title: "Braise" }, error: "Your changes were saved, but the recipe could not be loaded again. Open it again to see them." });
    await store.accept();
    expect(api.accept).toHaveBeenCalledTimes(1);
  });

  it("an accept the server refuses keeps the proposal, to try again", async () => {
    const { store, api } = setup();
    await store.load();
    await store.refine("Make it dairy-free");
    api.accept.mockRejectedValueOnce(new ApiError("network"));
    await store.accept();
    expect(store.getSnapshot().refine).toMatchObject({ phase: "proposal", failure: { canRetry: true } });
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("discard drops the proposal and saves nothing", async () => {
    const { store, api } = setup();
    await store.load();
    await store.refine("Scale to 50 portions");
    store.discard();
    expect(store.getSnapshot().refine.phase).toBe("idle");
    expect(api.accept).not.toHaveBeenCalled();
  });

  it("a refusal or a stop while refining leaves the recipe as it was", async () => {
    const { store, api } = setup();
    await store.load();
    api.refine.mockRejectedValueOnce(new ApiError("server", "x", 503, undefined, "AI_UNAVAILABLE"));
    await store.refine("Make it vegan");
    expect(store.getSnapshot().refine).toMatchObject({ phase: "idle", failure: { canRetry: true } });

    api.refine.mockImplementationOnce((_id: string, _i: string, signal: AbortSignal) => new Promise((_r, reject) => signal.addEventListener("abort", () => reject(new ApiError("aborted")))));
    const running = store.refine("Make it vegan");
    await flush();
    expect(store.getSnapshot().refine.phase).toBe("refining");
    store.stopRefine();
    await running;
    expect(store.getSnapshot().refine).toEqual({ phase: "idle", failure: null });
  });

  it("refuses an instruction shorter than the server takes", async () => {
    const { store, api } = setup();
    await store.load();
    await store.refine("ok");
    expect(api.refine).not.toHaveBeenCalled();
  });

  it("the public switch shows the change at once and puts it back if the server refuses", async () => {
    const { store, api } = setup();
    await store.load();
    await store.setPublic(true);
    expect(api.setPublic).toHaveBeenCalledWith("r1", true);
    expect(store.getSnapshot().recipe?.isPublicInd).toBe(true);

    api.setPublic.mockRejectedValueOnce(new ApiError("network"));
    const pending = store.setPublic(false);
    expect(store.getSnapshot().recipe?.isPublicInd).toBe(false);
    await pending;
    expect(store.getSnapshot()).toMatchObject({ recipe: { isPublicInd: true }, visibilityError: "Can't reach the server. Check your signal and try again." });
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Recipe, RecipeSummary } from "@culinaire/shared/schemas/recipe";
import { ApiError } from "../src/api/client";
import type { RecipeApi, RecipeRequest } from "../src/recipes/recipeApi";
import { RecipesProvider } from "../src/recipes/RecipesProvider";
import { returnToScreen, routerMock, screenFocus, searchParams, sessionState } from "../testing/mocks";

vi.mock("../src/runtime/appContext", async () => {
  const { sessionState } = await import("../testing/mocks");
  return { client: {}, useSession: () => sessionState.current };
});

import MyRecipes from "../app/(app)/(recipes)/index";
import RecipeLab from "../app/(app)/(recipes)/recipe-lab";
import RecipeView from "../app/(app)/(recipes)/recipe";

const chef = { userId: 7, userName: "Rob", userEmail: "r@x.test", mfaEnabled: false, roles: [], permissions: [] };
const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch" };
const row = (recipeId: string, over: Partial<RecipeSummary> = {}): RecipeSummary => ({ recipeId, slug: null, title: `Recipe ${recipeId}`, description: "Slow and sticky", domain: "recipe", imageUrl: null, isPublicInd: false, createdDttm: "", ...over });
const data = { name: "Cider chicken", description: "Braised", yield: "4 plates", prepTime: "15 min", cookTime: "1 h", difficulty: "intermediate", ingredients: [{ amount: "8", unit: "", name: "Chicken thighs", note: "skin on" }], steps: [{ step: 1, instruction: "Brown the thighs." }], proTips: ["Rest it."], allergenNote: "Contains sulphites.", confidenceNote: "Tested method." };
const recipe = (over: Partial<Recipe> = {}): Recipe => ({ recipeId: "r1", slug: "cider-chicken", userId: 7, domain: "recipe", title: "Cider chicken", description: "Braised in cider", recipeData: data, imageUrl: null, isPublicInd: false, createdDttm: "", ...over });

function fakeApi() {
  let generateCall: { resolve: (v: unknown) => void; reject: (e: unknown) => void } | null = null;
  const api = {
    mine: vi.fn(async (page: number, domain?: string) => ({ recipes: domain === "spirits" ? [] : page === 1 ? [row("a"), row("b", { isPublicInd: true })] : [row("c")], total: domain === "spirits" ? 0 : 3, page })),
    get: vi.fn(async () => recipe()),
    generate: vi.fn((_body: RecipeRequest, signal: AbortSignal) => new Promise((resolve, reject) => {
      generateCall = { resolve, reject };
      signal.addEventListener("abort", () => reject(new ApiError("aborted")), { once: true });
    })),
    refine: vi.fn(async () => ({ refinedData: { ...data, name: "Dairy-free cider chicken", ingredients: [{ amount: "2", unit: "tbsp", name: "Olive oil" }] }, changeSummary: "Butter swapped for olive oil." })),
    accept: vi.fn(async () => {}),
    setPublic: vi.fn(async () => {}),
  };
  return { api, finish: (v: unknown) => generateCall!.resolve(v), fail: (e: unknown) => generateCall!.reject(e) };
}

let fake: ReturnType<typeof fakeApi>;
const wrap = (node: ReactNode) => <RecipesProvider api={fake.api as unknown as RecipeApi}>{node}</RecipesProvider>;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  fake = fakeApi();
  sessionState.current = { state: { phase: "ready", user: chef, location: main, locations: [main] }, busy: false };
  searchParams.current = {};
  routerMock.push.mockClear();
  routerMock.replace.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("My Recipes", () => {
  it("lists my recipes with whether each is public, loads more, and filters by lab like the web's tabs", async () => {
    render(wrap(<MyRecipes />));
    await waitFor(() => expect(screen.getByText("Recipe a")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Recipe b, public" })).toBeTruthy();
    expect(screen.getByText("Showing 2 of 3")).toBeTruthy();
    press("Load more");
    await waitFor(() => expect(screen.getByText("Recipe c")).toBeTruthy());
    // Coming back from a recipe refreshes the first page and keeps the pages already loaded.
    fake.api.mine.mockResolvedValueOnce({ recipes: [row("new"), row("a"), row("b")], total: 4, page: 1 });
    await act(async () => returnToScreen());
    await waitFor(() => expect(screen.getByText("Recipe new")).toBeTruthy());
    expect(screen.getByText("Recipe c")).toBeTruthy();
    expect(screen.getByText("Showing 4 of 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Spirits" }));
    await waitFor(() => expect(screen.getByText("No recipes yet")).toBeTruthy());
    expect(fake.api.mine).toHaveBeenLastCalledWith(1, "spirits");
  });

  it("searches the recipes already loaded and opens one", async () => {
    render(wrap(<MyRecipes />));
    await waitFor(() => expect(screen.getByText("Recipe a")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "recipe b" } });
    expect(screen.queryByText("Recipe a")).toBeNull();
    press("Recipe b, public");
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/recipe", params: { id: "b" } });
    press("Create a recipe");
    expect(routerMock.push).toHaveBeenCalledWith("/recipe-lab");
  });

  it("a recipe that finishes while the person is on My Recipes appears in the list, and Create a recipe opens the form again", async () => {
    const { rerender } = render(wrap(<><MyRecipes key="shelf" /><RecipeLab key="lab" /></>));
    fireEvent.change(screen.getByLabelText("What would you like to create?"), { target: { value: "Tart" } });
    press("Generate recipe");
    await waitFor(() => expect(fake.api.generate).toHaveBeenCalled());
    rerender(wrap(<><MyRecipes key="shelf" /></>));
    expect(screen.getByRole("button", { name: "Recipe Lab: making your recipe…" })).toBeTruthy();
    fake.api.mine.mockResolvedValueOnce({ recipes: [row("new"), row("a"), row("b")], total: 4, page: 1 });
    await act(async () => fake.finish({ recipe: data, recipeId: "new" }));
    await waitFor(() => expect(screen.getByText("Recipe new")).toBeTruthy());
    press("Create a recipe");
    expect(routerMock.push).toHaveBeenCalledWith("/recipe-lab");
    rerender(wrap(<><MyRecipes key="shelf" /><RecipeLab key="lab" /></>));
    expect(screen.getByRole("button", { name: "Generate recipe" })).toBeTruthy();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });
});

describe("Recipe Lab", () => {
  it("sends the web's fields, shows the wait with Stop, and opens the saved recipe", async () => {
    render(wrap(<RecipeLab />));
    expect(screen.getByRole("button", { name: "Generate recipe" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(screen.getByLabelText("What would you like to create?"), { target: { value: "Chicken braise with cider" } });
    fireEvent.change(screen.getByLabelText("Key ingredients"), { target: { value: "chicken, cider , shallots" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Dairy-Free" }));
    fireEvent.click(screen.getByRole("radio", { name: "Professional / Line Cook" }));
    press("More servings");
    press("Generate recipe");
    await waitFor(() => expect(screen.getByText("Writing your recipe…")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(fake.api.generate).toHaveBeenCalledWith({ request: "Chicken braise with cider", servings: 5, difficulty: "advanced", dietary: ["Dairy-Free"], mainIngredients: ["chicken", "cider", "shallots"], cuisine: undefined, occasion: undefined }, expect.anything());
    await act(async () => fake.finish({ recipe: data, recipeId: "r9", imageUrl: null }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith({ pathname: "/recipe", params: { id: "r9" } }));
  });

  it("Stop ends it and says nothing was saved", async () => {
    render(wrap(<RecipeLab />));
    fireEvent.change(screen.getByLabelText("What would you like to create?"), { target: { value: "Tart" } });
    press("Generate recipe");
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy());
    press("Stop");
    await waitFor(() => expect(screen.getByText("Stopped. Nothing was saved.")).toBeTruthy());
  });

  it("a lost reply with a new recipe on the shelf asks whether it is this one, instead of making it twice", async () => {
    render(wrap(<RecipeLab />));
    fireEvent.change(screen.getByLabelText("What would you like to create?"), { target: { value: "Tart" } });
    press("Generate recipe");
    await waitFor(() => expect(fake.api.generate).toHaveBeenCalled());
    fake.api.mine.mockResolvedValueOnce({ recipes: [row("new"), row("a"), row("b")], total: 4, page: 1 });
    await act(async () => fake.fail(new ApiError("network")));
    await waitFor(() => expect(screen.getByText("A new recipe appeared. Is it this one?")).toBeTruthy());
    expect(screen.getByText(/"Recipe new" was saved to My Recipes/)).toBeTruthy();
    press("Open it");
    expect(routerMock.replace).toHaveBeenCalledWith({ pathname: "/recipe", params: { id: "new" } });
    expect(fake.api.generate).toHaveBeenCalledTimes(1);
  });

  it("a lost reply that cannot be checked says so, with Check again beside Try again", async () => {
    render(wrap(<RecipeLab />));
    fireEvent.change(screen.getByLabelText("What would you like to create?"), { target: { value: "Tart" } });
    press("Generate recipe");
    await waitFor(() => expect(fake.api.generate).toHaveBeenCalled());
    fake.api.mine.mockRejectedValueOnce(new ApiError("network"));
    await act(async () => fake.fail(new ApiError("timeout")));
    await waitFor(() => expect(screen.getByText("The reply was lost. The phone could not check whether a recipe was saved. Look in My Recipes before trying again.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    fake.api.mine.mockResolvedValueOnce({ recipes: [row("new"), row("a"), row("b")], total: 4, page: 1 });
    press("Check again");
    await waitFor(() => expect(screen.getByText("A new recipe appeared. Is it this one?")).toBeTruthy());
    expect(fake.api.generate).toHaveBeenCalledTimes(1);
  });

  it("a dropped connection says the recipe may still be on its way, with Check now and no Try again", async () => {
    render(wrap(<RecipeLab />));
    fireEvent.change(screen.getByLabelText("What would you like to create?"), { target: { value: "Tart" } });
    press("Generate recipe");
    await waitFor(() => expect(fake.api.generate).toHaveBeenCalled());
    await act(async () => fake.fail(new ApiError("network")));
    await waitFor(() => expect(screen.getByText("Your recipe may still be on its way")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByText(/nothing was saved/i)).toBeNull();
    fake.api.mine.mockResolvedValueOnce({ recipes: [row("new"), row("a"), row("b")], total: 4, page: 1 });
    press("Check now");
    await waitFor(() => expect(screen.getByText("A new recipe appeared. Is it this one?")).toBeTruthy());
    expect(fake.api.generate).toHaveBeenCalledTimes(1);
  });

  it("a recipe made while the lab is behind another tab opens when the person comes back, not before", async () => {
    render(wrap(<RecipeLab />));
    fireEvent.change(screen.getByLabelText("What would you like to create?"), { target: { value: "Tart" } });
    press("Generate recipe");
    await waitFor(() => expect(fake.api.generate).toHaveBeenCalled());
    screenFocus.current = false;
    await act(async () => fake.finish({ recipe: data, recipeId: "r9" }));
    await settle();
    expect(routerMock.replace).not.toHaveBeenCalled();
    screenFocus.current = true;
    await act(async () => returnToScreen());
    expect(routerMock.replace).toHaveBeenCalledWith({ pathname: "/recipe", params: { id: "r9" } });
  });

  it("cuts a key ingredient to the 50 characters the server takes", async () => {
    render(wrap(<RecipeLab />));
    fireEvent.change(screen.getByLabelText("What would you like to create?"), { target: { value: "Braise" } });
    const long = "chicken thighs with the skin on and some dry cider from the farm";
    fireEvent.change(screen.getByLabelText("Key ingredients"), { target: { value: `${long}, shallots` } });
    press("Generate recipe");
    await waitFor(() => expect(fake.api.generate).toHaveBeenCalled());
    const sent = fake.api.generate.mock.calls[0][0].mainIngredients!;
    expect(sent).toEqual(["chicken thighs with the skin on and some dry cider", "shallots"]);
    expect(sent.every((i) => i.length <= 50)).toBe(true);
  });

  it("shows the server's time-out plainly with Try again", async () => {
    render(wrap(<RecipeLab />));
    fireEvent.change(screen.getByLabelText("What would you like to create?"), { target: { value: "Tart" } });
    press("Generate recipe");
    await waitFor(() => expect(fake.api.generate).toHaveBeenCalled());
    await act(async () => fake.fail(new ApiError("server", "x", 504, undefined, "AI_TIMEOUT")));
    await waitFor(() => expect(screen.getByText("That took too long. Nothing was saved. Try again.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("a recipe", () => {
  it("shows the recipe and lets its owner switch it public", async () => {
    searchParams.current = { id: "r1" };
    render(wrap(<RecipeView />));
    await waitFor(() => expect(screen.getByText("Cider chicken")).toBeTruthy());
    expect(screen.getByText("Chicken thighs")).toBeTruthy();
    expect(screen.getByText("Brown the thighs.")).toBeTruthy();
    expect(screen.getByText("Only you can open it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Public" }));
    await settle();
    expect(fake.api.setPublic).toHaveBeenCalledWith("r1", true);
    expect(screen.getByText("Anyone can open it, and it is listed in the community gallery.")).toBeTruthy();
  });

  it("marks the recipe just made as grounded in the kitchen's notes, expandable to their titles", async () => {
    searchParams.current = { id: "r9" };
    render(wrap(<><RecipeLab /><RecipeView /></>));
    await waitFor(() => expect(screen.getByText("Refine with Antoine")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Grounded in your Brain" })).toBeNull();
    fireEvent.change(screen.getByLabelText("What would you like to create?"), { target: { value: "Chicken braise" } });
    press("Generate recipe");
    await waitFor(() => expect(fake.api.generate).toHaveBeenCalled());
    await act(async () => fake.finish({ recipe: data, recipeId: "r9", brainGrounded: [{ title: "Fish supplier" }, { title: null }] }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Grounded in your Brain" })).toBeTruthy());
    press("Grounded in your Brain");
    expect(screen.getByText("• Fish supplier")).toBeTruthy();
    expect(screen.getByText("• A note from your kitchen")).toBeTruthy();
  });

  it("an accept that was saved but could not be loaded again says so and leaves no Accept to press twice", async () => {
    searchParams.current = { id: "r1" };
    render(wrap(<RecipeView />));
    await waitFor(() => expect(screen.getByText("Refine with Antoine")).toBeTruthy());
    press("Make dairy-free");
    press("Refine");
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept changes" })).toBeTruthy());
    fake.api.get.mockRejectedValueOnce(new ApiError("network"));
    press("Accept changes");
    await waitFor(() => expect(screen.getByText("Your changes were saved, but the recipe could not be loaded again. Open it again to see them.")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Accept changes" })).toBeNull();
    expect(fake.api.accept).toHaveBeenCalledTimes(1);
  });

  it("gives someone who does not own it no switch and no refine", async () => {
    fake.api.get.mockResolvedValueOnce(recipe({ userId: undefined, isPublicInd: true }));
    searchParams.current = { id: "r1" };
    render(wrap(<RecipeView />));
    await waitFor(() => expect(screen.getByText("Cider chicken")).toBeTruthy());
    expect(screen.queryByRole("tab", { name: "Public" })).toBeNull();
    expect(screen.queryByText("Refine with Antoine")).toBeNull();
  });

  it("refines into a proposal that is saved only on Accept", async () => {
    searchParams.current = { id: "r1" };
    render(wrap(<RecipeView />));
    await waitFor(() => expect(screen.getByText("Refine with Antoine")).toBeTruthy());
    press("Make dairy-free");
    press("Refine");
    await waitFor(() => expect(screen.getByText("Butter swapped for olive oil.")).toBeTruthy());
    expect(screen.getByText("Dairy-free cider chicken")).toBeTruthy();
    expect(fake.api.accept).not.toHaveBeenCalled();
    press("Accept changes");
    await waitFor(() => expect(fake.api.accept).toHaveBeenCalledWith("r1", expect.objectContaining({ name: "Dairy-free cider chicken" }), "Butter swapped for olive oil."));
  });

  it("says when the recipe is not there", async () => {
    fake.api.get.mockRejectedValueOnce(new ApiError("not_found", "x", 404, undefined, "NOT_FOUND"));
    searchParams.current = { id: "gone" };
    render(wrap(<RecipeView />));
    await waitFor(() => expect(screen.getByText("This recipe isn't available. It may be private or deleted.")).toBeTruthy());
  });
});

describe("tablet width", () => {
  it.each([
    ["an iPad (portrait)", 820, 1180],
    ["an iPad (landscape)", 1180, 820],
    ["a phone", 390, 844],
  ])("puts the recipe screens in the app's 560 dp column, centred, on %s", async (_name, width, height) => {
    window.innerWidth = width;
    window.innerHeight = height;
    searchParams.current = { id: "r1" };
    for (const Screen of [MyRecipes, RecipeLab, RecipeView]) {
      const { container, unmount } = render(wrap(<Screen />));
      await waitFor(() => expect([...container.querySelectorAll("div")].some((d) => getComputedStyle(d).maxWidth === "560px")).toBe(true));
      const column = [...container.querySelectorAll("div")].find((d) => getComputedStyle(d).maxWidth === "560px")!;
      expect(getComputedStyle(column).width).toBe("100%");
      expect(getComputedStyle(column).alignSelf).toBe("center");
      unmount();
    }
  });
});

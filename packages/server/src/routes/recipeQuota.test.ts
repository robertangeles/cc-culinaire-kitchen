import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

const generate = vi.fn();
const chargeSession = vi.fn();
vi.mock("../controllers/recipeController.js", () => {
  const stub = () => vi.fn();
  return {
    recipeHandler: () => generate,
    handleGallery: stub(), handleMyRecipes: stub(), handleGetRecipe: stub(), handleUpdateRecipe: stub(),
    handleUpdateRecipeContent: stub(), handleDeleteRecipe: stub(), handleArchiveRecipe: stub(), handleEmailRecipe: stub(),
    handleRegenerateImages: stub(), handleMigrateImages: stub(), handleGetVersions: stub(), handleGetVersion: stub(),
    handleRevertVersion: stub(), handleRefineRecipe: stub(), handleAcceptRefinement: stub(), handleRegenerateImage: stub(),
    handleGetRecipesForImport: stub(),
  };
});
vi.mock("../middleware/usage.js", () => ({ checkSessionQuota: vi.fn(), chargeSession }));
vi.mock("../middleware/guestAuth.js", () => ({ authenticateOrGuest: vi.fn() }));

const { recipesRouter } = await import("./recipes.js");

const handlerOf = (path: string) => {
  const layer = recipesRouter.stack.find((l) => l.route?.path === path && (l.route as { methods: Record<string, boolean> }).methods.post);
  const stack = layer!.route!.stack;
  return stack[stack.length - 1].handle as (req: Request, res: Response, next: () => void) => Promise<void>;
};

describe.each(["/generate", "/patisserie", "/spirits"])("POST %s charges a session only for a recipe", (path) => {
  beforeEach(() => vi.clearAllMocks());

  it("charges once when a recipe was made", async () => {
    generate.mockResolvedValue(true);
    await handlerOf(path)({ user: { sub: 1 } } as Request, {} as Response, vi.fn());
    expect(chargeSession).toHaveBeenCalledOnce();
  });

  it("does not charge a prose fallback, a failure, a time-out or an abandoned request", async () => {
    generate.mockResolvedValue(false);
    await handlerOf(path)({ user: { sub: 1 } } as Request, {} as Response, vi.fn());
    expect(chargeSession).not.toHaveBeenCalled();
  });
});

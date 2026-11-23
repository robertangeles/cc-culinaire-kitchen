import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A recipe is saved only if the client is still waiting: an abort or time-out during generation must leave no
 * row behind, so a retry cannot duplicate it, and no quota is spent on it.
 */
const generateObjectMock = vi.fn();
vi.mock("ai", () => ({
  generateObject: (args: unknown) => generateObjectMock(args),
  NoObjectGeneratedError: class extends Error {},
}));
vi.mock("./brainRecallService.js", () => ({ recallMemoriesWithBudget: vi.fn(async () => null) }));
vi.mock("./knowledgeService.js", () => ({ searchKnowledge: vi.fn(async () => []) }));
vi.mock("./providerService.js", () => ({ getModel: vi.fn(() => ({})) }));
vi.mock("./promptService.js", () => ({ getPromptRaw: vi.fn(async () => ({ content: "SYSTEM" })) }));
const getAllSettings = vi.fn(async () => ({}) as Record<string, string>);
vi.mock("./settingsService.js", () => ({ getAllSettings: () => getAllSettings() }));
const generateImage = vi.fn(async () => null as { url: string } | null);
vi.mock("./imageService.js", () => ({ generateImage: (...a: unknown[]) => generateImage(...(a as [])) }));
const saveRecipe = vi.fn(async () => ({ recipeId: "r1", slug: "s1" }));
vi.mock("./recipePersistenceService.js", () => ({ saveRecipe: () => saveRecipe() }));
vi.mock("./brainCaptureService.js", () => ({ recordOpsEvent: vi.fn() }));

const dish = { name: "Dish", description: "d", imagePrompt: "a dish" };
const input = (signal?: AbortSignal) => ({ domain: "recipe" as const, request: "a dish", userId: 5, signal });

describe("generateRecipe and an abandoned request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllSettings.mockResolvedValue({});
    generateObjectMock.mockResolvedValue({ object: dish });
  });

  it("hands the signal to the model call", async () => {
    const { generateRecipe } = await import("./recipeService.js");
    const ctl = new AbortController();
    await generateRecipe(input(ctl.signal));
    expect(generateObjectMock.mock.calls[0][0]).toMatchObject({ abortSignal: ctl.signal });
  });

  it("saves the recipe when nobody aborted", async () => {
    const { generateRecipe } = await import("./recipeService.js");
    const out = await generateRecipe(input(new AbortController().signal));
    expect(out.recipeId).toBe("r1");
    expect(saveRecipe).toHaveBeenCalledOnce();
  });

  it("an abort during the model call rejects, without the retries or the prose fallback, and saves nothing", async () => {
    const { generateRecipe } = await import("./recipeService.js");
    const ctl = new AbortController();
    generateObjectMock.mockImplementation(async () => {
      ctl.abort(new Error("client closed the connection"));
      throw new Error("aborted");
    });

    await expect(generateRecipe(input(ctl.signal))).rejects.toThrow("client closed the connection");
    expect(generateObjectMock).toHaveBeenCalledOnce();
    expect(saveRecipe).not.toHaveBeenCalled();
  });

  it("an abort after the model answered, while the image was being made, saves nothing", async () => {
    const { generateRecipe } = await import("./recipeService.js");
    const ctl = new AbortController();
    getAllSettings.mockResolvedValue({ image_generation_enabled: "true" });
    generateImage.mockImplementation(async () => {
      ctl.abort(new Error("client closed the connection"));
      return { url: "/uploads/x.png" };
    });

    await expect(generateRecipe(input(ctl.signal))).rejects.toThrow("client closed the connection");
    expect(generateImage).toHaveBeenCalledWith("a dish", ctl.signal);
    expect(saveRecipe).not.toHaveBeenCalled();
  });

  it("without a signal it behaves as before", async () => {
    const { generateRecipe } = await import("./recipeService.js");
    expect((await generateRecipe(input())).recipeId).toBe("r1");
  });
});

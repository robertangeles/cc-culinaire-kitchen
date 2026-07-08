import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the Brain recall splice in recipe refinement (spec T13).
 * Captures the prompt handed to `generateObject` and asserts the Brain block is
 * spliced when recall returns one, and absent when it doesn't.
 */

let capturedPrompt = "";
const generateObjectMock = vi.fn(async (args: { prompt: string }) => {
  capturedPrompt = args.prompt;
  return { object: { refinedData: { name: "Refined Dish" }, changeSummary: "reduced salt" } };
});
vi.mock("ai", () => ({ generateObject: (args: any) => generateObjectMock(args) }));

let mockRecall: { block: string; memories: unknown[] } | null = null;
const recallSpy = vi.fn(async () => mockRecall);
vi.mock("./brainRecallService.js", () => ({
  recallMemoriesWithBudget: (...args: unknown[]) => recallSpy(...(args as [])),
}));

vi.mock("./providerService.js", () => ({ getModel: vi.fn(() => ({})) }));
vi.mock("./promptService.js", () => ({ getPromptRaw: vi.fn(async () => ({ content: "REFINEMENT SYSTEM PROMPT" })) }));
vi.mock("./knowledgeService.js", () => ({ searchKnowledge: vi.fn(async () => []) }));

describe("recipeRefinementService — Brain recall splice (spec T13)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedPrompt = "";
    mockRecall = null;
  });

  it("seeds the recall query from the instruction + recipe name and threads userId + activeOrgId", async () => {
    const { refineRecipe } = await import("./recipeRefinementService.js");
    await refineRecipe({ name: "Miso Cod" }, "make it spicier", undefined, 7, 3);

    expect(recallSpy).toHaveBeenCalledTimes(1);
    const [uid, query, org] = recallSpy.mock.calls[0] as [number, string, number | null];
    expect(uid).toBe(7);
    expect(org).toBe(3);
    expect(query).toContain("make it spicier");
    expect(query).toContain("Miso Cod");
  });

  it("splices the ## Brain Memory block into the refinement prompt when recall hits", async () => {
    mockRecall = { block: "## Brain Memory\n- [recipe · 2026-07-01] Miso Cod: less sweet", memories: [] };
    const { refineRecipe } = await import("./recipeRefinementService.js");
    await refineRecipe({ name: "Miso Cod" }, "make it spicier", "KITCHEN_CTX", 7, 3);

    expect(capturedPrompt).toContain("## Brain Memory");
    expect(capturedPrompt).toContain("less sweet");
  });

  it("is unchanged (no Brain text) when recall returns null", async () => {
    mockRecall = null;
    const { refineRecipe } = await import("./recipeRefinementService.js");
    await refineRecipe({ name: "Miso Cod" }, "make it spicier", "KITCHEN_CTX", 7, 3);

    expect(capturedPrompt).not.toContain("## Brain Memory");
    expect(capturedPrompt).toContain("Chef's Instruction");
  });
});

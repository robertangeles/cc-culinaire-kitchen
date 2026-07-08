import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the Brain recall splice in the Creative Labs
 * (docs/specs/brain-memory.md T13). All I/O deps are mocked; the test captures
 * the `prompt` (user message) handed to `generateObject` and asserts the
 * `## Brain Memory` block is spliced in D5 order (kitchen context → Brain → RAG)
 * when recall returns a block, and that the prompt is unchanged when it doesn't.
 */

// generateObject — capture the args, return a minimal valid recipe object.
let capturedPrompt = "";
let capturedSystem = "";
const generateObjectMock = vi.fn(async (args: { system: string; prompt: string }) => {
  capturedPrompt = args.prompt;
  capturedSystem = args.system;
  return { object: { name: "Test Dish", description: "d", imagePrompt: "p" } };
});
vi.mock("ai", () => ({
  generateObject: (args: any) => generateObjectMock(args),
  NoObjectGeneratedError: class extends Error {},
}));

// Brain recall — controlled per test.
let mockRecall: { block: string; memories: Array<{ memoryId: string; title: string | null; sourceType: string }> } | null = null;
const recallSpy = vi.fn(async () => mockRecall);
vi.mock("./brainRecallService.js", () => ({
  recallMemoriesWithBudget: (...args: unknown[]) => recallSpy(...(args as [])),
}));

// RAG — return one snippet so ragContext is non-empty (for the ordering assertion).
let ragSnippets: Array<{ snippet: string }> = [];
vi.mock("./knowledgeService.js", () => ({
  searchKnowledge: vi.fn(async () => ragSnippets),
}));

// Remaining side-effecting deps — inert.
vi.mock("./providerService.js", () => ({ getModel: vi.fn(() => ({})) }));
vi.mock("./promptService.js", () => ({ getPromptRaw: vi.fn(async () => ({ content: "DOMAIN SYSTEM PROMPT" })) }));
vi.mock("./settingsService.js", () => ({ getAllSettings: vi.fn(async () => ({})) }));
vi.mock("./imageService.js", () => ({ generateImage: vi.fn(async () => null) }));
vi.mock("./recipePersistenceService.js", () => ({ saveRecipe: vi.fn(async () => ({ recipeId: "r1", slug: "s1" })) }));
vi.mock("./brainCaptureService.js", () => ({ recordOpsEvent: vi.fn() }));

const RECALL = {
  block:
    "## Brain Memory\nThe notes below are this user's own past activity plus knowledge shared within their kitchen.\n- [recipe · 2026-07-01] Miso Cod: reduced the sugar last time",
  memories: [{ memoryId: "m1", title: "Miso Cod", sourceType: "recipe" }],
};

describe("recipeService — Brain recall splice in the Labs (spec T13)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedPrompt = "";
    capturedSystem = "";
    mockRecall = null;
    ragSnippets = [];
  });

  it("seeds the recall query from the brief + domain params and threads userId + activeOrgId", async () => {
    const { generateRecipe } = await import("./recipeService.js");
    await generateRecipe({
      domain: "recipe",
      request: "miso glazed cod",
      cuisine: "Japanese",
      mainIngredients: ["cod", "miso"],
      userId: 5,
      activeOrgId: 9,
    });

    expect(recallSpy).toHaveBeenCalledTimes(1);
    const [uid, query, org] = recallSpy.mock.calls[0] as [number, string, number | null];
    expect(uid).toBe(5);
    expect(org).toBe(9);
    expect(query).toContain("miso glazed cod");
    expect(query).toContain("Japanese");
    expect(query).toContain("cod");
    expect(query).toContain("miso");
  });

  it("splices the ## Brain Memory block in D5 order — after kitchen context, before RAG", async () => {
    mockRecall = RECALL;
    ragSnippets = [{ snippet: "RAG_KNOWLEDGE_DOC" }];
    const { generateRecipe } = await import("./recipeService.js");
    await generateRecipe({
      domain: "recipe",
      request: "miso cod",
      kitchenContext: "KITCHEN_CONTEXT_MARKER",
      userId: 5,
      activeOrgId: 9,
    });

    expect(capturedPrompt).toContain("## Brain Memory");
    expect(capturedPrompt).toContain("reduced the sugar last time");
    // D5 order: kitchen context → Brain Memory → RAG.
    const iKitchen = capturedPrompt.indexOf("KITCHEN_CONTEXT_MARKER");
    const iBrain = capturedPrompt.indexOf("## Brain Memory");
    const iRag = capturedPrompt.indexOf("RAG_KNOWLEDGE_DOC");
    expect(iKitchen).toBeGreaterThanOrEqual(0);
    expect(iKitchen).toBeLessThan(iBrain);
    expect(iBrain).toBeLessThan(iRag);
  });

  it("is byte-identical (no Brain text) when recall returns null", async () => {
    mockRecall = null;
    const { generateRecipe } = await import("./recipeService.js");
    await generateRecipe({
      domain: "recipe",
      request: "miso cod",
      kitchenContext: "KITCHEN_CONTEXT_MARKER",
      userId: 5,
      activeOrgId: 9,
    });

    expect(capturedPrompt).not.toContain("## Brain Memory");
    expect(capturedPrompt).not.toContain("Brain Memory");
    // The rest of the message is intact.
    expect(capturedPrompt).toContain("KITCHEN_CONTEXT_MARKER");
    expect(capturedPrompt).toContain("Create a recipe: miso cod");
  });

  it("seeds domain-specific fields for spirits and patisserie", async () => {
    const { generateRecipe } = await import("./recipeService.js");

    await generateRecipe({ domain: "spirits", request: "smoky sour", spiritBase: "mezcal", userId: 5 });
    expect((recallSpy.mock.calls[0] as [number, string])[1]).toContain("mezcal");

    recallSpy.mockClear();
    await generateRecipe({ domain: "patisserie", request: "layered tart", pastryType: "choux", userId: 5 });
    expect((recallSpy.mock.calls[0] as [number, string])[1]).toContain("choux");
  });

  it("returns the recalled memories that grounded the generation (drives the Labs chip, spec T14)", async () => {
    mockRecall = RECALL;
    const { generateRecipe } = await import("./recipeService.js");
    const result = await generateRecipe({ domain: "recipe", request: "miso cod", userId: 5, activeOrgId: 9 });
    expect(result.memories).toEqual(RECALL.memories);
  });

  it("returns memories: null when recall misses (no chip)", async () => {
    mockRecall = null;
    const { generateRecipe } = await import("./recipeService.js");
    const result = await generateRecipe({ domain: "recipe", request: "miso cod", userId: 5 });
    expect(result.memories).toBeNull();
  });
});

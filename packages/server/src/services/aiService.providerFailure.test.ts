import { describe, it, expect, vi } from "vitest";
import { MockLanguageModelV1 } from "ai/test";

// The real AI SDK runs here (only the model is a stand-in), because the bug was in how
// streamChat waits on the SDK after a provider failure.
const model = new MockLanguageModelV1({
  doStream: async () => {
    throw new Error("provider answered 500");
  },
});

vi.mock("./providerService.js", () => ({ getModel: vi.fn(() => model), getWebSearchModel: vi.fn(() => model) }));
vi.mock("./promptService.js", () => ({ getSystemPrompt: vi.fn(async () => ({ body: "You cook. {{KITCHEN_CONTEXT}}", modelId: null })) }));
vi.mock("./knowledgeService.js", () => ({ searchKnowledge: vi.fn(async () => []), readKnowledgeDocument: vi.fn(async () => null) }));
vi.mock("./settingsService.js", () => ({ getAllSettings: vi.fn(async () => ({})) }));
vi.mock("./userContextService.js", () => ({ buildContextString: vi.fn(async () => "") }));
vi.mock("./brainRecallService.js", () => ({ recallMemoriesWithBudget: vi.fn(async () => null) }));

describe("streamChat: the model provider fails before any text", () => {
  it("sends an error part, closes the response and reports no answer", async () => {
    const { streamChat } = await import("./aiService.js");
    const res = { setHeader: vi.fn(), write: vi.fn(), end: vi.fn(), destroyed: false };

    expect(await streamChat([{ role: "user", content: "steak?" }], res as never)).toBe(false);

    const sent = res.write.mock.calls.map((c) => (typeof c[0] === "string" ? c[0] : new TextDecoder().decode(c[0]))).join("");
    // Data-stream protocol: an error is a `3:` part. The provider's own text must not leak.
    expect(sent).toMatch(/^3:/m);
    expect(sent).not.toContain("provider answered 500");
    expect(res.end).toHaveBeenCalledOnce();
  });
});

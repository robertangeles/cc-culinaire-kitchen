import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const generateObjectMock = vi.fn();
vi.mock("ai", async () => ({ ...(await vi.importActual<typeof import("ai")>("ai")), generateObject: (a: unknown) => generateObjectMock(a) }));
const getModel = vi.fn(() => ({ _type: "model" }));
vi.mock("./providerService.js", () => ({ getModel: () => getModel(), getWebSearchModel: vi.fn() }));
vi.mock("./promptService.js", () => ({ getSystemPrompt: vi.fn() }));
vi.mock("./knowledgeService.js", () => ({ searchKnowledge: vi.fn(), readKnowledgeDocument: vi.fn() }));
vi.mock("./settingsService.js", () => ({ getAllSettings: vi.fn() }));
vi.mock("./userContextService.js", () => ({ buildContextString: vi.fn() }));
vi.mock("./brainRecallService.js", () => ({ recallMemoriesWithBudget: vi.fn() }));

const schema = z.object({ summary: z.string() });

describe("generateStructured", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getModel.mockReturnValue({ _type: "model" });
  });

  it("returns the model's object, calling the configured model with the schema, prompts and a time limit", async () => {
    const { generateStructured } = await import("./aiService.js");
    generateObjectMock.mockResolvedValue({ object: { summary: "ok" } });

    expect(await generateStructured({ schema, system: "SYS", prompt: "PROMPT" })).toEqual({ summary: "ok" });
    expect(generateObjectMock.mock.calls[0][0]).toMatchObject({ model: { _type: "model" }, schema, system: "SYS", prompt: "PROMPT" });
    expect(generateObjectMock.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("a provider failure is a 503 AI_UNAVAILABLE that does not repeat the provider's message", async () => {
    const { generateStructured } = await import("./aiService.js");
    generateObjectMock.mockRejectedValue(new Error("401 Unauthorized: sk-secret-key"));

    const err = await generateStructured({ schema, prompt: "p" }).catch((e) => e);

    expect(err).toMatchObject({ statusCode: 503, code: "AI_UNAVAILABLE" });
    expect(err.message).not.toContain("sk-secret-key");
  });

  it("a model that cannot be configured is the same 503", async () => {
    const { generateStructured } = await import("./aiService.js");
    getModel.mockImplementation(() => {
      throw new Error("no provider configured");
    });

    await expect(generateStructured({ schema, prompt: "p" })).rejects.toMatchObject({ statusCode: 503, code: "AI_UNAVAILABLE" });
  });

  it("a call that outlasts the time limit is a 504 AI_TIMEOUT", async () => {
    const { generateStructured } = await import("./aiService.js");
    generateObjectMock.mockImplementation(
      ({ abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise((_resolve, reject) => abortSignal.addEventListener("abort", () => reject(abortSignal.reason))),
    );

    await expect(generateStructured({ schema, prompt: "p", timeoutMs: 20 })).rejects.toMatchObject({ statusCode: 504, code: "AI_TIMEOUT" });
  });
});

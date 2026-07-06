import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the capture-time relevance gate (docs/specs/brain-memory.md —
 * the Balanced distillation deviation from D10).
 *
 * The model call (`generateText`) and settings are mocked so verdict parsing,
 * input capping, and the fail-open contract are exercised deterministically —
 * no network, no real LLM.
 */

let mockSettings: Record<string, string> = {};
vi.mock("./settingsService.js", () => ({
  getAllSettings: vi.fn(async () => mockSettings),
}));

vi.mock("./providerService.js", () => ({
  getModel: vi.fn(() => ({ _mock: "model" })),
}));

// Controlled generateText — each test sets what the "model" returns (or throws).
let generateTextImpl: (args: unknown) => Promise<{ text: string }>;
let lastGenerateArgs: { system?: string; prompt?: string } | null = null;
vi.mock("ai", () => ({
  generateText: vi.fn((args: { system?: string; prompt?: string }) => {
    lastGenerateArgs = args;
    return generateTextImpl(args);
  }),
}));

describe("brainDistillService — shouldRememberChatTurn (Balanced gate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastGenerateArgs = null;
    mockSettings = { brain_distillation_model: "anthropic/claude-haiku-4-5" };
    generateTextImpl = async () => ({ text: "REMEMBER" });
  });

  it("returns remember=true when the model answers REMEMBER", async () => {
    generateTextImpl = async () => ({ text: "REMEMBER" });
    const { shouldRememberChatTurn } = await import("./brainDistillService.js");
    const v = await shouldRememberChatTurn("Cook asked: my pasta ratio is 100g/egg");
    expect(v.remember).toBe(true);
    expect(v.reason).toBe("distilled-keep");
  });

  it("returns remember=false when the model answers SKIP", async () => {
    generateTextImpl = async () => ({ text: "SKIP" });
    const { shouldRememberChatTurn } = await import("./brainDistillService.js");
    const v = await shouldRememberChatTurn("Cook asked: what's my pasta ratio?");
    expect(v.remember).toBe(false);
    expect(v.reason).toBe("distilled-skip");
  });

  it("parses a verbose reply containing the keyword (case-insensitive)", async () => {
    generateTextImpl = async () => ({ text: "  skip — pure retrieval question\n" });
    const { shouldRememberChatTurn } = await import("./brainDistillService.js");
    const v = await shouldRememberChatTurn("Cook asked: remind me my ratio?");
    expect(v.remember).toBe(false);
  });

  it("fails OPEN (remember=true) when the model call throws", async () => {
    generateTextImpl = async () => {
      throw new Error("provider 500");
    };
    const { shouldRememberChatTurn } = await import("./brainDistillService.js");
    const v = await shouldRememberChatTurn("anything");
    expect(v.remember).toBe(true);
    expect(v.reason).toBe("judge-error");
  });

  it("fails OPEN when the reply is unrecognisable", async () => {
    generateTextImpl = async () => ({ text: "purple monkey dishwasher" });
    const { shouldRememberChatTurn } = await import("./brainDistillService.js");
    const v = await shouldRememberChatTurn("Cook asked: something");
    expect(v.remember).toBe(true);
    expect(v.reason).toBe("unparsed");
  });

  it("treats empty content as not worth remembering (no model call)", async () => {
    const { generateText } = await import("ai");
    const { shouldRememberChatTurn } = await import("./brainDistillService.js");
    const v = await shouldRememberChatTurn("   ");
    expect(v.remember).toBe(false);
    expect(v.reason).toBe("empty");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("caps the input sent to the model at 1500 chars", async () => {
    generateTextImpl = async () => ({ text: "REMEMBER" });
    const { shouldRememberChatTurn } = await import("./brainDistillService.js");
    await shouldRememberChatTurn("x".repeat(5000));
    // The prompt embeds the (capped) content; assert it never carries the full 5000.
    expect(lastGenerateArgs?.prompt?.length ?? 0).toBeLessThan(1800);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @ai-sdk/openai — return a factory that records the model ID
const mockModelInstance = { _type: "model" };
const mockEmbeddingInstance = { _type: "embedding" };
const mockProviderFn: any = vi.fn(() => mockModelInstance);
mockProviderFn.embedding = vi.fn(() => mockEmbeddingInstance);
const mockCreateOpenAI = vi.fn(() => mockProviderFn);

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: mockCreateOpenAI,
}));

describe("providerService", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset relevant env vars
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.AI_MODEL;
    delete process.env.WEB_SEARCH_MODEL;
    delete process.env.CLIENT_URL;
  });

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv };
  });

  describe("getModel", () => {
    it("returns a model with the default model ID when AI_MODEL is not set", async () => {
      const { getModel } = await import("./providerService.js");
      const result = getModel();

      expect(mockCreateOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: "https://openrouter.ai/api/v1",
        }),
      );
      expect(mockProviderFn).toHaveBeenCalledWith("anthropic/claude-sonnet-4-20250514");
      expect(result).toBe(mockModelInstance);
    });

    it("uses AI_MODEL env var when set", async () => {
      process.env.AI_MODEL = "openai/gpt-4o";
      // Reset module to pick up new env
      vi.resetModules();
      vi.doMock("@ai-sdk/openai", () => ({
        createOpenAI: mockCreateOpenAI,
      }));

      const { getModel } = await import("./providerService.js");
      getModel();

      expect(mockProviderFn).toHaveBeenCalledWith("openai/gpt-4o");
    });

    it("passes OPENROUTER_API_KEY to the provider", async () => {
      process.env.OPENROUTER_API_KEY = "sk-or-test-key";
      vi.resetModules();
      vi.doMock("@ai-sdk/openai", () => ({
        createOpenAI: mockCreateOpenAI,
      }));

      const { getModel } = await import("./providerService.js");
      getModel();

      expect(mockCreateOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "sk-or-test-key",
        }),
      );
    });

    it("does not throw when OPENROUTER_API_KEY is missing", async () => {
      const { getModel } = await import("./providerService.js");
      expect(() => getModel()).not.toThrow();
      expect(mockCreateOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "",
        }),
      );
    });
  });

  describe("getWebSearchModel", () => {
    it("uses passed modelId when provided", async () => {
      const { getWebSearchModel } = await import("./providerService.js");
      getWebSearchModel("perplexity/sonar-reasoning");

      expect(mockProviderFn).toHaveBeenCalledWith("perplexity/sonar-reasoning");
    });

    it("falls back to WEB_SEARCH_MODEL env var", async () => {
      process.env.WEB_SEARCH_MODEL = "perplexity/sonar-deep-research";
      vi.resetModules();
      vi.doMock("@ai-sdk/openai", () => ({
        createOpenAI: mockCreateOpenAI,
      }));

      const { getWebSearchModel } = await import("./providerService.js");
      getWebSearchModel();

      expect(mockProviderFn).toHaveBeenCalledWith("perplexity/sonar-deep-research");
    });

    it("falls back to default when no modelId or env var", async () => {
      const { getWebSearchModel } = await import("./providerService.js");
      getWebSearchModel();

      expect(mockProviderFn).toHaveBeenCalledWith("perplexity/sonar-pro");
    });
  });

  describe("getEmbeddingModel", () => {
    it("returns an embedding model with hardcoded model ID", async () => {
      const { getEmbeddingModel } = await import("./providerService.js");
      const result = getEmbeddingModel();

      expect(mockProviderFn.embedding).toHaveBeenCalledWith("openai/text-embedding-3-small");
      expect(result).toBe(mockEmbeddingInstance);
    });
  });

  describe("OpenRouter headers", () => {
    it("includes HTTP-Referer and X-Title headers", async () => {
      const { getModel } = await import("./providerService.js");
      getModel();

      expect(mockCreateOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Title": "CulinAIre Kitchen",
          }),
        }),
      );
    });

    it("uses CLIENT_URL for HTTP-Referer when set", async () => {
      process.env.CLIENT_URL = "https://www.culinaire.kitchen";
      vi.resetModules();
      vi.doMock("@ai-sdk/openai", () => ({
        createOpenAI: mockCreateOpenAI,
      }));

      const { getModel } = await import("./providerService.js");
      getModel();

      expect(mockCreateOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            "HTTP-Referer": "https://www.culinaire.kitchen",
          }),
        }),
      );
    });
  });
});

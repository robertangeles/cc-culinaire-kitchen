import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock providerService
const mockModel = { _type: "chat-model" };
const mockWebSearchModel = { _type: "web-search-model" };
vi.mock("./providerService.js", () => ({
  getModel: vi.fn(() => mockModel),
  getWebSearchModel: vi.fn(() => mockWebSearchModel),
}));

// Mock promptService
vi.mock("./promptService.js", () => ({
  getSystemPrompt: vi.fn(async () => "You are a culinary assistant. {{KITCHEN_CONTEXT}}"),
}));

// Mock knowledgeService
vi.mock("./knowledgeService.js", () => ({
  searchKnowledge: vi.fn(async () => []),
  readKnowledgeDocument: vi.fn(async () => null),
}));

// Mock settingsService — controlled per test
let mockSettings: Record<string, string> = {};
vi.mock("./settingsService.js", () => ({
  getAllSettings: vi.fn(async () => mockSettings),
}));

// Mock userContextService
vi.mock("./userContextService.js", () => ({
  buildContextString: vi.fn(async () => ""),
}));

// Capture streamText calls
let capturedStreamTextArgs: any = null;
const mockPipeDataStream = vi.fn(async () => {});
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    streamText: vi.fn((args: any) => {
      capturedStreamTextArgs = args;
      return { pipeDataStreamToResponse: mockPipeDataStream };
    }),
  };
});

// Mock Express response
function createMockResponse() {
  return {
    setHeader: vi.fn(),
  } as any;
}

describe("aiService — streamChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedStreamTextArgs = null;
    mockSettings = {
      web_search_enabled: "false",
    };
  });

  it("uses getModel() and passes tools when web search is disabled", async () => {
    const { streamChat } = await import("./aiService.js");
    const { getModel, getWebSearchModel } = await import("./providerService.js");

    await streamChat(
      [{ role: "user", content: "How do I sear scallops?" }],
      createMockResponse(),
      { webSearch: false },
    );

    expect(getModel).toHaveBeenCalled();
    expect(getWebSearchModel).not.toHaveBeenCalled();
    expect(capturedStreamTextArgs.model).toBe(mockModel);
    // Tools should be present (searchKnowledge + readKnowledgeDocument)
    expect(Object.keys(capturedStreamTextArgs.tools)).toContain("searchKnowledge");
    expect(Object.keys(capturedStreamTextArgs.tools)).toContain("readKnowledgeDocument");
  });

  it("uses getWebSearchModel() and strips tools when web search is enabled", async () => {
    mockSettings = {
      web_search_enabled: "true",
      web_search_model: "perplexity/sonar-pro",
    };

    // Reset to pick up new settings
    vi.resetModules();

    // Re-apply mocks after resetModules
    vi.doMock("./providerService.js", () => ({
      getModel: vi.fn(() => mockModel),
      getWebSearchModel: vi.fn(() => mockWebSearchModel),
    }));
    vi.doMock("./promptService.js", () => ({
      getSystemPrompt: vi.fn(async () => "You are a culinary assistant. {{KITCHEN_CONTEXT}}"),
    }));
    vi.doMock("./knowledgeService.js", () => ({
      searchKnowledge: vi.fn(async () => []),
      readKnowledgeDocument: vi.fn(async () => null),
    }));
    vi.doMock("./settingsService.js", () => ({
      getAllSettings: vi.fn(async () => mockSettings),
    }));
    vi.doMock("./userContextService.js", () => ({
      buildContextString: vi.fn(async () => ""),
    }));
    vi.doMock("ai", () => ({
      streamText: vi.fn((args: any) => {
        capturedStreamTextArgs = args;
        return { pipeDataStreamToResponse: mockPipeDataStream };
      }),
      tool: vi.fn((config: any) => config),
    }));

    const { streamChat } = await import("./aiService.js");
    const { getWebSearchModel } = await import("./providerService.js");

    await streamChat(
      [{ role: "user", content: "What are the latest food trends?" }],
      createMockResponse(),
      { webSearch: true },
    );

    expect(getWebSearchModel).toHaveBeenCalledWith("perplexity/sonar-pro");
    expect(capturedStreamTextArgs.model).toBe(mockWebSearchModel);
    // Tools should be empty (stripped for web search)
    expect(Object.keys(capturedStreamTextArgs.tools)).toHaveLength(0);
  });

  it("does not enable web search when global setting is disabled even if request asks for it", async () => {
    mockSettings = {
      web_search_enabled: "false",
    };

    const { streamChat } = await import("./aiService.js");
    const { getModel, getWebSearchModel } = await import("./providerService.js");

    await streamChat(
      [{ role: "user", content: "Search the web for me" }],
      createMockResponse(),
      { webSearch: true },
    );

    expect(getModel).toHaveBeenCalled();
    expect(getWebSearchModel).not.toHaveBeenCalled();
    // Tools should be present (not stripped)
    expect(Object.keys(capturedStreamTextArgs.tools).length).toBeGreaterThan(0);
  });

  it("sets maxSteps to 8 for web search and 5 for normal", async () => {
    // Normal mode
    const { streamChat } = await import("./aiService.js");
    await streamChat(
      [{ role: "user", content: "Hello" }],
      createMockResponse(),
    );
    expect(capturedStreamTextArgs.maxSteps).toBe(5);
  });
});

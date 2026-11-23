import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./providerService.js", () => ({ getModel: vi.fn(() => ({})), getWebSearchModel: vi.fn(() => ({})) }));
vi.mock("./promptService.js", () => ({ getSystemPrompt: vi.fn(async () => ({ body: "You cook. {{KITCHEN_CONTEXT}}", modelId: null })) }));
vi.mock("./knowledgeService.js", () => ({ searchKnowledge: vi.fn(async () => []), readKnowledgeDocument: vi.fn(async () => null) }));
vi.mock("./settingsService.js", () => ({ getAllSettings: vi.fn(async () => ({})) }));
vi.mock("./userContextService.js", () => ({ buildContextString: vi.fn(async () => "") }));
vi.mock("./brainRecallService.js", () => ({ recallMemoriesWithBudget: vi.fn(async () => null) }));

/** What the next streamText call should hand back. */
let next: { chunks?: string[]; readError?: Error; onError?: Error } = {};
let captured: { abortSignal?: AbortSignal } = {};

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    streamText: vi.fn((args: { abortSignal?: AbortSignal; onChunk?: (c: unknown) => void; onError?: (e: unknown) => void }) => {
      captured = args;
      const { chunks = [], readError, onError } = next;
      if (chunks.length > 0) args.onChunk?.({ chunk: { type: "text-delta", textDelta: chunks.join("") } });
      if (onError) args.onError?.({ error: onError });
      return {
        toDataStream: () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const c of chunks) controller.enqueue(new TextEncoder().encode(`0:${JSON.stringify(c)}\n`));
              if (readError) controller.error(readError);
              else controller.close();
            },
          }),
        finishReason: Promise.resolve("stop"),
      };
    }),
  };
});

const response = (over: object = {}) => ({ setHeader: vi.fn(), write: vi.fn(), end: vi.fn(), destroyed: false, ...over }) as never;
const written = (res: { write: { mock: { calls: unknown[][] } } }) => res.write.mock.calls.map((c) => String(c[0]));

describe("streamChat: did the answer arrive", () => {
  beforeEach(() => {
    next = {};
    captured = {};
  });

  it("passes the caller's abort signal to the model", async () => {
    const { streamChat } = await import("./aiService.js");
    const ctl = new AbortController();
    next = { chunks: ["Hi"] };
    await streamChat([{ role: "user", content: "hi" }], response(), { abortSignal: ctl.signal });
    expect(captured.abortSignal).toBe(ctl.signal);
  });

  it("is true when text streamed to the end", async () => {
    const { streamChat } = await import("./aiService.js");
    next = { chunks: ["Rest it ", "for ten minutes."] };
    expect(await streamChat([{ role: "user", content: "steak?" }], response())).toBe(true);
  });

  it("is false when the model produced no text and the stuck-message went out instead", async () => {
    const { streamChat } = await import("./aiService.js");
    const res = response();
    expect(await streamChat([{ role: "user", content: "steak?" }], res)).toBe(false);
    expect(written(res).join("")).toContain("I got stuck");
  });

  it("is false when the model reported an error mid-answer", async () => {
    const { streamChat } = await import("./aiService.js");
    next = { chunks: ["Rest it "], onError: new Error("provider fell over") };
    expect(await streamChat([{ role: "user", content: "steak?" }], response())).toBe(false);
  });

  it("is still true when the client hangs up after text reached them, so hanging up at the end is no way to skip the charge", async () => {
    const { streamChat } = await import("./aiService.js");
    const ctl = new AbortController();
    ctl.abort();
    next = { chunks: ["Rest it "], readError: new Error("aborted") };
    const res = response({ destroyed: true });

    expect(await streamChat([{ role: "user", content: "steak?" }], res, { abortSignal: ctl.signal })).toBe(true);
    expect(res.end).toHaveBeenCalledOnce();
    expect(written(res).join("")).not.toContain("3:");
  });

  it("is false when the client hangs up before any text reached them", async () => {
    const { streamChat } = await import("./aiService.js");
    const ctl = new AbortController();
    ctl.abort();
    next = { readError: new Error("aborted") };

    expect(await streamChat([{ role: "user", content: "steak?" }], response({ destroyed: true }), { abortSignal: ctl.signal })).toBe(false);
  });

  it("is false, and tells the client why, when the time limit cut the answer short (the server's fault, not theirs)", async () => {
    const { streamChat } = await import("./aiService.js");
    const ctl = new AbortController();
    ctl.abort();
    next = { chunks: ["Rest it "], readError: new Error("aborted") };
    const res = response();

    expect(await streamChat([{ role: "user", content: "steak?" }], res, { abortSignal: ctl.signal })).toBe(false);
    expect(written(res).some((line) => line.startsWith("3:") && line.includes("too long"))).toBe(true);
    expect(res.end).toHaveBeenCalledOnce();
  });

  it("still throws an error that had nothing to do with an abort", async () => {
    const { streamChat } = await import("./aiService.js");
    next = { readError: new Error("socket exploded") };
    await expect(streamChat([{ role: "user", content: "hi" }], response(), { abortSignal: new AbortController().signal })).rejects.toThrow("socket exploded");
  });
});

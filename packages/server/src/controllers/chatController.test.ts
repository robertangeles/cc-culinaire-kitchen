import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Request, Response } from "express";

/**
 * A refused chat or image request answers in the shared ApiErrorBody shape: `error` is a sentence a client can
 * show, `code` is what it branches on, and the per-field detail sits apart under `details`.
 */
const streamChat = vi.fn();
vi.mock("../services/aiService.js", () => ({ streamChat: (...a: unknown[]) => streamChat(...a) }));
const generateImage = vi.fn();
vi.mock("../services/imageService.js", () => ({ generateImage: (...a: unknown[]) => generateImage(...a) }));
vi.mock("../services/activeOrgService.js", () => ({ resolveActiveOrg: vi.fn(async () => null) }));

const { handleChatStream, handleImageGeneration } = await import("./chatController.js");

describe.each([
  ["chat, sent the old single-message shape", handleChatStream, { message: "hi" }, "messages", streamChat],
  ["chat image, sent no prompt", handleImageGeneration, {}, "prompt", generateImage],
] as const)("%s", (_name, handler, body, field, model) => {
  it("answers 400 VALIDATION with a text error and the field detail under details, and calls no model", async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

    expect(await handler({ body } as Request, res, vi.fn())).toBe(false);

    expect(res.status).toHaveBeenCalledWith(400);
    const sent = vi.mocked(res.json).mock.calls[0][0] as { error: unknown; code: string; details: { fieldErrors: Record<string, string[]> } };
    expect(typeof sent.error).toBe("string");
    expect(sent.code).toBe("VALIDATION");
    expect(sent.details.fieldErrors[field]).toBeDefined();
    expect(model).not.toHaveBeenCalled();
  });
});

describe.each([
  ["chat, when the model fails before the stream starts", handleChatStream, { messages: [{ role: "user", content: "hi" }] }, streamChat, "401 Unauthorized: invalid API key sk-live-123"],
  ["chat image, when the provider fails", handleImageGeneration, { prompt: "a dish" }, generateImage, "Image generation failed (401): invalid API key sk-live-123"],
  ["chat image, when no provider key is set", handleImageGeneration, { prompt: "a dish" }, generateImage, "Image generation is not configured. OPENROUTER_API_KEY is missing."],
] as const)("%s", (_name, handler, body, model, providerText) => {
  it("hands the error handler a 503 AI_UNAVAILABLE that never repeats the provider's words, and earns no session", async () => {
    model.mockReset().mockRejectedValue(new Error(providerText));
    const res = Object.assign(new EventEmitter(), { writableFinished: false, status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }) as unknown as Response;
    const next = vi.fn();

    expect(await handler({ body } as Request, res, next)).toBe(false);

    const sent = next.mock.calls[0][0] as Error;
    expect(sent).toMatchObject({ statusCode: 503, code: "AI_UNAVAILABLE" });
    expect(sent.message).not.toMatch(/key|sk-live|401|configured/i);
    expect(res.json).not.toHaveBeenCalled();
  });
});

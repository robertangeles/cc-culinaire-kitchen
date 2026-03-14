import { describe, it, expect } from "vitest";
import {
  MessageRole,
  MessageSchema,
  ChatRequestSchema,
  ChatResponseSchema,
} from "./index.js";

describe("MessageRole", () => {
  it("accepts 'user' and 'assistant'", () => {
    expect(MessageRole.parse("user")).toBe("user");
    expect(MessageRole.parse("assistant")).toBe("assistant");
  });

  it("rejects invalid roles", () => {
    expect(() => MessageRole.parse("system")).toThrow();
    expect(() => MessageRole.parse("")).toThrow();
  });
});

describe("MessageSchema", () => {
  it("validates a correct message", () => {
    const msg = {
      id: "abc-123",
      conversationId: "conv-1",
      role: "user",
      content: "How do I sear scallops?",
      timestamp: "2025-01-01T00:00:00Z",
    };
    expect(MessageSchema.parse(msg)).toEqual(msg);
  });

  it("rejects missing content", () => {
    expect(() =>
      MessageSchema.parse({
        id: "abc",
        conversationId: "conv-1",
        role: "user",
        timestamp: "2025-01-01T00:00:00Z",
      }),
    ).toThrow();
  });

  it("rejects invalid timestamp format", () => {
    expect(() =>
      MessageSchema.parse({
        id: "abc",
        conversationId: "conv-1",
        role: "user",
        content: "test",
        timestamp: "not-a-date",
      }),
    ).toThrow();
  });
});

describe("ChatRequestSchema", () => {
  it("validates with message only", () => {
    const result = ChatRequestSchema.parse({ message: "Hello" });
    expect(result.message).toBe("Hello");
    expect(result.conversationId).toBeUndefined();
  });

  it("validates with message and conversationId", () => {
    const result = ChatRequestSchema.parse({
      message: "Hello",
      conversationId: "conv-1",
    });
    expect(result.conversationId).toBe("conv-1");
  });

  it("rejects empty message", () => {
    expect(() => ChatRequestSchema.parse({ message: "" })).toThrow();
  });
});

describe("ChatResponseSchema", () => {
  it("validates a correct response", () => {
    const data = {
      response: "Sear them hot",
      conversationId: "conv-1",
      sources: ["techniques/searing.md"],
    };
    expect(ChatResponseSchema.parse(data)).toEqual(data);
  });

  it("rejects missing sources array", () => {
    expect(() =>
      ChatResponseSchema.parse({
        response: "test",
        conversationId: "conv-1",
      }),
    ).toThrow();
  });
});

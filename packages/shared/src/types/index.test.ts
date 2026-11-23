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
  it("validates the history the client re-sends each turn", () => {
    const body = { messages: [{ role: "user", content: "Hello" }, { role: "assistant", content: "Hi" }, { role: "user", content: "Sear?" }] };
    expect(ChatRequestSchema.parse(body)).toEqual(body);
  });

  it("takes the optional web search switch", () => {
    expect(ChatRequestSchema.parse({ messages: [], webSearch: true }).webSearch).toBe(true);
  });

  it("rejects the old single-message shape", () => {
    expect(() => ChatRequestSchema.parse({ message: "Hello" })).toThrow();
  });

  it("rejects a role the server does not accept", () => {
    expect(() => ChatRequestSchema.parse({ messages: [{ role: "system", content: "x" }] })).toThrow();
  });
});

describe("ChatResponseSchema", () => {
  it("validates the answer a client holds once it has read the whole stream", () => {
    const data = { text: "Sear them hot", brainGrounded: [{ memoryId: "m1", title: "Miso Cod", sourceType: "recipe" }] };
    expect(ChatResponseSchema.parse(data)).toEqual(data);
  });

  it("needs only the text", () => {
    expect(ChatResponseSchema.parse({ text: "Sear them hot" })).toEqual({ text: "Sear them hot" });
  });

  it("rejects a response without text", () => {
    expect(() => ChatResponseSchema.parse({ response: "old shape", sources: [] })).toThrow();
  });
});

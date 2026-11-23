import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { ChatApi, SavedMessage, WireMessage } from "./chatApi";
import type { StreamEvent } from "./dataStream";
import { createChatStore } from "./chatStore";

/** An answer the test feeds part by part, so it can look at the screen state between parts. */
function controlledAnswer() {
  const queue: (StreamEvent | Error | "end")[] = [];
  let wake: (() => void) | null = null;
  const push = (x: StreamEvent | Error | "end") => {
    queue.push(x);
    wake?.();
  };
  async function* gen(signal: AbortSignal): AsyncGenerator<StreamEvent> {
    for (;;) {
      if (signal.aborted) throw new ApiError("aborted");
      const next = queue.shift();
      if (next === undefined) {
        await new Promise<void>((r) => {
          wake = r;
          signal.addEventListener("abort", () => r(), { once: true });
        });
        continue;
      }
      if (next === "end") return;
      if (next instanceof Error) throw next;
      yield next;
    }
  }
  return { push, gen };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const answers: ReturnType<typeof controlledAnswer>[] = [];
  const sent: WireMessage[][] = [];
  const signals: AbortSignal[] = [];
  const created: { id: string; title: string }[] = [];
  const saved: { id: string; messages: SavedMessage[] }[] = [];
  const api = {
    list: vi.fn(),
    get: vi.fn(async (id: string) => ({ conversationId: id, conversationTitle: "Fish", messages: [{ messageId: "u0", messageRole: "user" as const, messageBody: "Crisp skin?", messageSequence: 0 }, { messageId: "a0", messageRole: "assistant" as const, messageBody: "Dry it.", messageSequence: 1 }] })),
    create: vi.fn(async (id: string, title: string) => void created.push({ id, title })),
    save: vi.fn(async (id: string, messages: SavedMessage[]) => void saved.push({ id, messages })),
    remove: vi.fn(),
    answer: vi.fn((messages: WireMessage[], signal: AbortSignal) => {
      sent.push(messages);
      signals.push(signal);
      const a = controlledAnswer();
      answers.push(a);
      return a.gen(signal);
    }),
  } satisfies ChatApi;
  let n = 0;
  const store = createChatStore({ api, newId: () => `id${++n}` });
  return { store, api, answers, sent, signals, created, saved };
}

describe("chat store", () => {
  it("shows the answer as it streams in, then saves the new conversation with a title from the first question", async () => {
    const { store, answers, created, saved } = setup();
    const done = store.send("  How do I crisp fish skin?  ");
    await flush();
    expect(store.getSnapshot().phase).toBe("streaming");
    answers[0].push({ type: "text", text: "Pat it " });
    await flush();
    expect(store.getSnapshot().messages.map((m) => [m.role, m.text])).toEqual([["user", "How do I crisp fish skin?"], ["assistant", "Pat it "]]);
    answers[0].push({ type: "text", text: "dry." });
    answers[0].push("end");
    await done;
    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.messages[1].text).toBe("Pat it dry.");
    expect(created).toEqual([{ id: snap.conversationId, title: "How do I crisp fish skin?" }]);
    expect(saved[0].messages).toEqual([
      { messageId: snap.messages[0].id, messageRole: "user", messageBody: "How do I crisp fish skin?", messageSequence: 0 },
      { messageId: snap.messages[1].id, messageRole: "assistant", messageBody: "Pat it dry.", messageSequence: 1 },
    ]);
  });

  it("re-sends the whole history to the model each turn, and saves only the new messages under the same conversation", async () => {
    const { store, answers, sent, created, saved } = setup();
    let done = store.send("First");
    await flush();
    answers[0].push({ type: "text", text: "One." });
    answers[0].push("end");
    await done;
    done = store.send("Second");
    await flush();
    answers[1].push({ type: "text", text: "Two." });
    answers[1].push("end");
    await done;
    expect(sent[1]).toEqual([{ role: "user", content: "First" }, { role: "assistant", content: "One." }, { role: "user", content: "Second" }]);
    expect(created).toHaveLength(1);
    expect(saved[1].id).toBe(created[0].id);
    expect(saved[1].messages.map((m) => [m.messageSequence, m.messageBody])).toEqual([[2, "Second"], [3, "Two."]]);
  });

  it("cuts a long first question to 100 characters for the title", async () => {
    const { store, answers, created } = setup();
    const done = store.send(`${"a".repeat(120)}\nmore`);
    await flush();
    answers[0].push({ type: "text", text: "ok" });
    answers[0].push("end");
    await done;
    expect(created[0].title).toBe(`${"a".repeat(100)}…`);
  });

  it("marks an answer grounded in the kitchen's notes", async () => {
    const { store, answers } = setup();
    const done = store.send("Who supplies our fish?");
    await flush();
    answers[0].push({ type: "grounded", titles: ["Fish supplier", null] });
    answers[0].push({ type: "text", text: "Ocean Co." });
    answers[0].push("end");
    await done;
    expect(store.getSnapshot().messages[1].grounded).toEqual(["Fish supplier", null]);
  });

  it("stop keeps what arrived, ends the request and saves it", async () => {
    const { store, answers, signals, saved } = setup();
    const done = store.send("Long one");
    await flush();
    answers[0].push({ type: "text", text: "Half an" });
    await flush();
    store.stop();
    await done;
    expect(signals[0].aborted).toBe(true);
    const snap = store.getSnapshot();
    expect(snap).toMatchObject({ phase: "idle", stopped: true, failure: null });
    expect(snap.messages[1].text).toBe("Half an");
    expect(saved).toHaveLength(1);
  });

  it("stop before any text drops the empty answer and saves nothing", async () => {
    const { store, saved } = setup();
    const done = store.send("Anything");
    await flush();
    store.stop();
    await done;
    expect(store.getSnapshot().messages.map((m) => m.role)).toEqual(["user"]);
    expect(saved).toHaveLength(0);
  });

  it.each([
    [new ApiError("rate_limited", "x", 429, undefined, "RATE_LIMITED"), "You're sending messages too fast. Wait a minute, then try again.", true],
    [new ApiError("server", "x", 503, undefined, "AI_UNAVAILABLE"), "Antoine isn't available right now. Try again in a few minutes.", true],
    [new ApiError("server", "x", 504, undefined, "AI_TIMEOUT"), "That took too long. Try again.", true],
    [new ApiError("timeout"), "That took too long. Try again.", true],
    [new ApiError("network"), "Can't reach the server. Check your signal and try again.", true],
    [new ApiError("unauthorized", "x", 401, undefined, "UNAUTHENTICATED"), "You've been signed out. Sign in again to keep chatting.", false],
    [new ApiError("forbidden", "x", 403, undefined, "FREE_SESSIONS_EXHAUSTED"), "You've used all your free sessions.", false],
  ])("shows a refusal (%s) plainly, without a half answer", async (err, message, canRetry) => {
    const { store, answers, saved } = setup();
    const done = store.send("Hi");
    await flush();
    answers[0].push(err);
    await done;
    const snap = store.getSnapshot();
    expect(snap.failure).toEqual({ message, canRetry });
    expect(snap.messages.map((m) => m.role)).toEqual(["user"]);
    expect(saved).toHaveLength(0);
  });

  it("an error part mid-answer keeps the partial text on screen, and retry re-sends the same history without it", async () => {
    const { store, answers, sent } = setup();
    const done = store.send("Sauce?");
    await flush();
    answers[0].push({ type: "text", text: "Whisk" });
    answers[0].push({ type: "error", message: "An error occurred." });
    answers[0].push("end");
    await done;
    expect(store.getSnapshot().failure).toEqual({ message: "Antoine couldn't finish this answer. Try again.", canRetry: true });
    expect(store.getSnapshot().messages[1].text).toBe("Whisk");

    const again = store.retry();
    await flush();
    expect(sent[1]).toEqual([{ role: "user", content: "Sauce?" }]);
    expect(store.getSnapshot().failure).toBeNull();
    answers[1].push({ type: "text", text: "Whisk hard." });
    answers[1].push("end");
    await again;
    expect(store.getSnapshot().messages.map((m) => m.text)).toEqual(["Sauce?", "Whisk hard."]);
  });

  it("an answer that ends with no text at all is a failure, not an empty bubble", async () => {
    const { store, answers } = setup();
    const done = store.send("Hi");
    await flush();
    answers[0].push("end");
    await done;
    expect(store.getSnapshot().failure?.canRetry).toBe(true);
    expect(store.getSnapshot().messages).toHaveLength(1);
  });

  it("ignores a send while an answer is streaming, and an empty one", async () => {
    const { store, api } = setup();
    void store.send("One");
    await flush();
    await store.send("Two");
    await store.send("   ");
    expect(api.answer).toHaveBeenCalledTimes(1);
  });

  it("opens a saved conversation and keeps saving into it", async () => {
    const { store, answers, created, saved } = setup();
    await store.open("c9");
    expect(store.getSnapshot()).toMatchObject({ phase: "idle", conversationId: "c9", title: "Fish" });
    const done = store.send("And salt?");
    await flush();
    answers[0].push({ type: "text", text: "Just before." });
    answers[0].push("end");
    await done;
    expect(created).toHaveLength(0);
    expect(saved[0]).toMatchObject({ id: "c9" });
    expect(saved[0].messages.map((m) => [m.messageSequence, m.messageBody])).toEqual([[2, "And salt?"], [3, "Just before."]]);
  });

  it("says when a saved conversation cannot be opened", async () => {
    const { store, api } = setup();
    api.get.mockRejectedValueOnce(new ApiError("network"));
    await store.open("c9");
    expect(store.getSnapshot()).toMatchObject({ phase: "error", failure: { message: "Can't reach the server. Check your signal and try again.", canRetry: true } });
  });

  it("an answer that could not be saved says so, and the next save sends it again", async () => {
    const { store, api, answers, saved } = setup();
    api.save.mockRejectedValueOnce(new ApiError("network"));
    const done = store.send("One");
    await flush();
    answers[0].push({ type: "text", text: "A" });
    answers[0].push("end");
    await done;
    expect(store.getSnapshot().unsaved).toBe(true);
    await store.saveNow();
    expect(store.getSnapshot().unsaved).toBe(false);
    expect(saved).toHaveLength(1);
    expect(saved[0].messages.map((m) => m.messageBody)).toEqual(["One", "A"]);
    await store.saveNow();
    expect(saved).toHaveLength(1);
  });

  it("dispose stops an answer in flight", async () => {
    const { store, signals } = setup();
    void store.send("One");
    await flush();
    store.dispose();
    expect(signals[0].aborted).toBe(true);
  });
});

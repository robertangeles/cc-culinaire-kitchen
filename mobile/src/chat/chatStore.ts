/**
 * One conversation on screen: the messages, the answer streaming in, stop, retry and saving. The server keeps no chat state, so
 * every turn sends the whole history; the conversation is saved after each finished (or stopped) answer, the way the web does it.
 * A refusal is shown in plain words from the server's `code`, never its English text.
 */

import { ApiError } from "../api/client";
import type { ChatApi, WireMessage } from "./chatApi";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Titles of the kitchen notes the answer drew on (a title can be null): the "grounded in your kitchen" marker. */
  grounded?: (string | null)[];
}

export interface ChatFailure {
  message: string;
  /** False when trying again cannot help (signed out, free sessions used up). */
  canRetry: boolean;
}

export interface ChatSnapshot {
  /** Null until the first answer is saved. */
  conversationId: string | null;
  title: string;
  messages: ChatMessage[];
  phase: "loading" | "idle" | "streaming" | "error";
  failure: ChatFailure | null;
  /** The last answer was stopped by the person. */
  stopped: boolean;
  /** The last save did not reach the server (the next one sends everything again). */
  unsaved: boolean;
}

const TITLE_MAX = 100;
const STREAM_FAILED: ChatFailure = { message: "Antoine couldn't finish this answer. Try again.", canRetry: true };

/** What a refusal means for the person, from the server's code (and the client's for no signal or no reply). */
export function chatFailure(err: unknown): ChatFailure {
  if (!(err instanceof ApiError)) return STREAM_FAILED;
  if (err.hasCode("FREE_SESSIONS_EXHAUSTED")) return { message: "You've used all your free sessions.", canRetry: false };
  if (err.code === "unauthorized") return { message: "You've been signed out. Sign in again to keep chatting.", canRetry: false };
  if (err.hasCode("RATE_LIMITED") || err.code === "rate_limited") return { message: "You're sending messages too fast. Wait a minute, then try again.", canRetry: true };
  if (err.hasCode("AI_UNAVAILABLE")) return { message: "Antoine isn't available right now. Try again in a few minutes.", canRetry: true };
  if (err.hasCode("AI_TIMEOUT") || err.code === "timeout") return { message: "That took too long. Try again.", canRetry: true };
  if (err.code === "network") return { message: "Can't reach the server. Check your signal and try again.", canRetry: true };
  return { message: err.message, canRetry: true };
}

const titleOf = (question: string) => {
  const flat = question.replace(/\s*\n+\s*/g, " ").trim();
  return flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX)}…` : flat || "New conversation";
};

export function createChatStore({ api, newId }: { api: ChatApi; newId: () => string }) {
  let snapshot: ChatSnapshot = { conversationId: null, title: "", messages: [], phase: "idle", failure: null, stopped: false, unsaved: false };
  const listeners = new Set<() => void>();
  let controller: AbortController | null = null;

  const set = (next: Partial<ChatSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };
  const patchLast = (change: Partial<ChatMessage>) => {
    const messages = snapshot.messages.slice();
    messages[messages.length - 1] = { ...messages[messages.length - 1], ...change };
    set({ messages });
  };

  async function saveNow(): Promise<void> {
    const messages = snapshot.messages.filter((m) => m.text.trim() !== "");
    if (!messages.some((m) => m.role === "assistant")) return;
    try {
      let id = snapshot.conversationId;
      if (!id) {
        id = newId();
        const title = titleOf(messages[0].text);
        await api.create(id, title);
        set({ conversationId: id, title });
      }
      await api.save(id, messages.map((m, i) => ({ messageId: m.id, messageRole: m.role, messageBody: m.text, messageSequence: i })));
      set({ unsaved: false });
    } catch {
      set({ unsaved: true });
    }
  }

  /** Streams the answer to the history on screen (which ends with the person's question). */
  async function answer(): Promise<void> {
    const history: WireMessage[] = snapshot.messages.map((m) => ({ role: m.role, content: m.text }));
    controller = new AbortController();
    const signal = controller.signal;
    set({ phase: "streaming", failure: null, stopped: false, messages: [...snapshot.messages, { id: newId(), role: "assistant", text: "" }] });
    let failure: ChatFailure | null = null;
    try {
      for await (const event of api.answer(history, signal)) {
        const last = snapshot.messages[snapshot.messages.length - 1];
        if (event.type === "text") patchLast({ text: last.text + event.text });
        else if (event.type === "grounded") patchLast({ grounded: event.titles });
        else failure = STREAM_FAILED;
      }
    } catch (err) {
      if (!signal.aborted) failure = chatFailure(err);
    }
    controller = null;
    const stopped = signal.aborted;
    const gotText = snapshot.messages[snapshot.messages.length - 1].text.trim() !== "";
    if (!gotText && !stopped && !failure) failure = STREAM_FAILED;
    // A refusal before any text leaves no empty bubble; a failure partway keeps what arrived next to the message.
    set({ phase: "idle", failure, stopped, messages: gotText ? snapshot.messages : snapshot.messages.slice(0, -1) });
    if (!failure) await saveNow();
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,

    async open(conversationId: string): Promise<void> {
      set({ phase: "loading", failure: null });
      try {
        const detail = await api.get(conversationId);
        set({
          phase: "idle",
          conversationId,
          title: detail.conversationTitle,
          messages: detail.messages.map((m) => ({ id: m.messageId, role: m.messageRole, text: m.messageBody })),
        });
      } catch (err) {
        set({ phase: "error", failure: chatFailure(err) });
      }
    },

    async send(text: string): Promise<void> {
      const question = text.trim();
      if (!question || snapshot.phase === "streaming" || snapshot.phase === "loading") return;
      set({ messages: [...snapshot.messages, { id: newId(), role: "user", text: question }] });
      await answer();
    },

    /** After a failure: drop the half answer, if any, and ask again with the same history. */
    async retry(): Promise<void> {
      if (snapshot.phase !== "idle" || !snapshot.failure?.canRetry) return;
      const last = snapshot.messages[snapshot.messages.length - 1];
      if (last?.role === "assistant") set({ messages: snapshot.messages.slice(0, -1) });
      if (snapshot.messages[snapshot.messages.length - 1]?.role !== "user") return;
      await answer();
    },

    stop: () => controller?.abort(),
    saveNow,
    /** Leaving the screen stops an answer in flight (what arrived is still saved). */
    dispose: () => controller?.abort(),
  };
}

export type ChatStore = ReturnType<typeof createChatStore>;

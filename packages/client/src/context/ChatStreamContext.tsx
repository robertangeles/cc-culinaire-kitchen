/**
 * @module context/ChatStreamContext
 *
 * Manages background chat streams that persist across navigation.
 * When a user navigates away from a conversation while the AI is still
 * streaming a response, the stream is transferred here and continues
 * in the background. A notification banner appears when the response
 * is ready.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { UIMessage } from "ai";

const GUEST_TOKEN_KEY = "culinaire_guest_token";

/** Represents a chat stream running in the background. */
export interface BackgroundStream {
  conversationId: string;
  title: string;
  messages: UIMessage[];
  status: "streaming" | "ready" | "error";
  error?: string;
}

interface ChatStreamContextValue {
  /** Background streams keyed by conversation ID. */
  backgroundStreams: Map<string, BackgroundStream>;
  /** Conversation IDs with completed background responses ready for review. */
  completedStreamIds: string[];
  /** Transfer an active stream to the background when navigating away. */
  transferToBackground: (
    conversationId: string,
    title: string,
    currentMessages: UIMessage[],
    abortController: AbortController,
  ) => void;
  /** Get and clear a completed background stream (when returning to the conversation). */
  claimStream: (conversationId: string) => BackgroundStream | null;
  /** Dismiss a completed stream notification without navigating to it. */
  dismissStream: (conversationId: string) => void;
  /** Check if a conversation has a background stream. */
  hasBackgroundStream: (conversationId: string) => boolean;
}

const ChatStreamContext = createContext<ChatStreamContextValue>(
  null as unknown as ChatStreamContextValue,
);

/**
 * Provider that manages background chat streams. Should be placed
 * inside AuthProvider but above route-level components.
 */
export function ChatStreamProvider({ children }: { children: ReactNode }) {
  const [backgroundStreams, setBackgroundStreams] = useState<
    Map<string, BackgroundStream>
  >(new Map());

  // Refs for abort controllers so we can cancel background streams
  const abortRefs = useRef<Map<string, AbortController>>(new Map());

  // Keep a ref in sync with state so callbacks can read current streams
  // without closing over state (which would make them unstable references).
  const backgroundStreamsRef = useRef<Map<string, BackgroundStream>>(new Map());
  backgroundStreamsRef.current = backgroundStreams;

  const completedStreamIds = Array.from(backgroundStreams.entries())
    .filter(([, s]) => s.status === "ready" || s.status === "error")
    .map(([id]) => id);

  /**
   * Transfer an in-progress chat stream to the background.
   * Continues reading the SSE stream via raw fetch and updates
   * the background stream state as chunks arrive.
   */
  const transferToBackground = useCallback(
    (
      conversationId: string,
      title: string,
      currentMessages: UIMessage[],
      abortController: AbortController,
    ) => {
      // Store the abort controller
      abortRefs.current.set(conversationId, abortController);

      // Initialize the background stream with current messages
      setBackgroundStreams((prev) => {
        const next = new Map(prev);
        next.set(conversationId, {
          conversationId,
          title,
          messages: currentMessages,
          status: "streaming",
        });
        return next;
      });

      // Continue streaming in the background using raw fetch
      continueStreamInBackground(conversationId, currentMessages);
    },
    [],
  );

  /**
   * Continue reading a chat stream in the background.
   * Makes a new request to the chat API to get the remaining response.
   */
  async function continueStreamInBackground(
    conversationId: string,
    existingMessages: UIMessage[],
  ) {
    // Find the last user message to re-send as context
    const lastUserMsg = [...existingMessages]
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUserMsg) {
      markStreamComplete(conversationId, existingMessages, "error", "No user message found");
      return;
    }

    const guestToken = localStorage.getItem(GUEST_TOKEN_KEY);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (guestToken) headers["X-Guest-Token"] = guestToken;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          messages: existingMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
        signal: abortRefs.current.get(conversationId)?.signal,
      });

      if (!res.ok) {
        markStreamComplete(conversationId, existingMessages, "error", "Stream failed");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        markStreamComplete(conversationId, existingMessages, "error", "No response stream");
        return;
      }

      const decoder = new TextDecoder();
      let assistantContent = "";

      // Find if there's already a partial assistant message
      const lastMsg = existingMessages[existingMessages.length - 1];
      if (lastMsg?.role === "assistant") {
        assistantContent = lastMsg.content;
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        // Parse SSE data lines (Vercel AI SDK format)
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("0:")) {
            // Text chunk — extract the JSON string
            try {
              const text = JSON.parse(line.slice(2));
              assistantContent += text;
            } catch {
              // Non-JSON text chunk, append raw
              assistantContent += line.slice(2);
            }
          }
        }

        // Update the background stream with accumulated content
        const assistantMsg: UIMessage = {
          id: `bg-${conversationId}`,
          role: "assistant",
          content: assistantContent,
          parts: [{ type: "text", text: assistantContent }],
        };

        const updatedMessages = [
          ...existingMessages.filter((m) => m.role === "user"),
          assistantMsg,
        ];

        setBackgroundStreams((prev) => {
          const next = new Map(prev);
          const existing = next.get(conversationId);
          if (existing) {
            next.set(conversationId, {
              ...existing,
              messages: updatedMessages,
            });
          }
          return next;
        });
      }

      // Stream complete — build final messages
      const finalAssistantMsg: UIMessage = {
        id: `bg-${conversationId}`,
        role: "assistant",
        content: assistantContent,
        parts: [{ type: "text", text: assistantContent }],
      };

      const finalMessages = [
        ...existingMessages.filter((m) => m.role === "user"),
        finalAssistantMsg,
      ];

      markStreamComplete(conversationId, finalMessages, "ready");

      // Persist the response
      await persistBackgroundMessages(conversationId, finalMessages);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User cancelled — clean up
        setBackgroundStreams((prev) => {
          const next = new Map(prev);
          next.delete(conversationId);
          return next;
        });
        return;
      }
      markStreamComplete(
        conversationId,
        existingMessages,
        "error",
        err instanceof Error ? err.message : "Stream failed",
      );
    } finally {
      abortRefs.current.delete(conversationId);
    }
  }

  /** Mark a background stream as complete (ready or error). */
  function markStreamComplete(
    conversationId: string,
    messages: UIMessage[],
    status: "ready" | "error",
    error?: string,
  ) {
    setBackgroundStreams((prev) => {
      const next = new Map(prev);
      const existing = next.get(conversationId);
      if (existing) {
        next.set(conversationId, { ...existing, messages, status, error });
      }
      return next;
    });
  }

  /** Persist background stream messages to the conversations API. */
  async function persistBackgroundMessages(
    conversationId: string,
    messages: UIMessage[],
  ) {
    const guestToken = localStorage.getItem(GUEST_TOKEN_KEY);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (guestToken) headers["X-Guest-Token"] = guestToken;

    // Only persist the assistant message (user message was already persisted)
    const assistantMsgs = messages
      .filter((m) => m.role === "assistant")
      .map((m, i) => ({
        messageId: m.id,
        messageRole: m.role,
        messageBody: m.content,
        messageSequence: messages.length - 1 + i,
      }));

    if (assistantMsgs.length === 0) return;

    try {
      await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ messages: assistantMsgs }),
      });
    } catch {
      // Silent failure — user can reload to see persisted state
    }
  }

  /** Claim a completed background stream (used when returning to the conversation). */
  const claimStream = useCallback(
    (conversationId: string): BackgroundStream | null => {
      const stream = backgroundStreamsRef.current.get(conversationId);
      if (!stream) return null;

      setBackgroundStreams((prev) => {
        const next = new Map(prev);
        next.delete(conversationId);
        return next;
      });

      return stream;
    },
    [], // stable — reads from ref, not closed-over state
  );

  /** Dismiss a completed stream notification. */
  const dismissStream = useCallback((conversationId: string) => {
    setBackgroundStreams((prev) => {
      const next = new Map(prev);
      next.delete(conversationId);
      return next;
    });
    // Cancel if still streaming
    const controller = abortRefs.current.get(conversationId);
    if (controller) {
      controller.abort();
      abortRefs.current.delete(conversationId);
    }
  }, []);

  /** Check if a conversation has a background stream. */
  const hasBackgroundStream = useCallback(
    (conversationId: string) => backgroundStreamsRef.current.has(conversationId),
    [], // stable — reads from ref, not closed-over state
  );

  return (
    <ChatStreamContext.Provider
      value={{
        backgroundStreams,
        completedStreamIds,
        transferToBackground,
        claimStream,
        dismissStream,
        hasBackgroundStream,
      }}
    >
      {children}
    </ChatStreamContext.Provider>
  );
}

export function useChatStream() {
  const ctx = useContext(ChatStreamContext);
  if (!ctx)
    throw new Error("useChatStream must be used within ChatStreamProvider");
  return ctx;
}

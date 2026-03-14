/**
 * @module ChatContainer
 *
 * Core chat component that manages the conversation lifecycle using
 * the Vercel AI SDK's `useChat` hook. Handles message display, input,
 * streaming, image generation, and automatic persistence of conversations.
 *
 * When a conversation has no ID (new chat), the first user message
 * triggers creation of a conversation record. Subsequent messages
 * are appended to that conversation.
 */

import { useRef, useState, useCallback, useEffect, type FormEvent } from "react";
import { useNavigate, Link } from "react-router";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { MessageList } from "./MessageList.js";
import { MessageSkeleton } from "./MessageSkeleton.js";
import { ChatInput, type ChatMode } from "./ChatInput.js";
import { WelcomeScreen } from "./WelcomeScreen.js";
import { useConversationContext } from "../../context/ConversationContext.js";
import { useAuth } from "../../context/AuthContext.js";
import { useSettings } from "../../context/SettingsContext.js";
import { useChatStream } from "../../context/ChatStreamContext.js";

const GUEST_TOKEN_KEY = "culinaire_guest_token";

/** Build headers with guest token if present. */
function getGuestHeaders(): Record<string, string> {
  const token = localStorage.getItem(GUEST_TOKEN_KEY);
  return token ? { "X-Guest-Token": token } : {};
}

/** Props for {@link ChatContainer}. */
interface ChatContainerProps {
  /** Existing conversation UUID, or undefined for a new chat. */
  conversationId?: string;
  /** Messages to pre-load for an existing conversation. */
  initialMessages?: UIMessage[];
  /** True while the conversation history is being fetched — shows a skeleton instead of WelcomeScreen. */
  isLoadingHistory?: boolean;
}

/**
 * Generates a conversation title from the first user message.
 * Truncates to 100 characters and appends ellipsis if needed.
 */
function generateTitle(text: string): string {
  const cleaned = text.replace(/\n/g, " ").trim();
  return cleaned.length > 100 ? cleaned.slice(0, 100) + "…" : cleaned;
}

/**
 * Renders the full chat interface: welcome screen or message list,
 * plus the input bar. Persists new conversations and messages to the API.
 */
export function ChatContainer({
  conversationId,
  initialMessages = [],
  isLoadingHistory = false,
}: ChatContainerProps) {
  const navigate = useNavigate();
  const { refresh } = useConversationContext();
  const { isGuest, refreshGuestUsage, refreshUser } = useAuth();
  const { settings } = useSettings();
  const { transferToBackground, claimStream } = useChatStream();

  /** Web search toggle state (per-message opt-in). */
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);

  /** Chat mode: "chat" for normal AI chat, "image" for image generation. */
  const [chatMode, setChatMode] = useState<ChatMode>("chat");

  /** Whether image generation is currently in progress. */
  const [generatingImage, setGeneratingImage] = useState(false);

  /** Whether the web search toggle should be shown. */
  const showWebSearchToggle = settings.web_search_enabled === "true";

  /** Whether image generation is available (GEMINI_API_KEY configured). */
  const showImageToggle = settings.image_generation_enabled === "true";

  /** Tracks the active conversation ID (may be assigned after first message). */
  const convIdRef = useRef<string | undefined>(conversationId);

  /** Tracks how many messages have already been persisted. */
  const persistedCountRef = useRef(initialMessages.length);

  /**
   * Persists new messages (those not yet saved) to the conversations API.
   * On the very first user message of a new chat, creates the conversation
   * record first, then navigates to the new URL.
   */
  const persistMessages = useCallback(
    async (allMessages: UIMessage[]) => {
      const newMessages = allMessages.slice(persistedCountRef.current);
      if (newMessages.length === 0) return;

      // Track whether this is the very first save for a brand-new conversation,
      // so we know to navigate after the messages are committed.
      const isFirstPersist = persistedCountRef.current === 0 && !conversationId;

      // Create conversation record on first message
      if (!convIdRef.current) {
        const id = crypto.randomUUID();
        const firstUserMsg = newMessages.find((m) => m.role === "user");
        const title = firstUserMsg
          ? generateTitle(firstUserMsg.content)
          : "New Conversation";

        try {
          await fetch("/api/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getGuestHeaders() },
            body: JSON.stringify({ id, title }),
          });
          convIdRef.current = id;
          // Do NOT navigate yet — messages aren't saved; ChatPage would load an empty conversation
        } catch {
          return;
        }
      }

      // Save messages FIRST before navigating.
      // Filter out intermediate tool-call steps that have no visible text content
      // (empty content causes a 400 validation error from the server).
      const msgs = newMessages
        .filter((m) => typeof m.content === "string" && m.content.trim().length > 0)
        .map((m, i) => ({
          messageId: m.id,
          messageRole: m.role as "user" | "assistant",
          messageBody: m.content as string,
          messageSequence: persistedCountRef.current + i,
        }));

      if (msgs.length > 0) {
        try {
          const saveRes = await fetch(`/api/conversations/${convIdRef.current}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getGuestHeaders() },
            body: JSON.stringify({ messages: msgs }),
          });
          if (saveRes.ok) {
            persistedCountRef.current = allMessages.length;
          }
        } catch {
          // Silent failure — network error
        }
      }

      // Navigate only after messages are persisted AND we have an AI response.
      // Without this guard, a failed/empty stream would navigate the user to a stale
      // conversation URL that only contains their question.
      const hasAssistantMsg = msgs.some((m) => m.messageRole === "assistant");
      if (isFirstPersist && convIdRef.current && hasAssistantMsg) {
        // Pass current messages via router state so ChatPage can skip the API
        // round-trip and avoid the loading flash ("postback").
        navigate(`/chat/${convIdRef.current}`, {
          replace: true,
          state: {
            initialMessages: allMessages.filter(
              (m) => typeof m.content === "string" && m.content.trim().length > 0
            ),
          },
        });
        refresh();
      }
    },
    [navigate, refresh, conversationId]
  );

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit: chatHandleSubmit,
    setMessages,
    status,
    stop,
    append,
    error,
  } = useChat({
    api: "/api/chat",
    id: conversationId,
    initialMessages,
    headers: getGuestHeaders(),
    body: { webSearch: webSearchEnabled },
  });

  const isStreaming = status === "streaming" || status === "submitted" || generatingImage;

  // Keep refs to current values so the cleanup effect can access them
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  // On unmount: if still streaming, transfer to background context
  useEffect(() => {
    return () => {
      if (isStreamingRef.current && convIdRef.current) {
        const title = messagesRef.current.find((m) => m.role === "user")?.content ?? "Conversation";
        const truncatedTitle = title.length > 60 ? title.slice(0, 60) + "…" : title;
        transferToBackground(
          convIdRef.current,
          truncatedTitle,
          messagesRef.current,
          new AbortController(),
        );
      }
    };
  }, [transferToBackground]);

  /** Sends a welcome-screen prompt as a user message. */
  function handleSelectPrompt(prompt: string) {
    append({ role: "user", content: prompt });
  }

  /**
   * Handle image generation: sends the prompt to the image API,
   * then appends the user prompt and assistant response with the image.
   */
  async function handleImageGeneration(prompt: string) {
    setGeneratingImage(true);

    // Add user message immediately
    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
      parts: [{ type: "text", text: prompt }],
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch("/api/chat/image", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getGuestHeaders() },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errMsg = data.error ?? "Image generation failed. Please try again.";
        const assistantMsg: UIMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: errMsg,
          parts: [{ type: "text", text: errMsg }],
        };
        setMessages((prev) => [...prev, assistantMsg]);
        return;
      }

      const data = await res.json();
      const imageMarkdown = `![Generated image](${data.imageUrl})\n\nHere's the image I generated based on your prompt.`;
      const assistantMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: imageMarkdown,
        parts: [{ type: "text", text: imageMarkdown }],
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Persist after adding both messages
      const allMsgs = [...messages, userMsg, assistantMsg];
      await persistMessages(allMsgs);
      persistedCountRef.current = allMsgs.length;
      // Refresh session counter after image generation
      if (isGuest) {
        refreshGuestUsage();
      } else {
        refreshUser();
      }
    } catch {
      const errMsg = "Failed to generate image. Please try again.";
      const assistantMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: errMsg,
        parts: [{ type: "text", text: errMsg }],
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } finally {
      setGeneratingImage(false);
    }
  }

  /** Combined submit handler that routes to chat or image generation. */
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    if (chatMode === "image") {
      // Clear the input manually since we're not using useChat's submit
      const nativeEvent = new Event("input", { bubbles: true });
      const textarea = document.querySelector("textarea");
      if (textarea) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value"
        )?.set;
        nativeSetter?.call(textarea, "");
        textarea.dispatchEvent(nativeEvent);
      }
      handleImageGeneration(trimmed);
    } else {
      chatHandleSubmit(e);
    }
  }

  /**
   * When status transitions from "streaming" → "ready", persist new messages
   * and refresh the session counter in the sidebar.
   */
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (
      (prevStatusRef.current === "streaming" || prevStatusRef.current === "submitted") &&
      status === "ready" &&
      messages.length > 0
    ) {
      persistMessages(messages);
      if (isGuest) {
        refreshGuestUsage();
      } else {
        // Small delay so the DB decrement has committed before we re-fetch the count
        setTimeout(() => refreshUser(), 300);
      }
    }
    prevStatusRef.current = status;
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full">
      {error && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-700">
          {error.message?.includes("403") || error.message?.includes("free sessions") || error.message?.includes("upgrade") || error.message?.includes("register") ? (
            <div className="flex items-center justify-between">
              <span>You've used all your free sessions.</span>
              {isGuest ? (
                <Link to="/register" className="ml-2 font-medium text-amber-600 hover:text-amber-700 underline">
                  Register for free to continue
                </Link>
              ) : (
                <Link to="/profile" className="ml-2 font-medium text-amber-600 hover:text-amber-700 underline">
                  Upgrade to continue
                </Link>
              )}
            </div>
          ) : (
            "Something went wrong. Please try again."
          )}
        </div>
      )}

      {messages.length === 0 && isLoadingHistory ? (
        <MessageSkeleton />
      ) : messages.length === 0 ? (
        <WelcomeScreen onSelectPrompt={handleSelectPrompt} />
      ) : (
        <MessageList messages={messages} status={status} isGenerating={generatingImage} />
      )}

      <ChatInput
        input={input}
        onChange={handleInputChange}
        onSubmit={handleSubmit}
        onStop={stop}
        isStreaming={isStreaming}
        webSearchEnabled={webSearchEnabled}
        onToggleWebSearch={() => setWebSearchEnabled((v) => !v)}
        showWebSearchToggle={showWebSearchToggle}
        mode={chatMode}
        onToggleImageMode={() => setChatMode((m) => (m === "image" ? "chat" : "image"))}
        showImageToggle={showImageToggle}
      />
    </div>
  );
}

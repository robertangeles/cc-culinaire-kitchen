/**
 * @module MessageList
 * Displays the scrollable list of chat messages and a typing indicator
 * when the assistant is processing a response.
 *
 * Optimized for streaming:
 * - Uses "auto" scroll during streaming (no smooth animation lag)
 * - Debounces scroll calls to max once per 100ms during streaming
 * - Passes `isStreaming` to the last MessageBubble for throttled markdown rendering
 */

import { useEffect, useRef, useCallback } from "react";
import type { UIMessage } from "ai";
import { useSettings } from "../../context/SettingsContext.js";
import { MessageBubble } from "./MessageBubble.js";
import { TypingIndicator } from "./TypingIndicator.js";

interface MessageListProps {
  messages: UIMessage[];
  status: string;
  isGenerating?: boolean;
}

/** Debounce interval for scroll during streaming (ms). */
const SCROLL_DEBOUNCE_MS = 100;

export function MessageList({ messages, status, isGenerating }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { settings } = useSettings();
  const chatWidth = settings.chat_window_width
    ? `${settings.chat_window_width}px`
    : "48rem";

  const isActivelyStreaming = status === "streaming" || status === "submitted";

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({
      behavior: isActivelyStreaming ? "auto" : "smooth",
    });
  }, [isActivelyStreaming]);

  useEffect(() => {
    if (isActivelyStreaming) {
      // During streaming: debounce scroll to max once per 100ms
      if (!scrollTimer.current) {
        scrollToBottom();
        scrollTimer.current = setTimeout(() => {
          scrollTimer.current = null;
        }, SCROLL_DEBOUNCE_MS);
      }
    } else {
      // Not streaming: scroll immediately with smooth behavior
      scrollToBottom();
    }

    return () => {
      if (scrollTimer.current) {
        clearTimeout(scrollTimer.current);
        scrollTimer.current = null;
      }
    };
  }, [messages, status, scrollToBottom, isActivelyStreaming]);

  // Final smooth scroll when streaming ends
  useEffect(() => {
    if (status === "ready") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [status]);

  // Show "Prepping..." indicator when the AI is working
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const isWaiting =
    isGenerating ||
    status === "submitted" ||
    (status === "streaming" && lastMsg?.role === "user") ||
    (status === "streaming" && lastMsg?.role === "assistant" &&
      (!lastMsg.content || lastMsg.content.trim().length === 0));

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 mx-auto w-full">
      <div
        className="mx-auto flex flex-col gap-4"
        style={{ maxWidth: chatWidth }}
      >
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {isWaiting && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

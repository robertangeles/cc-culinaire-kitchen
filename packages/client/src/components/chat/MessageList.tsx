/**
 * @module MessageList
 * Displays the scrollable list of chat messages and a typing indicator
 * when the assistant is processing a response.
 */

import { useEffect, useRef } from "react";
import type { UIMessage } from "ai";
import { useSettings } from "../../context/SettingsContext.js";
import { MessageBubble } from "./MessageBubble.js";
import { TypingIndicator } from "./TypingIndicator.js";

/**
 * Props for the {@link MessageList} component.
 * @property messages - The array of chat messages to render.
 * @property status - The current chat status string (e.g. "submitted", "streaming", "ready").
 */
interface MessageListProps {
  messages: UIMessage[];
  status: string;
  /** True when image generation is in progress (outside useChat flow). */
  isGenerating?: boolean;
}

/**
 * Renders the chronological list of chat messages inside a scrollable container.
 *
 * Automatically scrolls to the bottom whenever messages change or the chat
 * status updates. Shows a {@link TypingIndicator} when a user message has been
 * submitted and the assistant has not yet begun responding.
 *
 * The maximum width of the message area is controlled by the
 * `chat_window_width` user setting.
 *
 * @param props - {@link MessageListProps}
 * @returns The rendered message list element.
 */
export function MessageList({ messages, status, isGenerating }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettings();
  const chatWidth = settings.chat_window_width
    ? `${settings.chat_window_width}px`
    : "48rem";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  // Show thinking indicator when submitted OR streaming-but-no-assistant-text-yet
  // (the "streaming" case catches tool-call steps where the AI is working but tokens haven't arrived)
  const isWaiting =
    isGenerating ||
    ((status === "submitted" || status === "streaming") &&
      messages.length > 0 &&
      messages[messages.length - 1].role === "user");

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

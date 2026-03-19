/**
 * @module MessageBubble
 * Renders an individual chat message as a styled bubble with an avatar icon,
 * distinguishing between user and assistant messages.
 *
 * Memoized to prevent re-rendering historical messages during streaming.
 */

import { memo } from "react";
import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChefHat, User } from "lucide-react";
import { useSettings } from "../../context/SettingsContext.js";

interface MessageBubbleProps {
  message: UIMessage;
}

function MessageBubbleInner({ message }: MessageBubbleProps) {
  const { settings } = useSettings();
  const bubbleMaxWidth = settings.chat_output_width
    ? `${settings.chat_output_width}%`
    : "75%";
  const isUser = message.role === "user";

  // Extract text content from message parts
  const textContent = message.parts
    ?.filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("") ?? message.content;

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`flex-shrink-0 size-8 rounded-full flex items-center justify-center ${
          isUser ? "bg-[#2A2A2A]" : "bg-[#D4A574]/20"
        }`}
      >
        {isUser ? (
          <User className="size-4 text-[#E5E5E5]" />
        ) : (
          <ChefHat className="size-4 text-[#D4A574]" />
        )}
      </div>

      <div
        className={`rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-[#D4A574]/10 border border-[#D4A574]/20 text-[#E5E5E5]"
            : "bg-[#161616] border border-[#2A2A2A] text-[#E5E5E5]"
        }`}
        style={{ maxWidth: bubbleMaxWidth }}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap leading-relaxed">{textContent}</p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-p:text-[#E5E5E5] prose-p:leading-relaxed prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-li:text-[#E5E5E5] prose-headings:mt-3 prose-headings:mb-1 prose-headings:text-[#FAFAFA] prose-strong:text-[#FAFAFA] prose-code:bg-[#0A0A0A] prose-code:border prose-code:border-[#2A2A2A] prose-code:rounded-md prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[#D4A574] prose-pre:bg-[#0A0A0A] prose-pre:border prose-pre:border-[#2A2A2A] prose-pre:rounded-xl prose-a:text-[#D4A574] prose-a:no-underline hover:prose-a:underline">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                img: ({ src, alt }) => (
                  <img
                    src={src}
                    alt={alt ?? "Generated image"}
                    className="rounded-lg max-w-full h-auto my-2 cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => src && window.open(src, "_blank")}
                  />
                ),
              }}
            >
              {textContent}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Memoized message bubble. Only re-renders when the message content changes.
 * Historical messages (whose content is stable) never re-render during streaming.
 */
export const MessageBubble = memo(MessageBubbleInner, (prev, next) => {
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content
  );
});

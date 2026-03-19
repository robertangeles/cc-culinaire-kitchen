/**
 * @module ChatInput
 * Provides the text input area, send/stop controls, and optional
 * web search and image generation toggles for the chat interface.
 */

import { type FormEvent, type KeyboardEvent } from "react";
import { SendHorizontal, Square, Globe, ImagePlus } from "lucide-react";
import { useSettings } from "../../context/SettingsContext.js";

/** Chat mode determines what happens when the user submits. */
export type ChatMode = "chat" | "image";

/**
 * Props for the {@link ChatInput} component.
 */
interface ChatInputProps {
  input: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: FormEvent) => void;
  onStop: () => void;
  isStreaming: boolean;
  /** Whether web search is toggled on for the next message. */
  webSearchEnabled?: boolean;
  /** Toggle web search on/off. */
  onToggleWebSearch?: () => void;
  /** Whether the web search toggle should be shown. */
  showWebSearchToggle?: boolean;
  /** Current chat mode. */
  mode?: ChatMode;
  /** Toggle image generation mode. */
  onToggleImageMode?: () => void;
  /** Whether image generation is available. */
  showImageToggle?: boolean;
}

/**
 * Renders the chat input form with a resizable textarea, optional toggles
 * for web search and image generation, and a context-sensitive action button.
 */
export function ChatInput({
  input,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  webSearchEnabled = false,
  onToggleWebSearch,
  showWebSearchToggle = false,
  mode = "chat",
  onToggleImageMode,
  showImageToggle = false,
}: ChatInputProps) {
  const { settings } = useSettings();
  const chatWidth = settings.chat_window_width
    ? `${settings.chat_window_width}px`
    : "48rem";
  const textareaHeight = settings.chat_window_height
    ? parseInt(settings.chat_window_height, 10)
    : undefined;

  const isImageMode = mode === "image";

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isStreaming) {
        onSubmit(e as unknown as FormEvent);
      }
    }
  }

  const placeholder = isImageMode
    ? "Describe the image you want to generate..."
    : "Ask about techniques, troubleshooting, ingredients...";

  return (
    <div className="border-t border-[#2A2A2A] bg-[#161616] px-4 py-3">
      <form
        onSubmit={onSubmit}
        className="mx-auto flex items-end gap-2"
        style={{ maxWidth: chatWidth }}
      >
        {/* Web Search Toggle */}
        {showWebSearchToggle && onToggleWebSearch && !isImageMode && (
          <button
            type="button"
            onClick={onToggleWebSearch}
            className={`flex-shrink-0 size-11 rounded-xl flex items-center justify-center transition-colors ${
              webSearchEnabled
                ? "bg-[#D4A574]/20 text-[#D4A574] hover:bg-[#D4A574]/30"
                : "bg-[#1E1E1E] text-[#666666] hover:bg-[#2A2A2A] hover:text-[#999999]"
            }`}
            title={webSearchEnabled ? "Web search enabled" : "Web search disabled"}
          >
            <Globe className="size-4" />
          </button>
        )}

        {/* Image Generation Toggle */}
        {showImageToggle && onToggleImageMode && (
          <button
            type="button"
            onClick={onToggleImageMode}
            className={`flex-shrink-0 size-11 rounded-xl flex items-center justify-center transition-colors ${
              isImageMode
                ? "bg-violet-500/20 text-violet-400 hover:bg-violet-500/30"
                : "bg-[#1E1E1E] text-[#666666] hover:bg-[#2A2A2A] hover:text-[#999999]"
            }`}
            title={isImageMode ? "Image generation mode" : "Switch to image generation"}
          >
            <ImagePlus className="size-4" />
          </button>
        )}

        <textarea
          value={input}
          onChange={onChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className={`flex-1 resize-none rounded-xl border px-4 py-3 text-white placeholder-[#444444] focus:outline-none focus:ring-2 focus:border-transparent ${
            isImageMode
              ? "border-violet-500/30 bg-[#0A0A0A] focus:ring-violet-500/50"
              : "border-[#2A2A2A] bg-[#0A0A0A] focus:ring-[#D4A574]/50"
          }`}
          style={textareaHeight ? { height: `${textareaHeight}px` } : undefined}
          disabled={isStreaming}
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            className="flex-shrink-0 size-11 rounded-xl bg-red-600 text-white flex items-center justify-center hover:bg-red-700 transition-colors opacity-90"
          >
            <Square className="size-4" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className={`flex-shrink-0 size-11 rounded-xl flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isImageMode
                ? "bg-violet-600 hover:bg-violet-700 text-white"
                : "bg-[#D4A574] hover:bg-[#C4956A] text-[#0A0A0A]"
            }`}
          >
            {isImageMode ? (
              <ImagePlus className="size-4" />
            ) : (
              <SendHorizontal className="size-4" />
            )}
          </button>
        )}
      </form>
    </div>
  );
}

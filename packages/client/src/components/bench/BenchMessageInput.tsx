/**
 * Message input for The Bench chat.
 * Supports @mention autocomplete — type @ to see matching users.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Send } from "lucide-react";
import type { PresenceUser } from "../../hooks/useBenchPresence.js";

interface BenchMessageInputProps {
  onSend: (body: string) => void;
  onTyping: () => void;
  disabled?: boolean;
  placeholder?: string;
  /** Online users for @mention autocomplete */
  onlineUsers?: PresenceUser[];
}

export function BenchMessageInput({ onSend, onTyping, disabled, placeholder, onlineUsers = [] }: BenchMessageInputProps) {
  const [text, setText] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<PresenceUser[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Detect @mention trigger
  useEffect(() => {
    if (mentionQuery === null) {
      setMentionResults([]);
      return;
    }
    const q = mentionQuery.toLowerCase();
    const matches = onlineUsers.filter((u) =>
      u.userName.toLowerCase().includes(q),
    ).slice(0, 6);
    setMentionResults(matches);
    setMentionIndex(0);
  }, [mentionQuery, onlineUsers]);

  function handleChange(value: string) {
    setText(value);
    onTyping();

    // Check for @mention trigger
    const cursorPos = inputRef.current?.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
    } else {
      setMentionQuery(null);
    }
  }

  function insertMention(userName: string) {
    const cursorPos = inputRef.current?.selectionStart ?? text.length;
    const textBeforeCursor = text.slice(0, cursorPos);
    const textAfterCursor = text.slice(cursorPos);
    const newBefore = textBeforeCursor.replace(/@\w*$/, `@${userName} `);
    setText(newBefore + textAfterCursor);
    setMentionQuery(null);
    inputRef.current?.focus();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText("");
    setMentionQuery(null);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Handle mention dropdown navigation
    if (mentionResults.length > 0 && mentionQuery !== null) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, mentionResults.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(mentionResults[mentionIndex].userName);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-[#2A2A2A] bg-[#161616] px-4 py-4 relative">
      {/* @mention autocomplete dropdown */}
      {mentionResults.length > 0 && mentionQuery !== null && (
        <div className="absolute bottom-full left-4 right-4 mb-1 bg-[#1E1E1E] rounded-lg shadow-lg border border-[#2A2A2A] py-1 z-20 max-h-48 overflow-y-auto">
          {mentionResults.map((u, i) => (
            <button
              key={u.userId}
              type="button"
              onClick={() => insertMention(u.userName)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                i === mentionIndex ? "bg-[#D4A574]/15 text-[#D4A574]" : "text-[#E5E5E5] hover:bg-[#2A2A2A]"
              }`}
            >
              {u.userPhotoPath ? (
                <img src={u.userPhotoPath} alt={u.userName} className="size-6 rounded-full object-cover" />
              ) : (
                <div className="size-6 rounded-full bg-[#D4A574]/15 flex items-center justify-center">
                  <span className="text-xs font-semibold text-[#D4A574]">{u.userName.charAt(0).toUpperCase()}</span>
                </div>
              )}
              <span className="font-medium">{u.userName}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder ?? "Type a message... Use @ to mention someone"}
          className="flex-1 px-4 py-3.5 text-base border border-[#2A2A2A] rounded-xl bg-[#0A0A0A] text-white placeholder-[#555555] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574]/50 disabled:opacity-50 disabled:cursor-not-allowed"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={!text.trim() || disabled}
          className="p-3 rounded-xl bg-[#D4A574] text-[#0A0A0A] hover:bg-[#C4956A] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Send className="size-5" />
        </button>
      </div>
    </form>
  );
}

/**
 * Scrollable message list for The Bench.
 * Auto-scrolls to bottom on new messages.
 * Infinite scroll up for history.
 */

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { BenchMessageItem } from "./BenchMessageItem.js";
import type { BenchMessage } from "../../hooks/useBenchMessages.js";

interface BenchMessageListProps {
  messages: BenchMessage[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onDelete: (messageId: string) => void;
  onEdit: (messageId: string, newBody: string) => void;
  onReaction: (messageId: string, emoji: string) => void;
  onRemoveReaction: (messageId: string, emoji: string) => void;
  /** Channel info banner shown at the top of the message list */
  channelBanner?: string;
  onStartDm?: (userId: number) => void;
}

export function BenchMessageList({
  messages,
  loading,
  hasMore,
  onLoadMore,
  onDelete,
  onEdit,
  onReaction,
  onRemoveReaction,
  onStartDm,
  channelBanner,
}: BenchMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const prevLengthRef = useRef(0);

  // Check if user is near the bottom
  function isNearBottom() {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }

  // Auto-scroll on new messages (if was already at bottom)
  useEffect(() => {
    if (messages.length > prevLengthRef.current && wasAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevLengthRef.current = messages.length;
  }, [messages.length]);

  // Scroll to bottom on initial load
  useEffect(() => {
    if (!loading && messages.length > 0) {
      bottomRef.current?.scrollIntoView();
    }
  }, [loading]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    wasAtBottomRef.current = isNearBottom();
    // Load more when scrolled to top
    if (el.scrollTop < 50 && hasMore && !loading) {
      onLoadMore();
    }
  }

  // Date separator helper
  function formatDateSeparator(dateStr: string) {
    const d = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }

  // Group messages by date
  let lastDate = "";

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto"
    >
      {/* Channel info banner */}
      {channelBanner && (
        <div className="mx-4 mt-4 mb-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs text-amber-800">{channelBanner}</p>
        </div>
      )}

      {loading && messages.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="size-6 animate-spin text-amber-600" />
        </div>
      ) : messages.length === 0 ? (
        <div className="flex items-center justify-center h-full text-stone-400 text-sm">
          No messages yet. Be the first to say something!
        </div>
      ) : (
        <div className="py-4">
          {hasMore && (
            <div className="text-center py-2">
              <button
                onClick={onLoadMore}
                className="text-xs text-amber-600 hover:text-amber-700"
              >
                Load older messages
              </button>
            </div>
          )}
          {messages.map((msg) => {
            const msgDate = new Date(msg.createdDttm).toDateString();
            let showSeparator = false;
            if (msgDate !== lastDate) {
              showSeparator = true;
              lastDate = msgDate;
            }
            return (
              <div key={msg.messageId}>
                {showSeparator && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 h-px bg-stone-200" />
                    <span className="text-xs text-stone-400 font-medium">
                      {formatDateSeparator(msg.createdDttm)}
                    </span>
                    <div className="flex-1 h-px bg-stone-200" />
                  </div>
                )}
                <BenchMessageItem
                  message={msg}
                  onDelete={onDelete}
                  onEdit={onEdit}
                  onReaction={onReaction}
                  onStartDm={onStartDm}
                  onRemoveReaction={onRemoveReaction}
                />
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

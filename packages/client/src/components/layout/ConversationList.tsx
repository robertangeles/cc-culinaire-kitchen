/**
 * @module ConversationList
 *
 * Sidebar component that renders a scrollable list of past conversations
 * with a "New Chat" button. Each entry shows the conversation title and
 * a relative date. Hover reveals a delete button.
 */

import { useNavigate, useParams } from "react-router";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { useConversationContext } from "../../context/ConversationContext.js";
import { useChatKey } from "../../App.js";
import type { Conversation } from "../../hooks/useConversations.js";

/**
 * Formats a timestamp into a short relative or absolute date string.
 *
 * @param iso - ISO 8601 timestamp string.
 * @returns Short date like "Today", "Yesterday", or "Mar 9".
 */
function formatShortDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Renders a single conversation entry in the sidebar.
 */
function ConversationItem({
  conv,
  isActive,
  onSelect,
  onDelete,
}: {
  conv: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`group w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left text-sm transition-colors ${
        isActive
          ? "bg-[#1E1E1E] text-white"
          : "text-[#999999] hover:text-white hover:bg-[#161616]"
      }`}
    >
      <div className="flex-1 min-w-0">
        <p className="truncate">{conv.conversationTitle}</p>
        <p className="text-[10px] text-[#666666] mt-0.5">
          {formatShortDate(conv.updatedDttm)}
        </p>
      </div>
      <span
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="hidden group-hover:flex items-center p-1 text-[#666666] hover:text-red-400 transition-colors"
      >
        <Trash2 className="size-3.5" />
      </span>
    </button>
  );
}

/**
 * Sidebar section showing "New Chat" button and scrollable conversation list.
 * Highlights the currently active conversation from the URL params.
 */
export function ConversationList() {
  const navigate = useNavigate();
  const { id: activeId } = useParams();
  const { conversations, isLoading, remove } = useConversationContext();
  const { incrementChatKey } = useChatKey();

  return (
    <div className="flex flex-col min-h-0">
      {/* New Chat button */}
      <div className="px-3 pt-2 pb-1">
        <button
          onClick={() => { incrementChatKey(); navigate("/chat/new"); }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-[#999999] hover:text-white hover:bg-[#161616] transition-colors"
        >
          <Plus className="size-4" />
          New Chat
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-3 py-1 space-y-0.5">
        {isLoading && (
          <div className="flex justify-center py-4">
            <Loader2 className="size-4 animate-spin text-[#666666]" />
          </div>
        )}
        {!isLoading &&
          conversations.map((conv) => (
            <ConversationItem
              key={conv.conversationId}
              conv={conv}
              isActive={conv.conversationId === activeId}
              onSelect={() => navigate(`/chat/${conv.conversationId}`)}
              onDelete={async () => {
                await remove(conv.conversationId);
                // If deleting the active conversation, redirect to new chat.
                // Check both React Router params AND the actual browser URL,
                // since the URL may have been updated via replaceState.
                const currentPath = window.location.pathname;
                if (
                  conv.conversationId === activeId ||
                  currentPath === `/chat/${conv.conversationId}`
                ) {
                  // Navigate without page reload — use navigate + key trick
                  // to force React Router to remount even if path hasn't changed
                  navigate("/chat/new", { replace: true });
                }
              }}
            />
          ))}
      </div>
    </div>
  );
}

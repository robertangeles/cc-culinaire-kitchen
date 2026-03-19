/**
 * List of DM threads for The Bench Messages tab.
 */

import { Loader2, MessageCircle } from "lucide-react";
import type { DmThread } from "../../hooks/useBenchDm.js";

interface BenchDmThreadListProps {
  threads: DmThread[];
  loading: boolean;
  onSelect: (threadId: number) => void;
}

export function BenchDmThreadList({ threads, loading, onSelect }: BenchDmThreadListProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-[#D4A574]" />
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-[#666666]">
        <MessageCircle className="size-10 mb-3 text-[#666666]" />
        <p className="text-sm">No conversations yet</p>
        <p className="text-xs mt-1 text-[#666666]">Click on a chef's name in the chat to start a direct message</p>
      </div>
    );
  }

  function timeAgo(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diff < 60) return "now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  }

  return (
    <div className="divide-y divide-[#2A2A2A]">
      {threads.map((t) => (
        <button
          key={t.dmThreadId}
          onClick={() => onSelect(t.dmThreadId)}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#1E1E1E] transition-colors text-left"
        >
          {t.otherUserPhotoPath ? (
            <img
              src={t.otherUserPhotoPath}
              alt={t.otherUserName}
              className="size-10 rounded-full object-cover flex-shrink-0"
            />
          ) : (
            <div className="size-10 rounded-full bg-[#D4A574]/15 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-semibold text-[#D4A574]">
                {t.otherUserName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[#FAFAFA] truncate">{t.otherUserName}</span>
              <span className="text-xs text-[#666666] flex-shrink-0">{timeAgo(t.lastMessageAt)}</span>
            </div>
            {t.lastMessage && (
              <p className="text-xs text-[#999999] truncate">{t.lastMessage}</p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

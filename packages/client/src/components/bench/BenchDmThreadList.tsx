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
        <Loader2 className="size-5 animate-spin text-gold" />
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4">
        <MessageCircle className="size-12 mb-4 text-gold/40" />
        <p className="text-base text-dark-600 font-medium mb-1">No conversations yet</p>
        <p className="text-sm text-dark-500">Click on a chef&apos;s name in the chat to start a direct message</p>
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
    <div className="divide-y divide-dark-200">
      {threads.map((t) => (
        <button
          key={t.dmThreadId}
          onClick={() => onSelect(t.dmThreadId)}
          className="w-full flex items-center gap-3.5 px-4 py-3.5 hover:bg-dark-100 transition-colors text-left"
        >
          {t.otherUserPhotoPath ? (
            <img
              src={t.otherUserPhotoPath}
              alt={t.otherUserName}
              className="size-10 rounded-full object-cover flex-shrink-0"
            />
          ) : (
            <div className="size-10 rounded-full bg-gold/15 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-semibold text-gold">
                {t.otherUserName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-semibold text-[#FAFAFA] truncate">{t.otherUserName}</span>
              <span className="text-xs text-dark-500 flex-shrink-0 ml-2">{timeAgo(t.lastMessageAt)}</span>
            </div>
            {t.lastMessage && (
              <p className="text-sm text-dark-600 truncate mt-0.5">{t.lastMessage}</p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

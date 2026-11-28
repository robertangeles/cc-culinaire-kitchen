/**
 * DM conversation view — header with recipient info + message list + input.
 * Reuses BenchMessageItem for edit, delete, reactions, report and block.
 */

import { useEffect, useRef } from "react";
import { ArrowLeft, Loader2, MoreVertical } from "lucide-react";
import { BenchMessageInput } from "./BenchMessageInput.js";
import { BenchMessageItem } from "./BenchMessageItem.js";
import type { DmMessage, DmThread } from "../../hooks/useBenchDm.js";
import type { BenchMessage, RefusedPost } from "../../hooks/useBenchMessages.js";
import { useBenchSocket } from "../../context/BenchSocketContext.js";
import type { BenchPerson, ReportTarget } from "../../hooks/useBenchSafety.js";
import { BenchPersonMenu } from "./BenchPersonMenu.js";

interface BenchDmConversationProps {
  thread: DmThread;
  messages: DmMessage[];
  loading: boolean;
  onSend: (recipientId: number, body: string) => void;
  onBack: () => void;
  onReport?: (target: ReportTarget) => void;
  onBlock?: (person: BenchPerson) => void;
  returned?: RefusedPost | null;
  onReturned?: () => void;
}

/** Convert DmMessage to BenchMessage shape for BenchMessageItem */
function toBenchMessage(msg: DmMessage): BenchMessage {
  return {
    messageId: msg.messageId,
    channelId: msg.dmThreadId,
    userId: msg.userId,
    userName: msg.userName,
    userPhotoPath: msg.userPhotoPath,
    messageBody: msg.messageBody,
    messageType: "text",
    recipeId: null,
    editedInd: msg.editedInd,
    deletedInd: msg.deletedInd,
    createdDttm: msg.createdDttm,
    reactions: [],
  };
}

export function BenchDmConversation({ thread, messages, loading, onSend, onBack, onReport, onBlock, returned, onReturned }: BenchDmConversationProps) {
  const { socket } = useBenchSocket();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  function handleDelete(messageId: string) {
    if (!socket?.connected) return;
    socket.emit("bench:message:delete", { messageId, channelKey: `dm_${thread.dmThreadId}` });
  }

  function handleEdit(messageId: string, newBody: string) {
    if (!socket?.connected) return;
    socket.emit("bench:message:edit", { messageId, channelKey: `dm_${thread.dmThreadId}`, newBody });
  }

  function handleReaction(messageId: string, emoji: string) {
    if (!socket?.connected) return;
    socket.emit("bench:reaction:add", { messageId, emoji });
  }

  function handleRemoveReaction(messageId: string, emoji: string) {
    if (!socket?.connected) return;
    socket.emit("bench:reaction:remove", { messageId, emoji });
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-200 bg-dark-50">
        <button onClick={onBack} aria-label="Back" className="p-1 rounded hover:bg-dark-200 text-dark-600">
          <ArrowLeft className="size-5" />
        </button>
        {thread.otherUserPhotoPath ? (
          <img src={thread.otherUserPhotoPath} alt={thread.otherUserName} className="size-9 rounded-full object-cover" />
        ) : (
          <div className="size-9 rounded-full bg-gold/15 flex items-center justify-center">
            <span className="text-base font-semibold text-gold">{thread.otherUserName.charAt(0).toUpperCase()}</span>
          </div>
        )}
        <span className="flex-1 text-[15px] font-semibold text-[#FAFAFA]">{thread.otherUserName}</span>
        {(onReport || onBlock) && (
          <BenchPersonMenu
            person={{ userId: thread.otherUserId, userName: thread.otherUserName, userPhotoPath: thread.otherUserPhotoPath }}
            onReport={onReport}
            onBlock={onBlock}
            label={`${thread.otherUserName}: options`}
            alignRight
            triggerClassName="p-1.5 rounded-lg text-dark-600 hover:bg-dark-200 hover:text-[#FAFAFA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 transition-colors"
          >
            <MoreVertical className="size-5" />
          </BenchPersonMenu>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-dark">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-5 animate-spin text-gold" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <p className="text-base text-dark-600 font-medium mb-1">Start the conversation</p>
            <p className="text-sm text-dark-500">Say hello to {thread.otherUserName}!</p>
          </div>
        ) : (
          <div className="py-4">
            {messages.map((msg) => (
              <BenchMessageItem
                key={msg.messageId}
                message={toBenchMessage(msg)}
                onDelete={handleDelete}
                onEdit={handleEdit}
                onReaction={handleReaction}
                onRemoveReaction={handleRemoveReaction}
                onReport={onReport}
                onBlock={onBlock}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <BenchMessageInput
        onSend={(body) => onSend(thread.otherUserId, body)}
        onTyping={() => {}}
        placeholder={`Message ${thread.otherUserName}...`}
        returned={returned}
        onReturned={onReturned}
      />
    </div>
  );
}

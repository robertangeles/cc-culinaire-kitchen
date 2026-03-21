/**
 * DM conversation view — header with recipient info + message list + input.
 * Reuses BenchMessageItem for edit, delete, and reactions.
 */

import { useEffect, useRef } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { BenchMessageInput } from "./BenchMessageInput.js";
import { BenchMessageItem } from "./BenchMessageItem.js";
import type { DmMessage, DmThread } from "../../hooks/useBenchDm.js";
import type { BenchMessage } from "../../hooks/useBenchMessages.js";
import { useBenchSocket } from "../../context/BenchSocketContext.js";

interface BenchDmConversationProps {
  thread: DmThread;
  messages: DmMessage[];
  loading: boolean;
  onSend: (recipientId: number, body: string) => void;
  onBack: () => void;
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

export function BenchDmConversation({ thread, messages, loading, onSend, onBack }: BenchDmConversationProps) {
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
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#2A2A2A] bg-[#161616]">
        <button onClick={onBack} className="p-1 rounded hover:bg-[#2A2A2A] text-[#999999]">
          <ArrowLeft className="size-5" />
        </button>
        {thread.otherUserPhotoPath ? (
          <img src={thread.otherUserPhotoPath} alt={thread.otherUserName} className="size-9 rounded-full object-cover" />
        ) : (
          <div className="size-9 rounded-full bg-[#D4A574]/15 flex items-center justify-center">
            <span className="text-base font-semibold text-[#D4A574]">{thread.otherUserName.charAt(0).toUpperCase()}</span>
          </div>
        )}
        <span className="text-[15px] font-semibold text-[#FAFAFA]">{thread.otherUserName}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-[#0A0A0A]">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-5 animate-spin text-[#D4A574]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <p className="text-base text-[#999999] font-medium mb-1">Start the conversation</p>
            <p className="text-sm text-[#666666]">Say hello to {thread.otherUserName}!</p>
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
      />
    </div>
  );
}

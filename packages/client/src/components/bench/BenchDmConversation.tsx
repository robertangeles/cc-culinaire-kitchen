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
      <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-200 bg-white">
        <button onClick={onBack} className="p-1 rounded hover:bg-stone-100 text-stone-500">
          <ArrowLeft className="size-5" />
        </button>
        {thread.otherUserPhotoPath ? (
          <img src={thread.otherUserPhotoPath} alt={thread.otherUserName} className="size-8 rounded-full object-cover" />
        ) : (
          <div className="size-8 rounded-full bg-amber-100 flex items-center justify-center">
            <span className="text-sm font-semibold text-amber-700">{thread.otherUserName.charAt(0).toUpperCase()}</span>
          </div>
        )}
        <span className="text-sm font-semibold text-stone-800">{thread.otherUserName}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-5 animate-spin text-amber-600" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-stone-400 text-sm">
            Start the conversation — say hello!
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

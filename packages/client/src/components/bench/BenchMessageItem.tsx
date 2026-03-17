/**
 * Single message in The Bench chat.
 * Shows avatar, name, timestamp, message body, reactions.
 * Own messages can be edited (inline) and deleted.
 */

import { useState, useRef, useEffect } from "react";
import { Trash2, SmilePlus, Pencil, Check, X } from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "../../context/AuthContext.js";
import type { BenchMessage } from "../../hooks/useBenchMessages.js";

const EMOJI_SET = [
  { key: "fire", display: "🔥" },
  { key: "chef", display: "👨‍🍳" },
  { key: "thumbsup", display: "👍" },
  { key: "heart", display: "❤️" },
  { key: "clap", display: "👏" },
  { key: "hundred", display: "💯" },
  { key: "eyes", display: "👀" },
  { key: "sparkles", display: "✨" },
];

const EMOJI_MAP: Record<string, string> = {};
for (const e of EMOJI_SET) EMOJI_MAP[e.key] = e.display;

interface BenchMessageItemProps {
  message: BenchMessage;
  onDelete?: (messageId: string) => void;
  onEdit?: (messageId: string, newBody: string) => void;
  onReaction?: (messageId: string, emoji: string) => void;
  onRemoveReaction?: (messageId: string, emoji: string) => void;
  onStartDm?: (userId: number) => void;
}

export function BenchMessageItem({ message, onDelete, onEdit, onReaction, onRemoveReaction, onStartDm }: BenchMessageItemProps) {
  const { user } = useAuth();
  const [showReactions, setShowReactions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const editRef = useRef<HTMLInputElement>(null);
  const isOwn = user?.userId === message.userId;

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.setSelectionRange(editText.length, editText.length);
    }
  }, [editing]);

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function startEdit() {
    setEditText(message.messageBody);
    setEditing(true);
  }

  function saveEdit() {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== message.messageBody) {
      onEdit?.(message.messageId, trimmed);
    }
    setEditing(false);
  }

  function cancelEdit() {
    setEditing(false);
    setEditText("");
  }

  function handleEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  }

  return (
    <div className="group relative flex gap-3 px-4 py-2 hover:bg-stone-50 transition-colors">
      {/* Avatar */}
      {message.userPhotoPath ? (
        <img
          src={message.userPhotoPath}
          alt={message.userName}
          className="size-9 rounded-full object-cover flex-shrink-0 mt-0.5"
        />
      ) : (
        <div className="size-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
          <span className="text-sm font-semibold text-amber-700">
            {message.userName.charAt(0).toUpperCase()}
          </span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          {!isOwn && onStartDm ? (
            <button
              onClick={() => onStartDm(message.userId)}
              className="text-sm font-semibold text-stone-800 hover:text-amber-700 transition-colors"
              title={`Message ${message.userName}`}
            >
              {message.userName}
            </button>
          ) : (
            <span className="text-sm font-semibold text-stone-800">{message.userName}</span>
          )}
          <span className="text-xs text-stone-400">{formatTime(message.createdDttm)}</span>
          {message.editedInd && <span className="text-xs text-stone-400 italic">(edited)</span>}
        </div>

        {/* Message body or edit input */}
        {editing ? (
          <div className="mt-1 flex items-center gap-2">
            <input
              ref={editRef}
              type="text"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleEditKeyDown}
              maxLength={5000}
              className="flex-1 px-3 py-1.5 text-sm border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50"
            />
            <button onClick={saveEdit} className="p-1 rounded hover:bg-green-100 text-green-600" title="Save">
              <Check className="size-4" />
            </button>
            <button onClick={cancelEdit} className="p-1 rounded hover:bg-stone-200 text-stone-400" title="Cancel (Esc)">
              <X className="size-4" />
            </button>
          </div>
        ) : message.messageType === "recipe_share" && message.recipeSlug ? (
          <Link
            to={`/kitchen-shelf/${message.recipeSlug}`}
            className="mt-1 block bg-amber-50 border border-amber-200 rounded-lg p-3 hover:bg-amber-100 transition-colors max-w-md"
          >
            <div className="flex gap-3">
              {message.recipeImageUrl && (
                <img
                  src={message.recipeImageUrl}
                  alt={message.recipeTitle ?? "Recipe"}
                  className="size-16 rounded-lg object-cover flex-shrink-0"
                />
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-900 truncate">
                  {message.recipeTitle ?? "Shared Recipe"}
                </p>
                {message.messageBody && (
                  <p className="text-xs text-stone-600 line-clamp-2 mt-0.5">{message.messageBody}</p>
                )}
              </div>
            </div>
          </Link>
        ) : (
          <p className="text-sm text-stone-700 whitespace-pre-wrap break-words">{message.messageBody}</p>
        )}

        {/* Reactions */}
        {message.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {message.reactions.map((r) => {
              const hasReacted = user ? r.userIds.includes(user.userId) : false;
              return (
                <button
                  key={r.emoji}
                  onClick={() => {
                    if (hasReacted) {
                      onRemoveReaction?.(message.messageId, r.emoji);
                    } else {
                      onReaction?.(message.messageId, r.emoji);
                    }
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                    hasReacted
                      ? "bg-amber-100 border-amber-300 text-amber-800"
                      : "bg-stone-50 border-stone-200 text-stone-600 hover:border-amber-300"
                  }`}
                >
                  <span>{EMOJI_MAP[r.emoji] ?? r.emoji}</span>
                  <span>{r.count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Action buttons (visible on hover) */}
      {!editing && (
        <div className="flex items-start gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setShowReactions(!showReactions)}
            className="p-1 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-600 transition-colors"
            title="React"
          >
            <SmilePlus className="size-4" />
          </button>
          {isOwn && onEdit && message.messageType === "text" && (
            <button
              onClick={startEdit}
              className="p-1 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-600 transition-colors"
              title="Edit"
            >
              <Pencil className="size-4" />
            </button>
          )}
          {(isOwn || user?.roles?.includes("Administrator")) && onDelete && (
            <button
              onClick={() => onDelete(message.messageId)}
              className="p-1 rounded hover:bg-stone-200 text-stone-400 hover:text-red-500 transition-colors"
              title="Delete"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      )}

      {/* Emoji picker popup */}
      {showReactions && (
        <div className="absolute right-12 top-8 bg-white rounded-lg shadow-lg border border-stone-200 p-2 flex gap-1 z-10">
          {EMOJI_SET.map((e) => (
            <button
              key={e.key}
              onClick={() => {
                onReaction?.(message.messageId, e.key);
                setShowReactions(false);
              }}
              className="p-1.5 rounded hover:bg-stone-100 text-lg transition-colors"
              title={e.key}
            >
              {e.display}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * @module components/chat/ConversationInfoPanel
 *
 * Right-side panel showing metadata for the current conversation:
 * editable title, created/updated dates, message count, and a delete action.
 *
 * Rendered alongside ChatContainer in ChatPage when an existing conversation
 * is loaded. Hidden on /chat/new.
 */

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import {
  MessageSquare,
  Calendar,
  Clock,
  Pencil,
  Check,
  X,
  Trash2,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useConversationContext } from "../../context/ConversationContext.js";

/** Props for {@link ConversationInfoPanel}. */
interface ConversationInfoPanelProps {
  /** UUID of the current conversation. */
  conversationId: string;
  /** Current conversation title. */
  title: string;
  /** ISO timestamp — conversation created date. */
  createdAt: string;
  /** ISO timestamp — conversation last updated. */
  updatedAt: string;
  /** Total number of messages in the conversation. */
  messageCount: number;
  /** Called after the title is changed so the parent can reflect the new title. */
  onTitleChange: (newTitle: string) => void;
}

/**
 * Formats an ISO timestamp as a localised date-time string.
 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A single info row: icon + label above value.
 */
function InfoBlock({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MessageSquare;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 text-xs text-stone-400 uppercase tracking-wider">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="text-sm text-stone-700 pl-5">{value}</p>
    </div>
  );
}

/**
 * Renders the right-side conversation info panel.
 */
export function ConversationInfoPanel({
  conversationId,
  title,
  createdAt,
  updatedAt,
  messageCount,
  onTitleChange,
}: ConversationInfoPanelProps) {
  const navigate = useNavigate();
  const { remove, refresh } = useConversationContext();

  // Title editing
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(title);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Delete
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSaveTitle(e: FormEvent) {
    e.preventDefault();
    const trimmed = editTitle.trim();
    if (!trimmed || trimmed === title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const guestToken = localStorage.getItem("culinaire_guest_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (guestToken) headers["X-Guest-Token"] = guestToken;

      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error("Failed to update title");
      onTitleChange(trimmed);
      refresh();
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await remove(conversationId);
      navigate("/chat/new");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <aside className="w-72 flex-shrink-0 border-l border-stone-200 bg-stone-50 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-stone-200">
        <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
          Conversation Info
        </h2>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 py-4 space-y-5">
        {/* Title */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-stone-400 uppercase tracking-wider">Title</span>
            {!editing && (
              <button
                onClick={() => {
                  setEditTitle(title);
                  setSaveError("");
                  setEditing(true);
                }}
                className="p-0.5 text-stone-400 hover:text-amber-600 transition-colors"
                title="Edit title"
              >
                <Pencil className="size-3.5" />
              </button>
            )}
          </div>

          {editing ? (
            <form onSubmit={handleSaveTitle} className="space-y-2">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                autoFocus
                className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              {saveError && (
                <div className="flex items-center gap-1 text-xs text-red-600">
                  <AlertCircle className="size-3.5" /> {saveError}
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => { setEditing(false); setSaveError(""); }}
                  className="px-2.5 py-1 text-xs text-stone-500 hover:text-stone-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-stone-700 leading-snug break-words">{title}</p>
          )}
        </div>

        {/* Stats */}
        <InfoBlock
          icon={MessageSquare}
          label="Messages"
          value={messageCount}
        />
        <InfoBlock
          icon={Calendar}
          label="Created"
          value={formatDate(createdAt)}
        />
        <InfoBlock
          icon={Clock}
          label="Last Updated"
          value={formatDate(updatedAt)}
        />
      </div>

      {/* Footer — delete */}
      <div className="px-4 py-4 border-t border-stone-200">
        {showDeleteConfirm ? (
          <div className="space-y-2">
            <p className="text-xs text-red-600">Delete this conversation?</p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                Delete
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 font-medium transition-colors"
          >
            <Trash2 className="size-3.5" />
            Delete Conversation
          </button>
        )}
      </div>
    </aside>
  );
}

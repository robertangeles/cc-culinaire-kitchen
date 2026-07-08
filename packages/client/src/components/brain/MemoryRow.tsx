/**
 * @module components/brain/MemoryRow
 *
 * One row in the "Your Brain" list (docs/specs/brain-memory.md D-T2/D-T4).
 * Primary = the memory (expandable). Tertiary = per-row actions revealed on
 * hover (desktop) / always visible (touch): pin, correct (inline edit),
 * share/un-share, delete. Pinned rows show a star; shared rows show a chip.
 */

import { useState } from "react";
import { Trash2, Loader2, Sparkles, Star, Pencil, Share2, Check } from "lucide-react";
import { ProvenanceChip } from "./ProvenanceChip.js";
import type { BrainMemory } from "../../hooks/useBrainMemories.js";

const ACTION_BTN =
  "flex-shrink-0 flex size-9 items-center justify-center rounded-lg text-[#777777] transition-opacity motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A574]/60 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100";

export function MemoryRow({
  memory,
  hasOrg = false,
  onDelete,
  onPin,
  onCorrect,
  onToggleScope,
}: {
  memory: BrainMemory;
  /** Whether the user belongs to a kitchen — gates the share/un-share action. */
  hasOrg?: boolean;
  onDelete: (memoryId: string) => Promise<boolean>;
  onPin: (memoryId: string, pinned: boolean) => Promise<boolean>;
  onCorrect: (memoryId: string, body: string) => Promise<boolean>;
  onToggleScope: (memoryId: string, scope: "user" | "org") => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [busy, setBusy] = useState<null | "pin" | "scope">(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(memory.body);
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isLearning = memory.status === "pending" || memory.status === "processing";
  const isShared = memory.scope === "org";
  const label = memory.title || memory.body.slice(0, 100);

  async function handleDelete() {
    setIsDeleting(true);
    setActionError(null);
    const ok = await onDelete(memory.memoryId).catch(() => false);
    if (ok) {
      setIsLeaving(true);
    } else {
      setIsDeleting(false);
      setActionError("Couldn't remove that — try again.");
    }
  }

  async function handlePin() {
    setBusy("pin");
    setActionError(null);
    const ok = await onPin(memory.memoryId, !memory.isPinned).catch(() => false);
    if (!ok) setActionError("Couldn't update pin — try again.");
    setBusy(null);
  }

  async function handleScope() {
    setBusy("scope");
    setActionError(null);
    const ok = await onToggleScope(memory.memoryId, isShared ? "user" : "org").catch(() => false);
    if (!ok) setActionError(isShared ? "Couldn't unshare — try again." : "Couldn't share — try again.");
    setBusy(null);
  }

  async function handleSaveEdit() {
    const text = editText.trim();
    if (!text) return;
    setIsSaving(true);
    setActionError(null);
    const ok = await onCorrect(memory.memoryId, text).catch(() => false);
    setIsSaving(false);
    if (ok) {
      setEditing(false);
    } else {
      setActionError("Couldn't save your edit — try again.");
    }
  }

  return (
    <li
      className={`group rounded-xl border border-[#1E1E1E] bg-[#111111] transition-opacity duration-300 motion-reduce:transition-none ${
        isLeaving ? "opacity-0" : "opacity-100"
      } ${memory.isPinned ? "shadow-[0_0_12px_rgba(212,165,116,0.10)]" : ""}`}
    >
      {editing ? (
        <div className="px-4 py-3">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={4}
            aria-label="Edit memory text"
            className="w-full resize-y rounded-lg border border-[#1E1E1E] bg-[#0A0A0A] px-3 py-2 text-sm leading-relaxed text-[#E5E5E5] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A574]/60"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={isSaving || !editText.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#D4A574] to-amber-600 px-3 py-1.5 text-xs font-medium text-[#0A0A0A] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A574]/60"
            >
              {isSaving ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setEditText(memory.body);
                setActionError(null);
              }}
              className="rounded-lg px-3 py-1.5 text-xs text-[#999999] hover:text-[#E5E5E5] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A574]/60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 px-4 py-3">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="flex-1 min-w-0 text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A574]/60"
          >
            <div className="flex items-center gap-1.5">
              {memory.isPinned && (
                <Star className="size-3 flex-shrink-0 fill-[#D4A574] text-[#D4A574]" aria-label="Pinned" />
              )}
              <p className="text-sm text-[#E5E5E5] leading-snug break-words">{label}</p>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <ProvenanceChip sourceType={memory.sourceType} createdDttm={memory.createdDttm} />
              {isShared && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[#D4A574]/20 bg-[#D4A574]/10 px-2 py-0.5 text-[10px] text-[#D4A574]">
                  <Share2 className="size-2.5" aria-hidden="true" />
                  shared
                </span>
              )}
              {isLearning && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[#D4A574]/20 bg-[#D4A574]/10 px-2 py-0.5 text-[10px] text-[#D4A574]">
                  <Sparkles className="size-2.5" aria-hidden="true" />
                  learning…
                </span>
              )}
            </div>
          </button>

          <div className="flex flex-shrink-0 items-center">
            <button
              type="button"
              onClick={handlePin}
              disabled={busy === "pin"}
              aria-label={memory.isPinned ? "Unpin this memory" : "Pin this memory"}
              className={`${ACTION_BTN} ${memory.isPinned ? "text-[#D4A574] sm:opacity-100" : "hover:text-[#D4A574] hover:bg-[#D4A574]/10"}`}
            >
              {busy === "pin" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Star className={`size-4 ${memory.isPinned ? "fill-[#D4A574]" : ""}`} aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setEditText(memory.body);
                setEditing(true);
                setActionError(null);
              }}
              aria-label="Edit this memory"
              className={`${ACTION_BTN} hover:text-[#D4A574] hover:bg-[#D4A574]/10`}
            >
              <Pencil className="size-4" aria-hidden="true" />
            </button>

            {hasOrg && (
              <button
                type="button"
                onClick={handleScope}
                disabled={busy === "scope"}
                aria-label={isShared ? "Un-share from your kitchen" : "Share with your kitchen"}
                className={`${ACTION_BTN} ${isShared ? "text-[#D4A574] sm:opacity-100" : "hover:text-[#D4A574] hover:bg-[#D4A574]/10"}`}
              >
                {busy === "scope" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Share2 className="size-4" aria-hidden="true" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              aria-label="Remove this memory"
              className={`${ACTION_BTN} hover:text-red-400 hover:bg-red-400/10`}
            >
              {isDeleting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      )}

      {expanded && !editing && (
        <div className="border-t border-[#1E1E1E] px-4 py-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#B5B5B5]">{memory.body}</p>
        </div>
      )}

      {actionError && (
        <p role="alert" className="px-4 pb-3 text-xs text-red-400">
          {actionError}
        </p>
      )}
    </li>
  );
}

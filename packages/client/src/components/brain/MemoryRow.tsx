/**
 * @module components/brain/MemoryRow
 *
 * One memory in the "Your Brain" list (docs/specs/brain-memory.md D-T2/D-T3).
 *
 * A LIST row, deliberately not a card grid (anti-slop guardrail): title +
 * provenance visible; the full body expands on click/Enter. The delete
 * action is hover-revealed on desktop and always visible on touch widths
 * (no hover on touch — spec responsive rule), with a ≥44px hit target.
 *
 * States (spec interaction table): rows still embedding show a quiet
 * "learning…" chip; delete shows a row spinner and fades the row out.
 */

import { useState } from "react";
import { Trash2, Loader2, Sparkles } from "lucide-react";
import type { BrainMemory } from "../../hooks/useBrainMemories.js";
import { ProvenanceChip } from "./ProvenanceChip.js";

export function MemoryRow({
  memory,
  onDelete,
}: {
  memory: BrainMemory;
  /** Resolves true on success; false shows the inline error. */
  onDelete: (memoryId: string) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  const isLearning = memory.status === "pending" || memory.status === "processing";
  const label = memory.title || memory.body.slice(0, 100);

  async function handleDelete() {
    setIsDeleting(true);
    setDeleteError(false);
    const ok = await onDelete(memory.memoryId).catch(() => false);
    if (ok) {
      // Row fades, then the parent's state removal unmounts it.
      setIsLeaving(true);
    } else {
      setIsDeleting(false);
      setDeleteError(true);
    }
  }

  return (
    <li
      className={`group rounded-xl border border-[#1E1E1E] bg-[#111111] transition-opacity duration-300 motion-reduce:transition-none ${
        isLeaving ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="flex items-start gap-2 px-4 py-3">
        {/* Title row — a real button so keyboard users can expand with Enter. */}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="flex-1 min-w-0 text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A574]/60"
        >
          <p className="text-sm text-[#E5E5E5] leading-snug break-words">{label}</p>
          <div className="mt-1 flex items-center gap-2">
            <ProvenanceChip sourceType={memory.sourceType} createdDttm={memory.createdDttm} />
            {isLearning && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#D4A574]/20 bg-[#D4A574]/10 px-2 py-0.5 text-[10px] text-[#D4A574]">
                <Sparkles className="size-2.5" aria-hidden="true" />
                learning…
              </span>
            )}
          </div>
        </button>

        {/* Delete — hover-revealed on desktop, always visible on touch widths. */}
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting}
          aria-label="Remove this memory"
          className="flex-shrink-0 flex size-11 items-center justify-center rounded-lg text-[#777777] transition-opacity hover:text-red-400 hover:bg-red-400/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A574]/60 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 motion-reduce:transition-none"
        >
          {isDeleting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-[#1E1E1E] px-4 py-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#B5B5B5]">
            {memory.body}
          </p>
        </div>
      )}

      {deleteError && (
        <p role="alert" className="px-4 pb-3 text-xs text-red-400">
          Couldn't remove that — try again.
        </p>
      )}
    </li>
  );
}

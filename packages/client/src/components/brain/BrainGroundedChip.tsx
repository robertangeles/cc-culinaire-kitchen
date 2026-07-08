/**
 * @module components/brain/BrainGroundedChip
 *
 * "Grounded in your Brain" trust signal under a chat reply
 * (docs/specs/brain-memory.md DR1 / D-T1).
 *
 * Quiet by default: a small dismissible pill that appears only when memories
 * informed this answer. Expanding it reveals WHICH memories (titles only —
 * bodies never travel down this channel). Announced politely to screen readers.
 *
 * Two sources (spec T14): chat streams the `brain_grounded` message annotation
 * (`annotations` prop); the non-streaming Labs pass their recalled `memories`
 * directly (`memories` prop). Either drives the same chip.
 */

import { useState } from "react";
import { Brain, ChevronDown, X } from "lucide-react";
import type { JSONValue } from "ai";

/** A recalled memory reference — ids + labels only, never bodies. */
interface GroundedMemory {
  memoryId: string;
  title: string | null;
  sourceType: string;
}

/** Shape of the server's brain_grounded message annotation. */
interface BrainGroundedAnnotation {
  type: "brain_grounded";
  memories: GroundedMemory[];
}

/** Extract the brain_grounded annotation from a message's annotations, if any. */
function findGrounding(annotations: JSONValue[] | undefined): BrainGroundedAnnotation | null {
  if (!annotations) return null;
  for (const annotation of annotations) {
    if (
      annotation &&
      typeof annotation === "object" &&
      !Array.isArray(annotation) &&
      (annotation as Record<string, unknown>).type === "brain_grounded"
    ) {
      return annotation as unknown as BrainGroundedAnnotation;
    }
  }
  return null;
}

export function BrainGroundedChip({
  annotations,
  memories: directMemories,
}: {
  /** Chat path: Vercel AI SDK message annotations carrying `brain_grounded`. */
  annotations?: JSONValue[] | undefined;
  /** Labs path: recalled memories passed directly from the JSON response. */
  memories?: GroundedMemory[] | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const memories = directMemories ?? findGrounding(annotations)?.memories ?? null;
  if (!memories || memories.length === 0 || dismissed) return null;

  return (
    <div role="status" aria-live="polite" className="mt-1.5">
      <div className="inline-flex items-center gap-1 rounded-full border border-[#D4A574]/20 bg-[#D4A574]/10 pl-2.5 pr-1 py-0.5">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1.5 text-[11px] text-[#D4A574] rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A574]/60"
        >
          <Brain className="size-3" aria-hidden="true" />
          Grounded in your Brain
          <ChevronDown
            className={`size-3 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="flex size-5 items-center justify-center rounded-full text-[#D4A574]/60 hover:text-[#D4A574] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A574]/60"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      </div>

      {expanded && (
        <ul className="mt-1.5 space-y-0.5 pl-1">
          {memories.map((memory) => (
            <li key={memory.memoryId} className="text-[11px] text-[#999999]">
              · {memory.title || "A note from your kitchen"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

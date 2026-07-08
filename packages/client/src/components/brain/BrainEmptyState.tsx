/**
 * @module components/brain/BrainEmptyState
 *
 * Warm first-run state for "Your Brain" (docs/specs/brain-memory.md D-T2/D-T4).
 * Never a clinical "No items found" — the truly-empty Brain is an invitation;
 * a filtered/searched no-match state stays warm but distinct (spec T14b).
 */

import { Brain, SearchX } from "lucide-react";

/** `hasQuery` distinguishes "no matches for this filter/search" from a new, empty Brain. */
export function BrainEmptyState({ hasQuery = false }: { hasQuery?: boolean }) {
  if (hasQuery) {
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-[#D4A574]/10 border border-[#D4A574]/20">
          <SearchX className="size-7 text-[#D4A574]" aria-hidden="true" />
        </div>
        <h2 className="mt-5 text-lg font-semibold text-[#FAFAFA]">No memories match</h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-[#999999]">
          Try a different search or clear the filters to see everything CulinAIre
          remembers.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-[#D4A574]/10 border border-[#D4A574]/20 shadow-[0_0_24px_rgba(212,165,116,0.15)]">
        <Brain className="size-7 text-[#D4A574]" aria-hidden="true" />
      </div>
      <h2 className="mt-5 text-lg font-semibold bg-gradient-to-r from-[#FAFAFA] to-[#D4A574] bg-clip-text text-transparent">
        Your Brain is warming up
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-[#999999]">
        Keep cooking and chatting — CulinAIre starts remembering what matters to
        your kitchen, so it always has your context.
      </p>
    </div>
  );
}

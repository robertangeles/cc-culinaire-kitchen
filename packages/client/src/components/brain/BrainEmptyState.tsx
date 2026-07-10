/**
 * @module components/brain/BrainEmptyState
 *
 * Warm first-run state for "Your Brain" (docs/specs/brain-memory.md D-T2/D-T4/T14c).
 * Never a clinical "No items found." Three variants:
 *   - `warming`   — a brand-new, empty Brain (the invitation).
 *   - `no-match`  — a search/filter that matched nothing (still warm, distinct).
 *   - `no-shared` — the Shared tab before the kitchen has shared anything yet
 *     (an invitation, NOT a "no match" — spec T14c).
 */

import { Brain, SearchX, Share2 } from "lucide-react";

/** Which empty state to render (spec T14c: a scope tab with zero rows is an invite, not a no-match). */
export type BrainEmptyVariant = "warming" | "no-match" | "no-shared";

export function BrainEmptyState({ variant = "warming" }: { variant?: BrainEmptyVariant }) {
  if (variant === "no-match") {
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

  if (variant === "no-shared") {
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-[#D4A574]/10 border border-[#D4A574]/20 shadow-[0_0_24px_rgba(212,165,116,0.15)]">
          <Share2 className="size-7 text-[#D4A574]" aria-hidden="true" />
        </div>
        <h2 className="mt-5 text-lg font-semibold bg-gradient-to-r from-[#FAFAFA] to-[#D4A574] bg-clip-text text-transparent">
          Your kitchen hasn't shared anything yet
        </h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-[#999999]">
          Memories you or your team share show up here, so everyone cooks with the
          same context. Share one from your private list to get started.
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

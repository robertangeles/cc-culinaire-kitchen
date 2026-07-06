/**
 * @module pages/YourBrainPage
 *
 * "Your Brain" — the consent baseline for the Brain memory layer
 * (docs/specs/brain-memory.md T8, design D-T2/D-T3): see everything
 * CulinAIre remembers about you, search it, and delete anything.
 *
 * Phase 1 baseline: private-scope list (newest first) + search + delete.
 * Phase 2 adds the scope tabs, source filters, pin/correct, and the
 * org-admin surface (spec T14/D-T4).
 *
 * IA (spec): primary = the memory list; secondary = search; tertiary =
 * per-row actions. Memories are a LIST, never a card grid.
 */

import { Brain, Search, Loader2 } from "lucide-react";
import { useBrainMemories } from "../hooks/useBrainMemories.js";
import { MemoryRow } from "../components/brain/MemoryRow.js";
import { BrainEmptyState } from "../components/brain/BrainEmptyState.js";

/** Skeleton rows shown while the list loads (states table: LOADING). */
function LoadingRows() {
  return (
    <ul className="space-y-2" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="h-16 rounded-xl border border-[#1E1E1E] bg-[#111111] animate-pulse motion-reduce:animate-none"
        />
      ))}
    </ul>
  );
}

export function YourBrainPage() {
  const { memories, total, isLoading, error, search, setSearch, reload, remove } =
    useBrainMemories();

  const hasQuery = search.trim().length > 0;

  return (
    <div className="flex-1 overflow-y-auto bg-[#0A0A0A]">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        {/* Header — title + trust subtitle (spec IA) */}
        <header className="flex items-start gap-3">
          <div className="mt-0.5 flex size-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#D4A574]/10 border border-[#D4A574]/20">
            <Brain className="size-5 text-[#D4A574]" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Your Brain</h1>
            <p className="mt-0.5 text-sm text-[#999999]">
              What CulinAIre remembers, so it always has your context.
            </p>
          </div>
        </header>

        {/* Search (secondary) */}
        <div className="relative mt-6">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#777777]"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your memories…"
            aria-label="Search your memories"
            className="w-full rounded-xl border border-[#1E1E1E] bg-[#111111] py-2.5 pl-9 pr-3 text-sm text-[#E5E5E5] placeholder:text-[#777777] shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A574]/60"
          />
        </div>

        {/* List states (spec interaction table) */}
        <div className="mt-4">
          {isLoading ? (
            <LoadingRows />
          ) : error ? (
            <div
              role="alert"
              className="rounded-xl border border-[#1E1E1E] bg-[#111111] px-4 py-6 text-center"
            >
              <p className="text-sm text-[#E5E5E5]">{error}</p>
              <button
                type="button"
                onClick={reload}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#D4A574] px-3 py-1.5 text-sm font-medium text-[#0A0A0A] hover:bg-[#C4956A] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A574]/60"
              >
                <Loader2 className="size-3.5" aria-hidden="true" />
                Retry
              </button>
            </div>
          ) : memories.length === 0 && !hasQuery ? (
            <BrainEmptyState />
          ) : memories.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-[#999999]">
              Nothing in your Brain matches that — try a different word.
            </p>
          ) : (
            <>
              <p className="mb-2 px-1 text-xs text-[#777777]" aria-live="polite">
                {total} {total === 1 ? "memory" : "memories"}, newest first
              </p>
              <ul className="space-y-2">
                {memories.map((memory) => (
                  <MemoryRow key={memory.memoryId} memory={memory} onDelete={remove} />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * @module pages/YourBrainPage
 *
 * "Your Brain" — the management surface for the Brain memory layer
 * (docs/specs/brain-memory.md T8/T14b, design D-T2/D-T3/D-T4): see everything
 * CulinAIre remembers, search + filter it, pin / correct / share, and delete.
 *
 * IA (spec D-T4): primary = the memory list; secondary = search + scope tabs +
 * source-type chips; tertiary = per-row actions. Memories are a LIST, never a
 * card grid; one amber accent only.
 */

import { Brain, Search, Loader2 } from "lucide-react";
import { useBrainMemories } from "../hooks/useBrainMemories.js";
import { MemoryRow } from "../components/brain/MemoryRow.js";
import { BrainEmptyState } from "../components/brain/BrainEmptyState.js";
import { ScopeToggle } from "../components/brain/ScopeToggle.js";
import { NudgeOptIn } from "../components/brain/NudgeOptIn.js";
import { useLocation } from "../context/LocationContext.js";

/** Source-type filter chips (spec D-T4). `null` value = "All". */
const SOURCE_CHIPS: ReadonlyArray<{ value: string | null; label: string }> = [
  { value: null, label: "All" },
  { value: "chat", label: "Chat" },
  { value: "recipe", label: "Recipes" },
  { value: "purchase_order", label: "Purchasing" },
  { value: "waste", label: "Waste" },
  { value: "stock", label: "Stock" },
  { value: "menu", label: "Menu" },
  { value: "prep", label: "Prep" },
];

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
  const {
    memories,
    total,
    isLoading,
    error,
    search,
    setSearch,
    scopeFilter,
    setScopeFilter,
    sourceTypeFilter,
    setSourceTypeFilter,
    reload,
    remove,
    pin,
    correct,
    toggleScope,
  } = useBrainMemories();

  // "Belongs to a kitchen" gate for the scope tabs + per-row share action.
  const { hasLocationAccess } = useLocation();
  const hasOrg = hasLocationAccess;

  // Pick the empty state (spec T14c). A search/source filter with no hits is a
  // "no match"; an unfiltered Shared tab with no rows is an invitation ("nothing
  // shared yet"), NOT a no-match; an unfiltered Private tab is the warming hero.
  const isFiltered = search.trim().length > 0 || sourceTypeFilter !== null;
  const emptyVariant = isFiltered
    ? "no-match"
    : scopeFilter === "org"
      ? "no-shared"
      : "warming";

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

        {/* Search + scope tabs (secondary) */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
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
          {hasOrg && (
            <ScopeToggle value={scopeFilter} onChange={setScopeFilter} />
          )}
        </div>

        {/* Source-type filter chips (spec D-T4) */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {SOURCE_CHIPS.map((chip) => {
            const active = sourceTypeFilter === chip.value;
            return (
              <button
                key={chip.label}
                type="button"
                onClick={() => setSourceTypeFilter(chip.value)}
                aria-pressed={active}
                className={`flex-shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A574]/60 ${
                  active
                    ? "border-[#D4A574]/30 bg-[#D4A574]/15 text-[#D4A574]"
                    : "border-[#1E1E1E] bg-[#111111] text-[#999999] hover:text-[#E5E5E5]"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
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
          ) : memories.length === 0 ? (
            <BrainEmptyState variant={emptyVariant} />
          ) : (
            <>
              <p className="mb-2 px-1 text-xs text-[#777777]" aria-live="polite">
                {total} {total === 1 ? "memory" : "memories"}
              </p>
              <ul className="space-y-2">
                {memories.map((memory) => (
                  <MemoryRow
                    key={memory.memoryId}
                    memory={memory}
                    hasOrg={hasOrg}
                    onDelete={remove}
                    onPin={pin}
                    onCorrect={correct}
                    onToggleScope={toggleScope}
                  />
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Proactive nudges opt-in (Phase 3 T17) */}
        <NudgeOptIn />
      </div>
    </div>
  );
}

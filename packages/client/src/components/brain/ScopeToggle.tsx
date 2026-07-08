/**
 * @module components/brain/ScopeToggle
 *
 * The "Your Brain" scope segmented control (docs/specs/brain-memory.md D-T4 /
 * DR2): [ Private to you | Shared with your kitchen ]. Shown only to users who
 * belong to a kitchen; a 2-way toggle, never an "all" view.
 */

import type { ScopeFilter } from "../../hooks/useBrainMemories.js";

const TABS: ReadonlyArray<{ key: ScopeFilter; label: string }> = [
  { key: "user", label: "Private to you" },
  { key: "org", label: "Shared with your kitchen" },
];

export function ScopeToggle({
  value,
  onChange,
}: {
  value: ScopeFilter;
  onChange: (value: ScopeFilter) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Memory scope"
      className="inline-flex rounded-full border border-[#1E1E1E] bg-[#111111] p-0.5"
    >
      {TABS.map((tab) => {
        const active = value === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A574]/60 ${
              active
                ? "bg-[#D4A574]/15 text-[#D4A574] shadow-[0_0_12px_rgba(212,165,116,0.15)]"
                : "text-[#999999] hover:text-[#E5E5E5]"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

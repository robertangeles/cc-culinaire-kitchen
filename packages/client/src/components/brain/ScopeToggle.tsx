/**
 * @module components/brain/ScopeToggle
 *
 * The "Your Brain" scope segmented control (docs/specs/brain-memory.md D-T4 /
 * DR2): [ Private to you | Shared with your kitchen ]. Shown only to users who
 * belong to a kitchen; a 2-way toggle, never an "all" view.
 */

import type { ScopeFilter } from "../../hooks/useBrainMemories.js";
import { PillTabs } from "../ui/PillTabs.js";

const TABS: ReadonlyArray<{ id: ScopeFilter; label: string }> = [
  { id: "user", label: "Private to you" },
  { id: "org", label: "Shared with your kitchen" },
];

export function ScopeToggle({
  value,
  onChange,
}: {
  value: ScopeFilter;
  onChange: (value: ScopeFilter) => void;
}) {
  return (
    <PillTabs
      tabs={TABS}
      active={value}
      onChange={onChange}
      ariaLabel="Memory scope"
      className="inline-flex rounded-full border border-dark-100 bg-[#111111] p-0.5"
      tabClassName="rounded-full px-3 text-xs font-medium transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
      activeClassName="bg-gold/15 text-gold shadow-[0_0_12px_var(--color-gold-muted)]"
      inactiveClassName="text-dark-600 hover:text-[#E5E5E5]"
    />
  );
}

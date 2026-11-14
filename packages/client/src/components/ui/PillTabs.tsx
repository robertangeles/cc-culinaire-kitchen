/**
 * @module components/ui/PillTabs
 *
 * Shared horizontal tab strip. Implements the WAI-ARIA tabs pattern:
 * tablist/tab roles, aria-selected, roving tabindex, and Left/Right/Home/End
 * keys that move focus and activate. Every tab is at least 44px tall (touch
 * target minimum). Callers keep their own look through the class props.
 */

import type { ComponentType, KeyboardEvent, ReactNode } from "react";
import { Tooltip } from "./Tooltip.js";

export interface PillTab<T extends string> {
  id: T;
  label: string;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  /** Rendered after the label (count pills etc). */
  badge?: ReactNode;
  tooltip?: string;
}

interface PillTabsProps<T extends string> {
  tabs: ReadonlyArray<PillTab<T>>;
  active: T | null;
  onChange: (id: T) => void;
  ariaLabel?: string;
  /** Sets id `${p}-tab-${id}` and aria-controls `${p}-tabpanel-${id}` on each tab. */
  idPrefix?: string;
  /** Classes for the tablist container. */
  className?: string;
  /** Classes for every tab (layout, padding, radius, type). */
  tabClassName?: string;
  activeClassName: string;
  inactiveClassName: string;
}

export function PillTabs<T extends string>({
  tabs,
  active,
  onChange,
  ariaLabel,
  idPrefix,
  className,
  tabClassName = "gap-2 rounded-lg px-4 text-sm font-medium transition-all",
  activeClassName,
  inactiveClassName,
}: PillTabsProps<T>) {
  const tabbableId = tabs.some((t) => t.id === active) ? active : tabs[0]?.id;

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const els = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
    const i = els.indexOf(e.target as HTMLElement);
    if (i === -1) return;
    const last = tabs.length - 1;
    const next =
      e.key === "ArrowRight" ? (i + 1) % tabs.length
      : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : -1;
    if (next === -1) return;
    e.preventDefault();
    onChange(tabs[next].id);
    els[next].focus();
  }

  return (
    <div role="tablist" aria-label={ariaLabel} className={className} onKeyDown={handleKeyDown}>
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        const Icon = tab.icon;
        const button = (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-tab-${tab.id}` : undefined}
            aria-selected={isActive}
            aria-controls={idPrefix ? `${idPrefix}-tabpanel-${tab.id}` : undefined}
            tabIndex={tab.id === tabbableId ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`flex min-h-11 items-center ${tabClassName} ${isActive ? activeClassName : inactiveClassName}`}
          >
            {Icon && <Icon className="size-4" aria-hidden="true" />}
            {tab.label}
            {tab.badge}
          </button>
        );
        return tab.tooltip ? (
          <Tooltip key={tab.id} text={tab.tooltip} position="bottom">
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}

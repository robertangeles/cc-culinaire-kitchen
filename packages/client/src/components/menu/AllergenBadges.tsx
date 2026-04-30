/**
 * @module components/menu/AllergenBadges
 *
 * Catalog-spine Phase 3: allergen pills for menu item cards.
 *
 * Reads the denormalised `contains_*_ind` flags on `menu_item` (rolled up
 * server-side by a Postgres trigger from the linked Catalog ingredients).
 * Pure display — never writes.
 *
 * Each allergen class gets its own accent colour per the Phase 1 design
 * spec ("platform-color identity"): chefs scan colour, not text.
 *
 * Stacking rule: max 4 pills shown inline; the rest collapse to "+N more"
 * with a tooltip listing the remaining classes.
 */

import { useMemo } from "react";
import type { MenuItem } from "../../hooks/useMenuItems.js";

interface AllergenSpec {
  key: keyof Pick<
    MenuItem,
    | "containsDairyInd"
    | "containsGlutenInd"
    | "containsNutsInd"
    | "containsShellfishInd"
    | "containsEggsInd"
    | "isVegetarianInd"
  >;
  label: string;
  /** Tailwind classes — token reference per Phase 1 design spec. */
  className: string;
  /** Optional per-allergen aria-label override. */
  ariaLabel?: string;
}

const SPEC: AllergenSpec[] = [
  {
    key: "containsDairyInd",
    label: "Dairy",
    className: "text-orange-200 bg-orange-500/10 border-orange-500/20",
    ariaLabel: "Contains dairy",
  },
  {
    key: "containsGlutenInd",
    label: "Gluten",
    className: "text-amber-300 bg-amber-500/10 border-amber-500/20",
    ariaLabel: "Contains gluten",
  },
  {
    key: "containsNutsInd",
    label: "Nuts",
    className: "text-yellow-700 bg-yellow-900/20 border-yellow-700/30",
    ariaLabel: "Contains nuts",
  },
  {
    key: "containsShellfishInd",
    label: "Shellfish",
    className: "text-pink-300 bg-pink-500/10 border-pink-500/20",
    ariaLabel: "Contains shellfish",
  },
  {
    key: "containsEggsInd",
    label: "Eggs",
    className: "text-yellow-200 bg-yellow-500/10 border-yellow-500/20",
    ariaLabel: "Contains eggs",
  },
  {
    key: "isVegetarianInd",
    label: "Vegetarian",
    className: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20",
    ariaLabel: "Vegetarian",
  },
];

interface AllergenBadgesProps {
  item: MenuItem;
  /** When true, renders nothing if the menu item has zero active allergens. */
  hideEmpty?: boolean;
  /** Cap the number of pills shown inline. Default 4. */
  maxInline?: number;
  /** Override the default flex / spacing classes (rare). */
  className?: string;
}

export function AllergenBadges({
  item,
  hideEmpty = true,
  maxInline = 4,
  className,
}: AllergenBadgesProps) {
  const active = useMemo(
    () => SPEC.filter((s) => item[s.key] === true),
    [item],
  );

  if (active.length === 0 && hideEmpty) return null;

  const inline = active.slice(0, maxInline);
  const overflow = active.slice(maxInline);

  return (
    <div
      className={
        className ??
        "flex flex-wrap items-center gap-1.5"
      }
      data-testid="allergen-badges"
    >
      {inline.map((s) => (
        <span
          key={s.key}
          aria-label={s.ariaLabel}
          className={`inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded border ${s.className}`}
        >
          {s.label}
        </span>
      ))}
      {overflow.length > 0 && (
        <span
          className="inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded border text-[#999] bg-[#1E1E1E] border-[#2A2A2A]"
          title={overflow.map((s) => s.label).join(", ")}
          aria-label={`Plus ${overflow.length} more allergens: ${overflow.map((s) => s.label).join(", ")}`}
        >
          +{overflow.length} more
        </span>
      )}
    </div>
  );
}

/**
 * @module components/ui/StatusPill
 *
 * Bordered pill with the status word INSIDE it — never colour alone, so a
 * status survives greyscale and colour-blindness. Pass `ariaLabel` to give
 * screen readers the full picture ("RSA: expired 15 June 2026") instead of
 * the bare visible word ("Expired").
 */

import type { ReactNode } from "react";

export type StatusPillVariant = "compliant" | "expiring" | "expired" | "pending" | "rejected" | "na";

const VARIANT_STYLES: Record<StatusPillVariant, string> = {
  compliant: "border-dark-300 text-dark-600",
  expiring: "border-amber-500/40 text-amber-400",
  expired: "border-red-500/40 text-red-400",
  pending: "border-dark-300 text-dark-600",
  rejected: "border-red-500/40 text-red-400",
  na: "border-dark-200 text-dark-600",
};

export interface StatusPillProps {
  variant: StatusPillVariant;
  children: ReactNode;
  /** Full context for screen readers, e.g. "RSA: expired 15 June 2026". */
  ariaLabel?: string;
}

export function StatusPill({ variant, children, ariaLabel }: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${VARIANT_STYLES[variant]}`}
      aria-label={ariaLabel}
    >
      {children}
    </span>
  );
}

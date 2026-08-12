/**
 * @module components/ui/EmptyState
 *
 * Generalises components/brain/BrainEmptyState.tsx's non-obvious rule: a
 * scope with zero rows because nothing has happened yet is an INVITATION
 * (warm, gold glow, gradient title, a primary action) — a different thing
 * from a filter that matched nothing (a calm dead end pointing at a way
 * out). Collapsing those into one generic "No results" is the failure
 * being avoided.
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
}

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body: ReactNode;
  action?: EmptyStateAction;
  variant?: "invitation" | "no-match";
}

export function EmptyState({ icon: Icon, title, body, action, variant = "invitation" }: EmptyStateProps) {
  const isInvitation = variant === "invitation";

  return (
    <div className="flex flex-col items-center px-6 py-16 text-center animate-fade-in-up">
      <div
        className={`flex size-16 items-center justify-center rounded-full bg-gold-dim border border-border-gold ${
          isInvitation ? "shadow-[0_0_24px_rgba(212,165,116,0.15)]" : ""
        }`}
      >
        <Icon className="size-7 text-gold" aria-hidden="true" />
      </div>
      <h2
        className={
          isInvitation
            ? "mt-5 text-lg font-semibold bg-gradient-to-r from-[#FAFAFA] to-gold bg-clip-text text-transparent"
            : "mt-5 text-lg font-semibold text-[#FAFAFA]"
        }
      >
        {title}
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-dark-600">{body}</p>
      {action && <EmptyStateActionButton action={action} />}
    </div>
  );
}

function EmptyStateActionButton({ action }: { action: EmptyStateAction }) {
  const className =
    "mt-5 inline-flex min-h-11 items-center rounded-lg bg-gold px-5 py-2.5 text-sm font-semibold text-dark transition-all duration-200 hover:-translate-y-0.5 hover:bg-gold-hover";
  if (action.href) {
    return (
      <a href={action.href} className={className}>
        {action.label}
      </a>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={className}>
      {action.label}
    </button>
  );
}

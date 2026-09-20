/**
 * @module components/settings/RuleDrawer
 *
 * Shared slide-in drawer for AwardRulesTab and ComplianceRulesTab's
 * Create/Edit forms — chosen over a centered modal so the rule table stays
 * visible and scrollable behind it (useful when editing: the rule being
 * superseded stays in view). No existing modal/drawer precedent in this
 * codebase has real keyboard/focus handling (checked: KnowledgeManualDialog
 * and friends have none), so this is built fresh, not copied.
 *
 * A11y: focus moves to the first focusable element on open, Escape closes
 * (same as Cancel), Tab/Shift+Tab are trapped inside while open, and focus
 * returns to the element that had it before the drawer opened (typically
 * the row/button that triggered it) on close.
 */

import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface RuleDrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}

export function RuleDrawer({ open, title, onClose, children, footer }: RuleDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Autofocus targets the first FIELD, not the header's own Close button
    // (which sits earlier in DOM order but isn't "the first form field" a
    // user opening this drawer to fill something in would expect focus on).
    const firstFocusable = contentRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    firstFocusable?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;

      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 animate-fade-in-up" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full max-w-md flex-col border-l border-dark-200 bg-dark-50 shadow-2xl shadow-black/40"
      >
        <div className="flex items-center justify-between border-b border-dark-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-[#FAFAFA]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-dark-500 transition-all hover:bg-dark-200 hover:text-white"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
        <div ref={contentRef} className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
        <div className="flex justify-end gap-2 border-t border-dark-200 px-5 py-4">{footer}</div>
      </div>
    </div>
  );
}

/**
 * Small card that opens from a person (their name, avatar, or a DM header):
 * Message, Report, Block. Closes on Escape or a click outside.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MessageCircle, Flag, Ban } from "lucide-react";
import type { BenchPerson, ReportTarget } from "../../hooks/useBenchSafety.js";

interface BenchPersonMenuProps {
  person: BenchPerson;
  onMessage?: (userId: number) => void;
  onReport?: (target: ReportTarget) => void;
  onBlock?: (person: BenchPerson) => void;
  /** Accessible name of the trigger button. */
  label: string;
  triggerClassName?: string;
  /** Opens the card to the left of the trigger (for triggers on the right edge). */
  alignRight?: boolean;
  children: ReactNode;
}

const itemClass =
  "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-[#E5E5E5] hover:bg-white/5 focus-visible:outline-none focus-visible:bg-white/5 focus-visible:ring-2 focus-visible:ring-gold/50 transition-colors";

export function BenchPersonMenu({ person, onMessage, onReport, onBlock, label, triggerClassName, alignRight, children }: BenchPersonMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={triggerClassName}
      >
        {children}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={person.userName}
          className={`absolute top-full mt-1.5 z-30 w-48 p-1.5 rounded-xl border border-white/5 bg-dark-50/95 backdrop-blur-xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)] animate-scale-in ${alignRight ? "right-0" : "left-0"}`}
        >
          <p className="px-3 pt-1.5 pb-2 text-xs font-semibold text-gold truncate">{person.userName}</p>
          {onMessage && (
            <button type="button" role="menuitem" className={itemClass} onClick={() => pick(() => onMessage(person.userId))}>
              <MessageCircle className="size-4 text-dark-600" /> Message
            </button>
          )}
          {onReport && (
            <button type="button" role="menuitem" className={itemClass} onClick={() => pick(() => onReport({ person }))}>
              <Flag className="size-4 text-dark-600" /> Report
            </button>
          )}
          {onBlock && (
            <button type="button" role="menuitem" className={`${itemClass} hover:text-red-400`} onClick={() => pick(() => onBlock(person))}>
              <Ban className="size-4 text-dark-600" /> Block
            </button>
          )}
        </div>
      )}
    </span>
  );
}

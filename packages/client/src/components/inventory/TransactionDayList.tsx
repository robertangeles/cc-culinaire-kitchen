/**
 * @module components/inventory/TransactionDayList
 *
 * Shows transaction events for a selected calendar day.
 * Each row displays type icon, label, quantity, reason, user, and time.
 */

import { ClipboardCheck, ArrowRightLeft, Trash2, Loader2, CalendarOff, Boxes, PackageCheck, ChevronRight, AlertTriangle } from "lucide-react";
// Router Link, not a bare <a>: a plain href does a full page reload, which
// re-bootstraps auth + location context and briefly flashes the "Run the
// Kitchen" onboarding gate. Client-side navigation keeps the contexts mounted.
import { Link } from "react-router";

// Single source of truth — this file used to keep its own copy of the type and
// the two drifted apart. See the docblock there for what each type name means
// (they are not what you'd guess: "transfer" is consumption).
export type { TransactionEvent } from "../../hooks/useInventory.js";
import type { TransactionEvent } from "../../hooks/useInventory.js";

const TYPE_CONFIG: Record<string, { label: string; icon: typeof ClipboardCheck; color: string; bg: string; border: string }> = {
  stock_take:   { label: "Counted", icon: ClipboardCheck, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  transfer:     { label: "Usage", icon: ArrowRightLeft, color: "text-gold", bg: "bg-gold/10", border: "border-gold/20" },
  transfer_loc: { label: "Location Transfer", icon: ArrowRightLeft, color: "text-sky-400", bg: "bg-sky-500/10", border: "border-sky-500/20" },
  waste:        { label: "Waste", icon: Trash2, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
  // An area-to-area move. Deliberately NOT amber/red: nothing was used and
  // nothing left the site, so it must not read like a deduction.
  movement:     { label: "Area Move", icon: Boxes, color: "text-[#888]", bg: "bg-white/[0.04]", border: "border-white/10" },
  // A delivery received against a PO — the one event here that ADDS stock, so
  // it gets the strongest positive colour to read as inbound at a glance.
  receipt:      { label: "Received", icon: PackageCheck, color: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/25" },
};

const REASON_LABELS: Record<string, string> = {
  kitchen_operations: "Kitchen",
  foh_operations: "FOH",
  staff_consumption: "Staff",
  cleaning: "Cleaning",
  admin: "Admin",
  breakage: "Breakage",
  spoilage: "Spoilage",
  overproduction: "Overproduction",
  trim: "Prep Trim",
  return_to_stock: "Return to Stockroom",
  other: "Other",
};

interface TransactionDayListProps {
  transactions: TransactionEvent[];
  selectedDate: string;
  isLoading: boolean;
  /** Set when the history request failed — must NOT render as "no activity". */
  error?: string | null;
  onRetry?: () => void;
}

function formatDateHeader(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
}

export function TransactionDayList({ transactions, selectedDate, isLoading, error, onRetry }: TransactionDayListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="size-5 animate-spin text-gold" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-dark-500 uppercase tracking-wider">
        {formatDateHeader(selectedDate)}
      </p>

      {error ? (
        <div className="flex flex-col items-center gap-2 py-4 text-amber-400/90">
          <AlertTriangle className="size-5" />
          <span className="text-xs">{error}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="text-[10px] text-gold hover:underline"
            >
              Try again
            </button>
          )}
        </div>
      ) : transactions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-4 text-[#555]">
          <CalendarOff className="size-5" />
          <span className="text-xs">No activity on this day</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {transactions.map((t) => {
            const cfg = TYPE_CONFIG[t.type] || TYPE_CONFIG.stock_take;
            const Icon = cfg.icon;
            const reasonLabel = t.reason ? (REASON_LABELS[t.reason] || t.reason) : null;
            const base = "bg-[#111]/60 border border-white/5 rounded-lg px-3 py-2";
            // Only events that carry a destination become interactive. A row
            // that looks clickable and does nothing is worse than a plain one,
            // so the affordance appears strictly where `link` is set. Rendered
            // as two explicit branches rather than a dynamic element type —
            // a `Link | "div"` union cannot be typed against one prop bag.
            const body = (
              <>
                {/* Line 1: type + quantity */}
                <div className="flex items-center gap-2">
                  <Icon className={`size-3 ${cfg.color} shrink-0`} />
                  <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                  <span className="text-xs text-white tabular-nums">{Number(t.quantity).toFixed(1)} {t.unit}</span>
                </div>
                {/* Line 2: reason + user + time */}
                <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[#777]">
                  {reasonLabel && <span>{reasonLabel}</span>}
                  {reasonLabel && <span className="text-dark-400">·</span>}
                  <span>{t.userName}</span>
                  <span className="text-dark-400">·</span>
                  <span className="tabular-nums">{formatTime(t.occurredAt)}</span>
                  {t.link && <ChevronRight className="size-3 ml-auto text-[#555]" />}
                </div>
              </>
            );
            return t.link ? (
              <Link
                key={t.id}
                to={t.link}
                title="Open the record this entry came from"
                className={`block ${base} cursor-pointer transition-all hover:bg-dark-50 hover:border-gold/30 focus:outline-none focus:border-gold/50`}
              >
                {body}
              </Link>
            ) : (
              <div key={t.id} className={base}>{body}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}

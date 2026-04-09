/**
 * @module components/inventory/TransactionDayList
 *
 * Shows transaction events for a selected calendar day.
 * Each row displays type icon, label, quantity, reason, user, and time.
 */

import { ClipboardCheck, ArrowRightLeft, Trash2, Loader2, CalendarOff } from "lucide-react";

export interface TransactionEvent {
  id: string;
  type: "stock_take" | "transfer" | "transfer_loc" | "waste";
  quantity: string;
  unit: string;
  reason: string | null;
  userName: string;
  occurredAt: string;
}

const TYPE_CONFIG: Record<string, { label: string; icon: typeof ClipboardCheck; color: string; bg: string; border: string }> = {
  stock_take:   { label: "Counted", icon: ClipboardCheck, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  transfer:     { label: "Usage", icon: ArrowRightLeft, color: "text-[#D4A574]", bg: "bg-[#D4A574]/10", border: "border-[#D4A574]/20" },
  transfer_loc: { label: "Location Transfer", icon: ArrowRightLeft, color: "text-sky-400", bg: "bg-sky-500/10", border: "border-sky-500/20" },
  waste:        { label: "Waste", icon: Trash2, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
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

export function TransactionDayList({ transactions, selectedDate, isLoading }: TransactionDayListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="size-5 animate-spin text-[#D4A574]" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-[#666] uppercase tracking-wider">
        {formatDateHeader(selectedDate)}
      </p>

      {transactions.length === 0 ? (
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
            return (
              <div
                key={t.id}
                className="bg-[#111]/60 border border-white/5 rounded-lg px-3 py-2"
              >
                {/* Line 1: type + quantity */}
                <div className="flex items-center gap-2">
                  <Icon className={`size-3 ${cfg.color} shrink-0`} />
                  <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                  <span className="text-xs text-white tabular-nums">{Number(t.quantity).toFixed(1)} {t.unit}</span>
                </div>
                {/* Line 2: reason + user + time */}
                <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[#777]">
                  {reasonLabel && <span>{reasonLabel}</span>}
                  {reasonLabel && <span className="text-[#444]">·</span>}
                  <span>{t.userName}</span>
                  <span className="text-[#444]">·</span>
                  <span className="tabular-nums">{formatTime(t.occurredAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

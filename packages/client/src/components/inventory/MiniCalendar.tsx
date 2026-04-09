/**
 * @module components/inventory/MiniCalendar
 *
 * Pure CSS Grid month calendar for transaction history.
 * No external date library — all date logic is inline.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";

interface MiniCalendarProps {
  selectedDate: string;        // "2026-04-08"
  onSelectDate: (date: string) => void;
  markedDates: Set<string>;    // dates with transactions (amber dots)
  month: string;               // "2026-04"
  onMonthChange: (month: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────

function getCalendarDays(month: string): { date: string; day: number; isCurrentMonth: boolean }[] {
  const [year, mon] = month.split("-").map(Number);
  const firstDay = new Date(year, mon - 1, 1);
  const lastDay = new Date(year, mon, 0);
  const startDow = (firstDay.getDay() + 6) % 7; // Monday = 0

  const days: { date: string; day: number; isCurrentMonth: boolean }[] = [];

  // Pad start with previous month
  const prevMonth = new Date(year, mon - 1, 0);
  for (let i = startDow - 1; i >= 0; i--) {
    const d = prevMonth.getDate() - i;
    const pm = mon - 1 <= 0 ? 12 : mon - 1;
    const py = mon - 1 <= 0 ? year - 1 : year;
    const dateStr = `${py}-${String(pm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    days.push({ date: dateStr, day: d, isCurrentMonth: false });
  }

  // Current month days
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${year}-${String(mon).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    days.push({ date: dateStr, day: d, isCurrentMonth: true });
  }

  // Pad end to fill the grid (up to 42 = 6 weeks)
  const remaining = 42 - days.length;
  for (let d = 1; d <= remaining; d++) {
    const nextMon = mon + 1 > 12 ? 1 : mon + 1;
    const nextYear = mon + 1 > 12 ? year + 1 : year;
    const dateStr = `${nextYear}-${String(nextMon).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    days.push({ date: dateStr, day: d, isCurrentMonth: false });
  }

  return days;
}

function getPrevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getNextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}

const DAY_HEADERS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

// ─── Component ───────────────────────────────────────────────────

export function MiniCalendar({
  selectedDate,
  onSelectDate,
  markedDates,
  month,
  onMonthChange,
}: MiniCalendarProps) {
  const today = new Date().toISOString().slice(0, 10);
  const days = getCalendarDays(month);

  return (
    <div className="bg-[#111]/80 border border-white/5 rounded-xl p-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => onMonthChange(getPrevMonth(month))}
          className="p-1 rounded-lg hover:bg-white/5 text-[#999] hover:text-white transition-all"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-sm font-medium text-white">{formatMonthLabel(month)}</span>
        <button
          onClick={() => onMonthChange(getNextMonth(month))}
          className="p-1 rounded-lg hover:bg-white/5 text-[#999] hover:text-white transition-all"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DAY_HEADERS.map((d) => (
          <div key={d} className="text-center text-[10px] text-[#666] font-medium py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {days.map(({ date, day, isCurrentMonth }) => {
          const isToday = date === today;
          const isSelected = date === selectedDate;
          const hasTransactions = markedDates.has(date);
          const isFuture = date > today;
          const isDisabled = !isCurrentMonth || isFuture;

          return (
            <button
              key={date}
              disabled={isDisabled}
              onClick={() => !isDisabled && onSelectDate(date)}
              className={`
                relative flex flex-col items-center justify-center
                w-8 h-8 rounded-md text-xs transition-all
                ${isDisabled
                  ? "text-[#333] cursor-default"
                  : "hover:bg-white/5 cursor-pointer"
                }
                ${isSelected && isCurrentMonth
                  ? "bg-[#D4A574]/20 text-[#D4A574] font-semibold"
                  : ""
                }
                ${isToday && !isSelected && isCurrentMonth
                  ? "border border-[#D4A574]/40 text-white"
                  : ""
                }
                ${!isSelected && !isToday && isCurrentMonth && !isFuture
                  ? "text-[#ccc]"
                  : ""
                }
              `}
            >
              {day}
              {hasTransactions && isCurrentMonth && (
                <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-[#D4A574]" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

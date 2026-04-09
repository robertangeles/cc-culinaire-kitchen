/**
 * @module components/inventory/TransactionHistory
 *
 * Collapsible wrapper combining MiniCalendar + TransactionDayList.
 * Placed inside the EditIngredientModal to show per-ingredient history.
 */

import { useState, useMemo } from "react";
import { ChevronRight, ChevronDown, History } from "lucide-react";
import { MiniCalendar } from "./MiniCalendar.js";
import { TransactionDayList } from "./TransactionDayList.js";
import { useIngredientTransactions } from "../../hooks/useInventory.js";

interface TransactionHistoryProps {
  ingredientId: string;
  defaultExpanded?: boolean;
}

export function TransactionHistory({ ingredientId, defaultExpanded = false }: TransactionHistoryProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [selectedDate, setSelectedDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [currentMonth, setCurrentMonth] = useState(
    () => new Date().toISOString().slice(0, 7),
  );

  const { transactions, transactionDates, isLoading } = useIngredientTransactions(
    ingredientId,
    currentMonth,
  );

  const dayTransactions = useMemo(
    () => transactions.filter((t) => t.occurredAt.startsWith(selectedDate)),
    [transactions, selectedDate],
  );

  return (
    <div>
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full cursor-pointer hover:bg-white/5 rounded-lg px-3 py-2 flex items-center justify-between transition-all"
      >
        <div className="flex items-center gap-2">
          <History className="size-3.5 text-[#D4A574]" />
          <span className="text-xs font-medium text-white">Transaction History</span>
          {transactions.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[#D4A574]/15 text-[#D4A574] tabular-nums">
              {transactions.length}
            </span>
          )}
        </div>
        {expanded
          ? <ChevronDown className="size-3.5 text-[#666]" />
          : <ChevronRight className="size-3.5 text-[#666]" />
        }
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-2 space-y-3 animate-[fadeIn_150ms_ease-out]">
          <MiniCalendar
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            markedDates={transactionDates}
            month={currentMonth}
            onMonthChange={setCurrentMonth}
          />
          <TransactionDayList
            transactions={dayTransactions}
            selectedDate={selectedDate}
            isLoading={isLoading}
          />
        </div>
      )}
    </div>
  );
}

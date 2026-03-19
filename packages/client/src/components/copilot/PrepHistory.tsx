/**
 * @module components/copilot/PrepHistory
 *
 * History tab — past prep sessions sorted by date descending.
 * Each row is expandable to show task-level detail.
 */

import { useState, useEffect, useCallback } from "react";
import { Loader2, ChevronDown, ChevronRight, Calendar, Check, X, Minus } from "lucide-react";

interface HistoryTask {
  id: number;
  dishName: string;
  ingredientName: string;
  quantity: number;
  unit: string;
  status: "pending" | "done" | "skipped";
  assignedTo: string | null;
}

interface HistorySession {
  id: number;
  prepDate: string;
  expectedCovers: number;
  actualCovers: number | null;
  status: "active" | "ended";
  tasks: HistoryTask[];
  tasksDone: number;
  tasksSkipped: number;
  tasksTotal: number;
}

export function PrepHistory() {
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/prep/history?limit=20", { credentials: "include" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `Failed (${res.status})`);
      }
      const json = await res.json();
      setSessions(Array.isArray(json) ? json : json.sessions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Loading
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-[#D4A574]" />
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
        {error}
      </div>
    );
  }

  // Empty state
  if (sessions.length === 0) {
    return (
      <div className="text-center py-16">
        <Calendar className="size-10 mx-auto text-[#666666] mb-3" />
        <p className="text-[#999999]">No prep sessions yet.</p>
        <p className="text-sm text-[#666666] mt-1">Start your first one today!</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((session) => {
        const isExpanded = expanded.has(session.id);
        const total = session.tasksTotal ?? session.tasks?.length ?? 0;
        const done = session.tasksDone ?? session.tasks?.filter((t) => t.status === "done").length ?? 0;
        const skipped = session.tasksSkipped ?? session.tasks?.filter((t) => t.status === "skipped").length ?? 0;
        const completionPct = total > 0 ? Math.round((done / total) * 100) : 0;
        const dateLabel = new Date(session.prepDate).toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        });

        return (
          <div
            key={session.id}
            className="bg-[#161616] rounded-lg border border-[#2A2A2A] overflow-hidden"
          >
            {/* Summary row */}
            <button
              onClick={() => toggleExpand(session.id)}
              className="w-full flex items-center gap-4 p-4 text-left hover:bg-[#1E1E1E]/50 transition-colors min-h-[44px]"
            >
              {isExpanded ? (
                <ChevronDown className="size-4 text-[#666666] shrink-0" />
              ) : (
                <ChevronRight className="size-4 text-[#666666] shrink-0" />
              )}

              {/* Date */}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{dateLabel}</p>
                <p className="text-xs text-[#666666]">
                  {session.expectedCovers} expected
                  {session.actualCovers != null ? ` \u2192 ${session.actualCovers} actual` : ""}
                  {" covers"}
                </p>
              </div>

              {/* Completion bar */}
              <div className="w-24 shrink-0">
                <div className="flex items-center justify-between text-xs text-[#999999] mb-1">
                  <span>{completionPct}%</span>
                </div>
                <div className="w-full bg-[#1E1E1E] rounded-full h-2">
                  <div
                    className="h-2 rounded-full bg-[#D4A574]/100 transition-all duration-500"
                    style={{ width: `${completionPct}%` }}
                  />
                </div>
              </div>

              {/* Task counts */}
              <div className="text-right shrink-0">
                <p className="text-xs text-[#999999]">
                  <span className="text-green-400">{done}</span>
                  {" / "}
                  {total}
                  {skipped > 0 && (
                    <span className="text-[#666666]"> ({skipped} skipped)</span>
                  )}
                </p>
              </div>
            </button>

            {/* Expanded task list */}
            {isExpanded && session.tasks?.length > 0 && (
              <div className="border-t border-[#2A2A2A] px-4 py-3">
                <div className="space-y-2">
                  {session.tasks.map((task) => (
                    <div
                      key={task.id}
                      className={`flex items-center gap-3 text-sm py-1.5 ${
                        task.status === "done" || task.status === "skipped"
                          ? "opacity-60"
                          : ""
                      }`}
                    >
                      {/* Status icon */}
                      {task.status === "done" ? (
                        <Check className="size-4 text-green-500 shrink-0" />
                      ) : task.status === "skipped" ? (
                        <X className="size-4 text-[#666666] shrink-0" />
                      ) : (
                        <Minus className="size-4 text-[#666666] shrink-0" />
                      )}

                      <span
                        className={`text-[#E5E5E5] ${
                          task.status === "done" ? "line-through" : ""
                        }`}
                      >
                        {task.dishName}
                      </span>
                      <span className="text-[#666666]">
                        {task.ingredientName} &mdash; {task.quantity} {task.unit}
                      </span>

                      {task.assignedTo && (
                        <span className="text-xs text-[#D4A574] ml-auto">
                          {task.assignedTo}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

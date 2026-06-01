/**
 * @module components/copilot/PrepHistory
 *
 * History tab — past prep sessions sorted by date descending.
 * Each row expands to show a station-grouped brigade log of tasks.
 * Tasks are lazy-loaded via GET /api/prep/sessions/:id on expand.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Calendar,
  Check,
  X,
  Minus,
  Clock,
  Users,
  Flame,
} from "lucide-react";

const API = import.meta.env.VITE_API_URL ?? "";

interface HistoryTask {
  prepTaskId: string;
  taskDescription: string;
  ingredientName: string;
  quantityNeeded: number;
  unit: string;
  status: string;
  assignedTo: string | null;
  station: string | null;
  priorityTier: string;
  prepTimeMinutes: number | null;
  completedAt: string | null;
}

interface HistorySession {
  prepSessionId: string;
  prepDate: string;
  expectedCovers: number | null;
  actualCovers: number | null;
  isEnded: boolean;
  tasksCompleted: number;
  tasksSkipped: number;
  tasksTotal: number;
}

interface Props {
  teamView?: boolean;
}

const STATION_COLORS: Record<string, string> = {
  grill: "#EF4444",
  sauté: "#F97316",
  saute: "#F97316",
  fry: "#F59E0B",
  garde_manger: "#3B82F6",
  "garde manger": "#3B82F6",
  cold: "#3B82F6",
  pastry: "#EC4899",
  pâtissier: "#EC4899",
  patissier: "#EC4899",
  prep: "#8B5CF6",
  sauce: "#F97316",
  default: "#D4A574",
};

function getStationColor(station: string | null): string {
  if (!station) return STATION_COLORS.default;
  const key = station.toLowerCase().trim();
  return STATION_COLORS[key] ?? STATION_COLORS.default;
}

function formatStation(station: string | null): string {
  if (!station) return "General";
  return station
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const TIER_ORDER: Record<string, number> = {
  start_first: 0,
  then_these: 1,
  can_wait: 2,
};

export function PrepHistory({ teamView }: Props) {
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sessionTasks, setSessionTasks] = useState<
    Record<string, HistoryTask[]>
  >({});
  const [loadingTasks, setLoadingTasks] = useState<Set<string>>(new Set());

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (teamView) params.set("teamView", "true");
      const res = await fetch(
        `${API}/api/prep/history?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(
          (json as { error?: string }).error ?? `Failed (${res.status})`,
        );
      }
      const json = await res.json();
      setSessions(Array.isArray(json) ? json : (json.sessions ?? []));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load history",
      );
    } finally {
      setLoading(false);
    }
  }, [teamView]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const fetchSessionTasks = useCallback(
    async (sessionId: string) => {
      if (sessionTasks[sessionId]) return;
      setLoadingTasks((prev) => new Set(prev).add(sessionId));
      try {
        const params = new URLSearchParams();
        if (teamView) params.set("teamView", "true");
        const res = await fetch(
          `${API}/api/prep/sessions/${sessionId}?${params.toString()}`,
          { credentials: "include" },
        );
        if (!res.ok) return;
        const json = await res.json();
        const tasks: HistoryTask[] = (json.tasks ?? []).map(
          (t: Record<string, unknown>) => ({
            prepTaskId: t.prepTaskId,
            taskDescription: t.taskDescription,
            ingredientName: t.ingredientName,
            quantityNeeded: t.quantityNeeded,
            unit: t.unit,
            status: t.status,
            assignedTo: (t.assignedTo as string) ?? null,
            station: (t.station as string) ?? null,
            priorityTier: (t.priorityTier as string) ?? "can_wait",
            prepTimeMinutes: (t.prepTimeMinutes as number) ?? null,
            completedAt: (t.completedAt as string) ?? null,
          }),
        );
        setSessionTasks((prev) => ({ ...prev, [sessionId]: tasks }));
      } finally {
        setLoadingTasks((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
      }
    },
    [teamView, sessionTasks],
  );

  const toggleExpand = (sessionId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
        fetchSessionTasks(sessionId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-[#D4A574]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
        {error}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="text-center py-16">
        <Calendar className="size-10 mx-auto text-[#666666] mb-3" />
        <p className="text-[#999999]">No prep sessions yet.</p>
        <p className="text-sm text-[#666666] mt-1">
          Complete your first prep session to build your history.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((session) => {
        const isExpanded = expanded.has(session.prepSessionId);
        const total = session.tasksTotal ?? 0;
        const done = session.tasksCompleted ?? 0;
        const skipped = session.tasksSkipped ?? 0;
        const completionPct =
          total > 0 ? Math.round((done / total) * 100) : 0;
        const dateLabel = new Date(session.prepDate).toLocaleDateString(
          "en-US",
          { weekday: "short", month: "short", day: "numeric", year: "numeric" },
        );
        const tasks = sessionTasks[session.prepSessionId];
        const isLoadingTasks = loadingTasks.has(session.prepSessionId);

        return (
          <div
            key={session.prepSessionId}
            className="bg-[#161616] rounded-xl border border-[#2A2A2A] overflow-hidden transition-all duration-300"
          >
            {/* Summary row */}
            <button
              onClick={() => toggleExpand(session.prepSessionId)}
              className="w-full flex items-center gap-4 p-4 text-left hover:bg-[#1E1E1E]/50 transition-colors min-h-[44px]"
            >
              {isExpanded ? (
                <ChevronDown className="size-4 text-[#D4A574] shrink-0" />
              ) : (
                <ChevronRight className="size-4 text-[#666666] shrink-0" />
              )}

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{dateLabel}</p>
                <p className="text-xs text-[#666666]">
                  {session.expectedCovers != null
                    ? `${session.expectedCovers} expected`
                    : ""}
                  {session.actualCovers != null
                    ? `${session.expectedCovers != null ? " → " : ""}${session.actualCovers} actual`
                    : ""}
                  {session.expectedCovers != null ||
                  session.actualCovers != null
                    ? " covers"
                    : "covers not set"}
                </p>
              </div>

              <div className="w-24 shrink-0">
                <div className="flex items-center justify-between text-xs text-[#999999] mb-1">
                  <span>{completionPct}%</span>
                </div>
                <div className="w-full bg-[#1E1E1E] rounded-full h-2 overflow-hidden">
                  <div
                    className="h-2 rounded-full transition-all duration-500"
                    style={{
                      width: `${completionPct}%`,
                      background:
                        completionPct === 100
                          ? "linear-gradient(90deg, #22c55e, #16a34a)"
                          : completionPct > 50
                            ? "linear-gradient(90deg, #D4A574, #C4956A)"
                            : "linear-gradient(90deg, #EF4444, #DC2626)",
                    }}
                  />
                </div>
              </div>

              <div className="text-right shrink-0">
                <p className="text-xs text-[#999999]">
                  <span
                    className={
                      completionPct === 100
                        ? "text-green-400"
                        : "text-[#D4A574]"
                    }
                  >
                    {done}
                  </span>
                  {" / "}
                  {total}
                  {skipped > 0 && (
                    <span className="text-[#666666]">
                      {" "}
                      ({skipped} skipped)
                    </span>
                  )}
                </p>
              </div>
            </button>

            {/* Expanded brigade log */}
            {isExpanded && (
              <ExpandedSession
                tasks={tasks}
                isLoading={isLoadingTasks}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Expanded session — station-grouped brigade log                     */
/* ------------------------------------------------------------------ */

function ExpandedSession({
  tasks,
  isLoading,
}: {
  tasks: HistoryTask[] | undefined;
  isLoading: boolean;
}) {
  const grouped = useMemo(() => {
    if (!tasks || tasks.length === 0) return null;

    const stationMap = new Map<string, HistoryTask[]>();
    for (const t of tasks) {
      const key = t.station ?? "general";
      const list = stationMap.get(key) ?? [];
      list.push(t);
      stationMap.set(key, list);
    }

    // Sort tasks within each station by priority tier
    for (const [, list] of stationMap) {
      list.sort(
        (a, b) =>
          (TIER_ORDER[a.priorityTier] ?? 2) -
          (TIER_ORDER[b.priorityTier] ?? 2),
      );
    }

    // Sort stations: stations with more tasks first
    return Array.from(stationMap.entries()).sort(
      (a, b) => b[1].length - a[1].length,
    );
  }, [tasks]);

  const stats = useMemo(() => {
    if (!tasks || tasks.length === 0) return null;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const skipped = tasks.filter((t) => t.status === "skipped").length;
    const totalPrepMin = tasks.reduce(
      (sum, t) => sum + (t.prepTimeMinutes ?? 0),
      0,
    );
    const assignees = new Set(
      tasks.filter((t) => t.assignedTo).map((t) => t.assignedTo),
    );
    const stations = new Set(tasks.map((t) => t.station ?? "general"));
    return { completed, skipped, totalPrepMin, assignees, stations };
  }, [tasks]);

  if (isLoading) {
    return (
      <div className="border-t border-[#2A2A2A] flex justify-center py-8">
        <Loader2 className="size-5 animate-spin text-[#D4A574]" />
      </div>
    );
  }

  if (!grouped || !stats) {
    return (
      <div className="border-t border-[#2A2A2A] px-4 py-6">
        <p className="text-sm text-[#666666] text-center">
          No tasks recorded for this session.
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-[#2A2A2A]">
      {/* Summary strip */}
      <div className="px-4 py-3 bg-[#0A0A0A]/50 flex flex-wrap items-center gap-4 text-xs text-[#999999]">
        <span className="flex items-center gap-1.5">
          <Check className="size-3.5 text-green-500" />
          <span className="text-green-400 font-medium">
            {stats.completed}
          </span>{" "}
          done
          {stats.skipped > 0 && (
            <>
              <span className="text-[#333333] mx-1">·</span>
              <span className="text-[#666666]">{stats.skipped} skipped</span>
            </>
          )}
        </span>

        {stats.totalPrepMin > 0 && (
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5 text-[#D4A574]" />
            {stats.totalPrepMin >= 60
              ? `${Math.floor(stats.totalPrepMin / 60)}h ${stats.totalPrepMin % 60}m`
              : `${stats.totalPrepMin}m`}{" "}
            est. prep
          </span>
        )}

        {stats.assignees.size > 0 && (
          <span className="flex items-center gap-1.5">
            <Users className="size-3.5 text-[#D4A574]" />
            {stats.assignees.size}{" "}
            {stats.assignees.size === 1 ? "cook" : "cooks"}
          </span>
        )}

        <span className="flex items-center gap-1.5">
          <Flame className="size-3.5 text-[#D4A574]" />
          {stats.stations.size}{" "}
          {stats.stations.size === 1 ? "station" : "stations"}
        </span>
      </div>

      {/* Station groups */}
      <div className="divide-y divide-[#2A2A2A]/50">
        {grouped.map(([station, stationTasks]) => {
          const color = getStationColor(station);
          const stationDone = stationTasks.filter(
            (t) => t.status === "completed",
          ).length;

          return (
            <div key={station} className="relative">
              {/* Station color bar */}
              <div
                className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-full"
                style={{ backgroundColor: color }}
              />

              {/* Station header */}
              <div className="pl-5 pr-4 pt-3 pb-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color }}
                  >
                    {formatStation(station)}
                  </span>
                  <span className="text-[10px] text-[#444444]">
                    {stationDone}/{stationTasks.length}
                  </span>
                </div>
              </div>

              {/* Tasks */}
              <div className="pl-5 pr-4 pb-3 space-y-0.5">
                {stationTasks.map((task) => (
                  <TaskRow key={task.prepTaskId} task={task} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Individual task row                                                */
/* ------------------------------------------------------------------ */

function TaskRow({ task }: { task: HistoryTask }) {
  const isDone = task.status === "completed";
  const isSkipped = task.status === "skipped";
  const isInactive = isDone || isSkipped;

  return (
    <div
      className={`flex items-center gap-2.5 py-1.5 rounded-lg px-2 -mx-2 text-sm transition-colors ${
        isInactive
          ? "opacity-50 hover:opacity-70"
          : "hover:bg-[#1E1E1E]/50"
      }`}
    >
      {/* Status icon */}
      {isDone ? (
        <Check className="size-3.5 text-green-500 shrink-0" />
      ) : isSkipped ? (
        <X className="size-3.5 text-[#555555] shrink-0" />
      ) : (
        <Minus className="size-3.5 text-[#555555] shrink-0" />
      )}

      {/* Task description */}
      <span
        className={`flex-1 min-w-0 truncate ${
          isDone
            ? "line-through text-[#888888]"
            : isSkipped
              ? "text-[#666666]"
              : "text-[#E5E5E5]"
        }`}
      >
        {task.ingredientName}
      </span>

      {/* Quantity */}
      <span className="text-xs text-[#555555] tabular-nums shrink-0">
        {task.quantityNeeded} {task.unit}
      </span>

      {/* Priority dot for start_first items */}
      {task.priorityTier === "start_first" && !isInactive && (
        <span
          className="size-1.5 rounded-full bg-red-500 shrink-0"
          title="Start first"
        />
      )}

      {/* Assignee */}
      {task.assignedTo && (
        <span className="text-[10px] text-[#D4A574] bg-[#D4A574]/10 px-1.5 py-0.5 rounded shrink-0">
          {task.assignedTo}
        </span>
      )}
    </div>
  );
}

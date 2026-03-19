/**
 * @module components/copilot/PrepDashboard
 *
 * Today's Prep tab — shows a progress bar and three collapsible priority
 * tiers of prep tasks. Supports toggling task status, assigning staff,
 * skipping tasks, and ending the session.
 */

import { useState, useCallback } from "react";
import {
  Loader2,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Clock,
  MapPin,
  User,
  ClipboardList,
} from "lucide-react";

interface PrepTask {
  prepTaskId: string;
  prepSessionId: string;
  menuItemId: string | null;
  recipeId: string | null;
  taskDescription: string;
  ingredientName: string;
  quantityNeeded: number;
  unit: string;
  prepTimeMinutes: number | null;
  priorityScore: number;
  priorityTier: string;
  station: string | null;
  status: string;
  assignedTo: string | null;
  completedAt: string | null;
  createdDttm: string;
}

interface PrepSession {
  prepSessionId: string;
  userId: number;
  prepDate: string;
  expectedCovers: number | null;
  actualCovers: number | null;
  tasksTotal: number;
  tasksCompleted: number;
  tasksSkipped: number;
  notes: string | null;
  createdDttm: string;
  updatedDttm: string;
}

interface PrepSessionWithTasks {
  session: PrepSession;
  tasks: PrepTask[];
}

interface Props {
  sessionData: PrepSessionWithTasks | null;
  onSessionUpdate: (data: PrepSessionWithTasks | null) => void;
}

const TIER_CONFIG: {
  key: PrepTask["priorityTier"];
  label: string;
  borderClass: string;
  icon: string;
}[] = [
  { key: "start_first", label: "Start With These", borderClass: "border-l-[#D4A574]", icon: "\uD83D\uDD25" },
  { key: "then_these", label: "Next Up", borderClass: "border-l-[#999999]", icon: "" },
  { key: "can_wait", label: "Can Wait", borderClass: "border-l-[#2A2A2A]", icon: "" },
];

export function PrepDashboard({ sessionData, onSessionUpdate }: Props) {
  const session = sessionData?.session ?? null;
  const tasks = sessionData?.tasks ?? [];
  const [expandedTiers, setExpandedTiers] = useState<Set<string>>(
    new Set(["start_first", "then_these", "can_wait"]),
  );
  const [updatingTask, setUpdatingTask] = useState<string | null>(null);
  const [assigningTask, setAssigningTask] = useState<string | null>(null);
  const [assignName, setAssignName] = useState("");
  const [endingSession, setEndingSession] = useState(false);
  const [showEndForm, setShowEndForm] = useState(false);
  const [actualCovers, setActualCovers] = useState("");
  const [error, setError] = useState<string | null>(null);

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === "completed").length;
  const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const toggleTier = (tier: string) => {
    setExpandedTiers((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  };

  /** Update a task's status via PATCH. */
  const updateTaskStatus = useCallback(
    async (taskId: string, status: string) => {
      if (!sessionData) return;
      setUpdatingTask(taskId);
      setError(null);
      try {
        const res = await fetch(`/api/prep/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ status }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error((json as { error?: string }).error ?? `Failed (${res.status})`);
        }
        const updatedTasks = tasks.map((t) =>
          t.prepTaskId === taskId ? { ...t, status } : t,
        );
        onSessionUpdate({ ...sessionData, tasks: updatedTasks });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update task");
      } finally {
        setUpdatingTask(null);
      }
    },
    [sessionData, tasks, onSessionUpdate],
  );

  /** Assign a staff member to a task. */
  const assignTask = useCallback(
    async (taskId: string, name: string) => {
      if (!sessionData) return;
      setUpdatingTask(taskId);
      setError(null);
      try {
        const res = await fetch(`/api/prep/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ status: "pending", assignedTo: name || null }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error((json as { error?: string }).error ?? `Failed (${res.status})`);
        }
        const updatedTasks = tasks.map((t) =>
          t.prepTaskId === taskId ? { ...t, assignedTo: name || null } : t,
        );
        onSessionUpdate({ ...sessionData, tasks: updatedTasks });
        setAssigningTask(null);
        setAssignName("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to assign task");
      } finally {
        setUpdatingTask(null);
      }
    },
    [sessionData, tasks, onSessionUpdate],
  );

  /** End the prep session. */
  const endSession = async () => {
    if (!sessionData) return;
    const covers = Number(actualCovers);
    if (!covers || covers < 0) return;

    setEndingSession(true);
    setError(null);
    try {
      const res = await fetch(`/api/prep/sessions/${sessionData.session.prepSessionId}/end`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ actualCovers: covers }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `Failed (${res.status})`);
      }
      const data = await res.json();
      onSessionUpdate(data);
      setShowEndForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to end session");
    } finally {
      setEndingSession(false);
    }
  };

  // No session yet
  if (!sessionData) {
    return (
      <div className="text-center py-16">
        <ClipboardList className="size-10 mx-auto text-[#666666] mb-3" />
        <p className="text-[#999999]">No prep session for today yet.</p>
        <p className="text-sm text-[#666666] mt-1">Enter your expected covers above to get started.</p>
      </div>
    );
  }

  // Session ended
  if (session?.actualCovers != null) {
    return (
      <div className="text-center py-16">
        <Check className="size-10 mx-auto text-green-500 mb-3" />
        <p className="text-[#E5E5E5] font-medium">Today&apos;s session is complete.</p>
        <p className="text-sm text-[#666666] mt-1">
          {doneTasks} of {totalTasks} tasks completed &middot;{" "}
          {session?.expectedCovers} expected &rarr; {session?.actualCovers ?? "?"} actual covers
        </p>
        <p className="text-xs text-[#666666] mt-3">Check the History tab for full details.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Error banner */}
      {error && (
        <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 text-red-300 text-sm mb-4">
          {error}
        </div>
      )}

      {/* Progress bar */}
      <div className="bg-[#161616] rounded-xl p-5 border border-[#2A2A2A] mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-[#E5E5E5]">
            {doneTasks} of {totalTasks} tasks complete
          </span>
          <span className="text-sm font-bold text-[#D4A574]">{progressPct}%</span>
        </div>
        <div className="w-full bg-[#1E1E1E] rounded-full h-3">
          <div
            className="h-3 rounded-full bg-[#D4A574]/100 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-xs text-[#666666] mt-2">
          Expected covers: {session?.expectedCovers ?? "—"}
        </p>
      </div>

      {/* Priority tiers */}
      {TIER_CONFIG.map((tier) => {
        const tierTasks = tasks.filter((t) => t.priorityTier === tier.key);
        if (tierTasks.length === 0) return null;

        const isExpanded = expandedTiers.has(tier.key);
        const tierDone = tierTasks.filter((t) => t.status === "completed").length;

        return (
          <div key={tier.key} className="mb-6">
            {/* Tier header */}
            <button
              onClick={() => toggleTier(tier.key)}
              className="flex items-center gap-2 w-full text-left mb-3 group"
            >
              {isExpanded ? (
                <ChevronDown className="size-4 text-[#666666]" />
              ) : (
                <ChevronRight className="size-4 text-[#666666]" />
              )}
              <span className="text-sm font-semibold text-[#E5E5E5] group-hover:text-white transition-colors">
                {tier.icon ? `${tier.icon} ` : ""}{tier.label}
              </span>
              <span className="text-xs text-[#666666]">
                ({tierDone}/{tierTasks.length})
              </span>
            </button>

            {/* Task cards */}
            {isExpanded && (
              <div className="space-y-3">
                {tierTasks.map((task) => {
                  const isDone = task.status === "completed";
                  const isSkipped = task.status === "skipped";
                  const dimmed = isDone || isSkipped;

                  return (
                    <div
                      key={task.prepTaskId}
                      className={`bg-[#161616] rounded-lg p-4 border border-[#2A2A2A] border-l-4 ${tier.borderClass} flex items-start gap-3 transition-opacity ${
                        dimmed ? "opacity-50" : ""
                      }`}
                    >
                      {/* Checkbox */}
                      <button
                        onClick={() =>
                          updateTaskStatus(task.prepTaskId, isDone ? "pending" : "completed")
                        }
                        disabled={updatingTask === task.prepTaskId}
                        className={`mt-0.5 shrink-0 size-6 rounded border-2 flex items-center justify-center transition-colors min-h-[44px] min-w-[44px] ${
                          isDone
                            ? "bg-[#D4A574] border-[#D4A574] text-white"
                            : "border-[#2A2A2A] hover:border-[#D4A574]"
                        }`}
                        aria-label={isDone ? "Mark as pending" : "Mark as done"}
                      >
                        {updatingTask === task.prepTaskId ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : isDone ? (
                          <Check className="size-3" />
                        ) : null}
                      </button>

                      {/* Task details */}
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-white ${isDone ? "line-through" : ""}`}>
                          {task.taskDescription}
                        </p>
                        <p className={`text-sm text-[#999999] ${isDone ? "line-through" : ""}`}>
                          {task.ingredientName} &mdash; {task.quantityNeeded} {task.unit}
                        </p>

                        {/* Badges */}
                        <div className="flex flex-wrap gap-2 mt-2">
                          {task.prepTimeMinutes != null && (
                            <span className="inline-flex items-center gap-1 text-xs bg-[#1E1E1E] text-[#E5E5E5] px-2 py-1 rounded-full">
                              <Clock className="size-3" />
                              ~{task.prepTimeMinutes} min
                            </span>
                          )}
                          {task.station && (
                            <span className="inline-flex items-center gap-1 text-xs bg-[#1E1E1E] text-[#E5E5E5] px-2 py-1 rounded-full">
                              <MapPin className="size-3" />
                              {task.station}
                            </span>
                          )}
                          {task.assignedTo && (
                            <span className="inline-flex items-center gap-1 text-xs bg-[#D4A574]/20 text-[#D4A574] px-2 py-1 rounded-full">
                              <User className="size-3" />
                              {task.assignedTo}
                            </span>
                          )}
                        </div>

                        {/* Assign input (inline) */}
                        {assigningTask === task.prepTaskId && (
                          <div className="flex gap-2 mt-2">
                            <input
                              type="text"
                              placeholder="Staff name"
                              value={assignName}
                              onChange={(e) => setAssignName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") assignTask(task.prepTaskId, assignName);
                                if (e.key === "Escape") { setAssigningTask(null); setAssignName(""); }
                              }}
                              className="flex-1 px-3 py-1.5 bg-[#1E1E1E] border border-[#2A2A2A] rounded text-sm text-white focus:ring-2 focus:ring-[#D4A574]/50 min-h-[44px]"
                              autoFocus
                            />
                            <button
                              onClick={() => assignTask(task.prepTaskId, assignName)}
                              className="px-3 py-1.5 bg-[#D4A574] hover:bg-[#C4956A] text-white text-sm rounded min-h-[44px]"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => { setAssigningTask(null); setAssignName(""); }}
                              className="px-3 py-1.5 bg-[#1E1E1E] hover:bg-[#2A2A2A] text-[#E5E5E5] text-sm rounded min-h-[44px]"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex flex-col gap-1 shrink-0">
                        {!isDone && !isSkipped && assigningTask !== task.prepTaskId && (
                          <button
                            onClick={() => { setAssigningTask(task.prepTaskId); setAssignName(task.assignedTo ?? ""); }}
                            className="text-xs text-[#666666] hover:text-[#D4A574] transition-colors px-2 py-1 min-h-[44px]"
                          >
                            Assign
                          </button>
                        )}
                        {!isDone && !isSkipped && (
                          <button
                            onClick={() => updateTaskStatus(task.prepTaskId, "skipped")}
                            disabled={updatingTask === task.prepTaskId}
                            className="text-xs text-[#666666] hover:text-red-400 transition-colors px-2 py-1 min-h-[44px]"
                          >
                            Skip
                          </button>
                        )}
                        {isSkipped && (
                          <button
                            onClick={() => updateTaskStatus(task.prepTaskId, "pending")}
                            disabled={updatingTask === task.prepTaskId}
                            className="text-xs text-[#666666] hover:text-[#D4A574] transition-colors px-2 py-1 min-h-[44px]"
                          >
                            Undo
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* End session */}
      <div className="mt-8 border-t border-[#2A2A2A] pt-6">
        {!showEndForm ? (
          <button
            onClick={() => setShowEndForm(true)}
            className="flex items-center gap-2 px-5 py-3 bg-[#161616] hover:bg-[#1E1E1E] text-[#E5E5E5] hover:text-white border border-[#2A2A2A] rounded-lg transition-colors min-h-[44px]"
          >
            <X className="size-4" />
            End Session
          </button>
        ) : (
          <div className="bg-[#161616] rounded-xl p-5 border border-[#2A2A2A] max-w-md">
            <p className="text-sm font-medium text-[#E5E5E5] mb-3">
              How many covers did you actually serve?
            </p>
            <div className="flex gap-3">
              <input
                type="number"
                min={0}
                placeholder="Actual covers"
                value={actualCovers}
                onChange={(e) => setActualCovers(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") endSession(); }}
                className="flex-1 px-4 py-3 bg-[#1E1E1E] border border-[#2A2A2A] rounded-lg text-white focus:ring-2 focus:ring-[#D4A574]/50 min-h-[44px]"
              />
              <button
                onClick={endSession}
                disabled={endingSession || !actualCovers}
                className="px-5 py-3 bg-[#D4A574] hover:bg-[#C4956A] disabled:bg-[#2A2A2A] disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors min-h-[44px]"
              >
                {endingSession ? <Loader2 className="size-5 animate-spin" /> : "End"}
              </button>
              <button
                onClick={() => setShowEndForm(false)}
                className="px-4 py-3 bg-[#1E1E1E] hover:bg-[#2A2A2A] text-[#E5E5E5] rounded-lg transition-colors min-h-[44px]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

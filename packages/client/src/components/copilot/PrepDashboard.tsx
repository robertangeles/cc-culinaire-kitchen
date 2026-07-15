/**
 * @module components/copilot/PrepDashboard
 *
 * Today's Prep tab — shows a progress bar and three collapsible priority
 * tiers of prep tasks. Supports toggling task status, assigning staff,
 * skipping tasks, and ending the session.
 */

import { useState, useCallback, useEffect } from "react";
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
  AlertTriangle,
  Pencil,
  Printer,
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
  ingredientId: string | null;
  onHandQty: number | null;
  prepNeeded: number | null;
  useBy: string | null;
  isOverPrep: boolean;
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
  isEnded: boolean;
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
  onEditSelections?: () => void;
  teamView?: boolean;
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

function fmtQty(value: number, unit: string): string {
  const u = unit.toLowerCase();
  if (u === "kg" || u === "l" || u === "lb") return value.toFixed(1).replace(/\.0$/, "");
  return Math.round(value).toString();
}

function buildPrintHtml(session: PrepSession | null, tasks: PrepTask[]): string {
  const date = session?.prepDate ? new Date(session.prepDate).toLocaleDateString("en-AU", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : "Today";
  const covers = session?.expectedCovers ?? "—";

  const byStation = new Map<string, PrepTask[]>();
  for (const t of tasks) {
    const station = t.station || "Other";
    const list = byStation.get(station);
    if (list) list.push(t); else byStation.set(station, [t]);
  }

  const stationHtml = [...byStation.entries()].map(([station, stationTasks]) => `
    <div style="break-inside:avoid;margin-bottom:24px">
      <h2 style="font-size:16px;font-weight:700;border-bottom:2px solid #333;padding-bottom:4px;margin-bottom:8px">${station}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:1px solid #ccc;text-align:left">
          <th style="padding:4px 8px;width:30px"></th>
          <th style="padding:4px 8px">Ingredient</th>
          <th style="padding:4px 8px;text-align:right">Need</th>
          <th style="padding:4px 8px;text-align:right">On Hand</th>
          <th style="padding:4px 8px;text-align:right;font-weight:700">Prep</th>
          <th style="padding:4px 8px">For</th>
        </tr></thead>
        <tbody>${stationTasks.map((t) => {
          const qty = fmtQty(t.quantityNeeded, t.unit);
          const onHand = t.onHandQty != null ? fmtQty(t.onHandQty, t.unit) : "—";
          const prep = t.prepNeeded != null ? fmtQty(t.prepNeeded, t.unit) : qty;
          const dishes = t.taskDescription.includes("for ") ? t.taskDescription.split("for ").slice(1).join("for ") : "";
          return `<tr style="border-bottom:1px solid #eee">
            <td style="padding:4px 8px"><div style="width:14px;height:14px;border:1.5px solid #999;border-radius:3px"></div></td>
            <td style="padding:4px 8px;font-weight:500">${t.ingredientName}</td>
            <td style="padding:4px 8px;text-align:right">${qty} ${t.unit}</td>
            <td style="padding:4px 8px;text-align:right;color:#666">${onHand} ${t.unit}</td>
            <td style="padding:4px 8px;text-align:right;font-weight:700">${prep} ${t.unit}</td>
            <td style="padding:4px 8px;color:#666;font-size:11px">${dishes}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>
    </div>
  `).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Prep Sheet — ${date}</title>
    <style>
      body{font-family:-apple-system,system-ui,sans-serif;margin:24px;color:#111}
      @media print{body{margin:12px}h1{font-size:18px}}
    </style></head><body>
    <h1 style="font-size:20px;margin-bottom:4px">Prep Sheet — ${date}</h1>
    <p style="color:#666;font-size:13px;margin-bottom:20px">Expected covers: ${covers} | ${tasks.length} items | Printed ${new Date().toLocaleTimeString()}</p>
    ${stationHtml}
  </body></html>`;
}

export function PrepDashboard({ sessionData, onSessionUpdate, onEditSelections }: Props) {
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

  const handlePrint = useCallback(() => {
    const html = buildPrintHtml(session, tasks);
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.left = "-9999px";
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    if (!doc) { document.body.removeChild(iframe); return; }
    doc.open();
    doc.write(html);
    doc.close();
    iframe.contentWindow?.addEventListener("afterprint", () => document.body.removeChild(iframe));
    setTimeout(() => iframe.contentWindow?.print(), 300);
  }, [session, tasks]);

  // Waste alert: check if today's prep ingredients overlap with top waste items
  const [wasteAlertItems, setWasteAlertItems] = useState<string[]>([]);

  useEffect(() => {
    if (!sessionData || tasks.length === 0) return;

    (async () => {
      try {
        // Fetch waste summary for last 30 days
        const now = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(now.getDate() - 30);
        const params = new URLSearchParams({
          startDate: thirtyDaysAgo.toISOString(),
          endDate: now.toISOString(),
        });
        const res = await fetch(`/api/waste/summary?${params}`, { credentials: "include" });
        if (!res.ok) return;
        const summary = await res.json();
        const topWasteNames: string[] = (summary.topByCost ?? [])
          .slice(0, 5)
          .map((w: { name: string }) => w.name.toLowerCase());

        if (topWasteNames.length === 0) return;

        // Find prep ingredients that are in the top waste list
        const prepIngredients = tasks.map((t) => t.ingredientName.toLowerCase());
        const overlaps = topWasteNames.filter((w) =>
          prepIngredients.some((p) => p.includes(w) || w.includes(p)),
        );

        if (overlaps.length > 0) {
          setWasteAlertItems(overlaps);
        }
      } catch {
        // silent — supplementary data
      }
    })();
  }, [sessionData, tasks]);

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
  const endSession = async (withActuals: boolean) => {
    if (!sessionData?.session?.prepSessionId) return;
    setEndingSession(true);
    setError(null);
    try {
      const covers = withActuals ? Number(actualCovers) : undefined;
      const body: Record<string, unknown> = {};
      if (covers && covers > 0) body.actualCovers = covers;
      const res = await fetch(`/api/prep/sessions/${sessionData.session.prepSessionId}/end`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `Failed (${res.status})`);
      }
      await res.json();
      onSessionUpdate(null);
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

      {/* Waste alert banner (Connection 4: Waste -> Copilot) */}
      {wasteAlertItems.length > 0 && (
        <div className="bg-[#D4A574]/10 border border-[#D4A574]/20 rounded-lg p-4 mb-4 flex items-start gap-3">
          <AlertTriangle className="size-5 text-[#D4A574] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-[#D4A574]">Watch your portions</p>
            <p className="text-xs text-[#D4A574]/80 mt-0.5">
              <span className="font-semibold">{wasteAlertItems.join(" and ")}</span>
              {" "}
              {wasteAlertItems.length === 1 ? "is" : "are"} among your top waste items this month.
              Pay extra attention to portioning during prep.
            </p>
          </div>
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
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-[#666666]">
            Expected covers: {session?.expectedCovers ?? "—"}
          </p>
          <div className="flex items-center gap-3">
            {onEditSelections && (
              <button
                onClick={onEditSelections}
                className="inline-flex items-center gap-1.5 text-xs text-[#D4A574] hover:text-[#C4956A] transition-colors"
              >
                <Pencil className="size-3" />
                Edit selections
              </button>
            )}
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 text-xs text-[#999999] hover:text-white transition-colors"
            >
              <Printer className="size-3" />
              Print
            </button>
          </div>
        </div>
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

            {/* Task rows — compact single-line layout */}
            {isExpanded && (
              <div className="space-y-1">
                {tierTasks.map((task) => {
                  const isDone = task.status === "completed";
                  const isSkipped = task.status === "skipped";
                  const dimmed = isDone || isSkipped;

                  return (
                    <div key={task.prepTaskId}>
                      <div
                        className={`bg-[#161616] rounded-xl px-3 py-2.5 border border-[#2A2A2A] border-l-4 ${tier.borderClass} flex items-center gap-2.5 transition-opacity ${
                          dimmed ? "opacity-40" : ""
                        }`}
                      >
                        {/* Checkbox */}
                        <button
                          onClick={() =>
                            updateTaskStatus(task.prepTaskId, isDone ? "pending" : "completed")
                          }
                          disabled={updatingTask === task.prepTaskId}
                          className={`shrink-0 size-5 rounded border-2 flex items-center justify-center transition-colors ${
                            isDone
                              ? "bg-[#D4A574] border-[#D4A574] text-white"
                              : "border-[#2A2A2A] hover:border-[#D4A574]"
                          }`}
                          aria-label={isDone ? "Mark as pending" : "Mark as done"}
                        >
                          {updatingTask === task.prepTaskId ? (
                            <Loader2 className="size-2.5 animate-spin" />
                          ) : isDone ? (
                            <Check className="size-2.5" />
                          ) : null}
                        </button>

                        {/* Ingredient + quantity breakdown */}
                        <span className={`font-semibold text-sm text-white truncate ${isDone ? "line-through" : ""}`}>
                          {task.ingredientName}
                        </span>
                        {task.onHandQty != null ? (
                          <span className={`text-sm whitespace-nowrap flex items-center gap-1.5 ${isDone ? "line-through" : ""}`}>
                            <span className="font-medium text-[#D4A574]">
                              {fmtQty(task.quantityNeeded, task.unit)} {task.unit}
                            </span>
                            <span className={`text-[10px] ${task.prepNeeded != null && task.prepNeeded <= 0 ? "text-green-400/70" : "text-[#666666]"}`}>
                              {task.prepNeeded != null && task.prepNeeded <= 0
                                ? `In stock (${fmtQty(task.onHandQty, task.unit)} ${task.unit} on hand)`
                                : `${fmtQty(task.onHandQty, task.unit)} ${task.unit} on hand`}
                            </span>
                          </span>
                        ) : (
                          <span className={`text-sm text-[#D4A574] font-medium whitespace-nowrap ${isDone ? "line-through" : ""}`}>
                            {fmtQty(task.quantityNeeded, task.unit)} {task.unit}
                          </span>
                        )}

                        {/* Inline badges */}
                        <div className="flex items-center gap-1.5 ml-auto shrink-0">
                          {task.station && (
                            <span className="inline-flex items-center gap-1 text-[10px] bg-[#1E1E1E] text-[#999999] px-1.5 py-0.5 rounded-full">
                              <MapPin className="size-2.5" />
                              {task.station}
                            </span>
                          )}
                          {task.prepTimeMinutes != null && (
                            <span className="inline-flex items-center gap-1 text-[10px] bg-[#1E1E1E] text-[#999999] px-1.5 py-0.5 rounded-full">
                              <Clock className="size-2.5" />
                              {task.prepTimeMinutes}m
                            </span>
                          )}
                          {task.assignedTo && (
                            <span className="inline-flex items-center gap-1 text-[10px] bg-[#D4A574]/15 text-[#D4A574] px-1.5 py-0.5 rounded-full">
                              <User className="size-2.5" />
                              {task.assignedTo}
                            </span>
                          )}

                          {/* Actions — inline, minimal */}
                          {!isDone && !isSkipped && assigningTask !== task.prepTaskId && (
                            <button
                              onClick={() => { setAssigningTask(task.prepTaskId); setAssignName(task.assignedTo ?? ""); }}
                              className="text-[10px] text-[#666666] hover:text-[#D4A574] transition-colors px-1"
                            >
                              Assign
                            </button>
                          )}
                          {!isDone && !isSkipped && (
                            <button
                              onClick={() => updateTaskStatus(task.prepTaskId, "skipped")}
                              disabled={updatingTask === task.prepTaskId}
                              className="text-[10px] text-[#666666] hover:text-red-400 transition-colors px-1"
                            >
                              Skip
                            </button>
                          )}
                          {isSkipped && (
                            <button
                              onClick={() => updateTaskStatus(task.prepTaskId, "pending")}
                              disabled={updatingTask === task.prepTaskId}
                              className="text-[10px] text-[#666666] hover:text-[#D4A574] transition-colors px-1"
                            >
                              Undo
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Dishes this ingredient is for (subtle, below the row) */}
                      {!dimmed && task.taskDescription.includes("for ") && (
                        <p className="text-[10px] text-[#666666] pl-10 mt-0.5 mb-1 truncate">
                          {task.taskDescription.split("for ").slice(1).join("for ")}
                        </p>
                      )}

                      {/* Assign input (inline, expands below the row) */}
                      {assigningTask === task.prepTaskId && (
                        <div className="flex gap-2 ml-10 mt-1 mb-2">
                          <input
                            type="text"
                            placeholder="Staff name"
                            value={assignName}
                            onChange={(e) => setAssignName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") assignTask(task.prepTaskId, assignName);
                              if (e.key === "Escape") { setAssigningTask(null); setAssignName(""); }
                            }}
                            className="flex-1 px-3 py-1.5 bg-[#1E1E1E] border border-[#2A2A2A] rounded-lg text-sm text-white focus:ring-2 focus:ring-[#D4A574]/50"
                            autoFocus
                          />
                          <button
                            onClick={() => assignTask(task.prepTaskId, assignName)}
                            className="px-3 py-1.5 bg-[#D4A574] hover:bg-[#C4956A] text-[#0A0A0A] text-xs font-medium rounded-lg"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setAssigningTask(null); setAssignName(""); }}
                            className="px-3 py-1.5 bg-[#1E1E1E] hover:bg-[#2A2A2A] text-[#999999] text-xs rounded-lg"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
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
            className="flex items-center gap-2 px-5 py-3 bg-[#161616] hover:bg-[#1E1E1E] text-[#E5E5E5] hover:text-white border border-[#2A2A2A] rounded-xl transition-colors min-h-[44px]"
          >
            <X className="size-4" />
            End Session
          </button>
        ) : (
          <div className="bg-[#0A0A0A]/80 backdrop-blur-sm rounded-2xl p-6 border border-[#2A2A2A] max-w-md shadow-lg shadow-black/20">
            <p className="text-sm font-semibold text-white mb-1">
              Wrap up this prep session
            </p>
            <p className="text-xs text-[#666666] mb-4">
              Logging actual covers helps your next forecast — but it&apos;s optional.
            </p>
            <div className="flex items-center gap-3 mb-4">
              <input
                type="number"
                min={0}
                placeholder="Actual covers (optional)"
                value={actualCovers}
                onChange={(e) => setActualCovers(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") endSession(true); }}
                className="flex-1 px-4 py-2.5 bg-[#161616] border border-[#2A2A2A] rounded-xl text-white text-sm placeholder-[#666666] focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent min-h-[44px]"
              />
              {actualCovers && (
                <button
                  onClick={() => endSession(true)}
                  disabled={endingSession}
                  className="px-5 py-2.5 bg-[#D4A574] hover:bg-[#C4956A] disabled:opacity-50 text-[#0A0A0A] font-semibold rounded-xl transition-colors min-h-[44px] whitespace-nowrap"
                >
                  {endingSession ? <Loader2 className="size-4 animate-spin" /> : "Save & End"}
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => endSession(false)}
                disabled={endingSession}
                className="flex-1 px-4 py-2.5 bg-[#1E1E1E] hover:bg-[#2A2A2A] text-[#999999] hover:text-white text-sm font-medium rounded-xl transition-colors min-h-[44px]"
              >
                End without logging
              </button>
              <button
                onClick={() => { setShowEndForm(false); setActualCovers(""); }}
                className="px-4 py-2.5 text-[#666666] hover:text-[#999999] text-sm transition-colors min-h-[44px]"
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

/**
 * @module components/roster/MyShiftsView
 *
 * Staff self-service: your own upcoming shifts, with confirm/decline for
 * anything still Pending. Own-only — the server enforces this
 * (roster:read-own), scoped to the caller's own assignments.
 */

import { useState } from "react";
import { CalendarDays, Check, Loader2, X } from "lucide-react";
import { formatAuDate } from "@culinaire/shared";
import { useMyShifts } from "../../hooks/useRoster.js";
import { EmptyState } from "../ui/EmptyState.js";

function formatShiftTime(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const time = (d: Date) => d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  return `${formatAuDate(start)}, ${time(start)}–${time(end)}`;
}

export function MyShiftsView() {
  const { shifts, isLoading, error, respond } = useMyShifts();
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [respondError, setRespondError] = useState<string | null>(null);

  async function handleRespond(assignmentId: string, response: "Confirmed" | "Declined") {
    setRespondingId(assignmentId);
    setRespondError(null);
    try {
      await respond(assignmentId, response);
    } catch (err) {
      setRespondError(err instanceof Error ? err.message : "Failed to respond");
    } finally {
      setRespondingId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 text-gold animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  if (shifts.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No shifts yet"
        body="Shifts you're assigned to will show up here once a manager builds the roster."
        variant="invitation"
      />
    );
  }

  return (
    <div className="space-y-4 animate-fade-in-up">
      {respondError && <p className="text-sm text-red-400">{respondError}</p>}
      <div className="rounded-xl border border-dark-200 overflow-hidden">
        {shifts.map((s) => (
          <div
            key={s.assignmentId}
            className="flex items-center justify-between border-b border-dark-200/30 px-4 py-3 last:border-b-0"
          >
            <div className="text-sm">
              <span className="text-white font-medium">{formatShiftTime(s.startDatetime, s.endDatetime)}</span>
              <div className="mt-0.5 text-xs text-dark-600">
                {s.assignmentStatus === "Pending" && <span className="text-dark-500">Awaiting your response</span>}
                {s.assignmentStatus === "Confirmed" && <span className="text-emerald-400">Confirmed</span>}
                {s.assignmentStatus === "Declined" && <span className="text-red-400">Declined</span>}
              </div>
            </div>
            {s.assignmentStatus === "Pending" && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleRespond(s.assignmentId, "Confirmed")}
                  disabled={respondingId === s.assignmentId}
                  className="flex items-center gap-1 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-dark transition-all hover:bg-gold-hover disabled:opacity-50"
                >
                  <Check className="size-3.5" /> Confirm
                </button>
                <button
                  type="button"
                  onClick={() => handleRespond(s.assignmentId, "Declined")}
                  disabled={respondingId === s.assignmentId}
                  className="flex items-center gap-1 rounded-lg border border-dark-200 px-3 py-1.5 text-xs text-dark-600 hover:text-white transition-all disabled:opacity-50"
                >
                  <X className="size-3.5" /> Decline
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

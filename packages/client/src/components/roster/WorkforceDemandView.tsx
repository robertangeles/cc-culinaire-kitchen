/**
 * @module components/roster/WorkforceDemandView
 *
 * Recommended staffing hours per kitchen station (Phase 3, Slice 1),
 * derived from historical prep workload scaled by a target date's expected
 * covers. Reports by STATION, not role — see workforceDemandService.ts's
 * module doc for why. `inputsNotUsed` is always shown, same "disclose the
 * gap" posture PublishPanel's Award-coverage line already uses — silence
 * about what wasn't measured is never allowed to read as "fully accounted
 * for."
 */

import { useEffect, useState } from "react";
import { CalendarRange, Gauge, Loader2, MapPin } from "lucide-react";
import { useLocation } from "../../context/LocationContext.js";
import { useWorkforceDemand } from "../../hooks/useWorkforce.js";
import { EmptyState } from "../ui/EmptyState.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function confidenceTone(confidence: number): string {
  if (confidence >= 0.7) return "from-gold to-gold-hover";
  if (confidence >= 0.3) return "from-amber-500 to-amber-400";
  return "from-red-500 to-red-400";
}

export function WorkforceDemandView() {
  const { selectedLocationId } = useLocation();
  const [forDate, setForDate] = useState(() => todayIso());
  const { result, isLoading, error, fetchDemand } = useWorkforceDemand();

  useEffect(() => {
    if (selectedLocationId) void fetchDemand(selectedLocationId, forDate);
  }, [selectedLocationId, forDate, fetchDemand]);

  if (!selectedLocationId) {
    return (
      <EmptyState
        icon={MapPin}
        title="No venue selected"
        body="Pick a venue from the location switcher to see its staffing recommendations."
      />
    );
  }

  return (
    <div className="space-y-4 animate-fade-in-up">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-dark-600">Recommended staffing hours per station, from prep history.</p>
        <label className="flex items-center gap-2 text-xs text-dark-600">
          <CalendarRange className="size-4" aria-hidden="true" />
          <input
            type="date"
            value={forDate}
            onChange={(e) => setForDate(e.target.value)}
            className="rounded-lg bg-dark-100 border border-dark-200 px-3 py-1.5 text-sm text-white focus:outline-none focus:border-gold/50"
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 text-gold animate-spin" />
        </div>
      ) : (
        result &&
        !error && (
          <>
            <p className="text-xs text-dark-500">
              Based on {result.targetCovers} expected covers on {result.forDate}.
            </p>

            {result.stations.length === 0 ? (
              <EmptyState
                icon={Gauge}
                title="No prep history for this station yet"
                body="Recommendations build up once prep sessions with logged task minutes exist at this venue."
              />
            ) : (
              <div className="rounded-xl border border-dark-200 overflow-hidden">
                {result.stations.map((s) => (
                  <div
                    key={s.station}
                    className="flex items-center justify-between gap-4 border-b border-dark-200/30 px-4 py-3 last:border-b-0"
                  >
                    <span className="text-sm text-white">{s.station}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-semibold text-white">{s.recommendedHours}h</span>
                      <div className="flex flex-col items-center">
                        <div className="w-16 h-1.5 rounded-full bg-dark-200 overflow-hidden">
                          <div
                            className={`h-full rounded-full bg-gradient-to-r ${confidenceTone(s.confidence)}`}
                            style={{ width: `${Math.round(s.confidence * 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-dark-500 mt-0.5">
                          {Math.round(s.confidence * 100)}% · {s.basedOnDays}d history
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-dark-500">
              Based on: {result.inputsUsed.join(", ")}.{" "}
              <span className="text-dark-600">Not used: {result.inputsNotUsed.join(", ")}.</span> Recommendations
              only — the operator retains control.
            </p>
          </>
        )
      )}
    </div>
  );
}

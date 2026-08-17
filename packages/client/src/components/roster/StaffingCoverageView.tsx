/**
 * @module components/roster/StaffingCoverageView
 *
 * Day x role coverage heat map for one venue (Phase 3, Slice 2). Cell =
 * rostered hours for that role on that day; colour = the worst compliance
 * status among that day/role's assignees, reusing the same canAssign gate
 * and refusal wording assignStaff's own live check already uses — no
 * hardcoded certification names, no "alcohol shift" flag.
 *
 * No charting library in this repo — hand-rolled CSS grid, same convention
 * MiniCalendar.tsx and MenuEngineeringMatrix.tsx already establish.
 */

import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Grid3x3, MapPin } from "lucide-react";
import { useLocation } from "../../context/LocationContext.js";
import { useStaffingCoverage, type CoverageCell, type CoverageCellStatus } from "../../hooks/useWorkforce.js";
import { EmptyState } from "../ui/EmptyState.js";
import { StatRow } from "../ui/StatRow.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(base: string, days: number): string {
  const [y, m, d] = base.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function cellTone(status: CoverageCellStatus): string {
  if (status === "ok") return "bg-emerald-500/15 border-emerald-500/30 text-emerald-300";
  if (status === "unstaffed") return "bg-dark-300/40 border-dark-300 text-dark-500";
  return "bg-red-500/15 border-red-500/30 text-red-300";
}

function cellLabel(status: CoverageCellStatus): string {
  if (status === "ok") return "Covered";
  if (status === "unstaffed") return "Unstaffed";
  return status[0].toUpperCase() + status.slice(1);
}

export function StaffingCoverageView() {
  const { selectedLocationId } = useLocation();
  const [from, setFrom] = useState(() => todayIso());
  const to = useMemo(() => addDaysIso(from, 6), [from]);
  const { result, isLoading, error, fetchCoverage } = useStaffingCoverage();

  useEffect(() => {
    if (selectedLocationId) void fetchCoverage(selectedLocationId, from, to);
  }, [selectedLocationId, from, to, fetchCoverage]);

  if (!selectedLocationId) {
    return (
      <EmptyState
        icon={MapPin}
        title="No venue selected"
        body="Pick a venue from the location switcher to see its staffing coverage."
      />
    );
  }

  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(from, i));
  const cellByKey = new Map<string, CoverageCell>();
  for (const c of result?.cells ?? []) cellByKey.set(`${c.date}::${c.roleId}`, c);

  return (
    <div className="space-y-4 animate-fade-in-up">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-dark-600">Which roles are covered, at risk, or unstaffed — one week at a time.</p>
        <label className="flex items-center gap-2 text-xs text-dark-600">
          <CalendarRange className="size-4" aria-hidden="true" />
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg bg-dark-100 border border-dark-200 px-3 py-1.5 text-sm text-white focus:outline-none focus:border-gold/50"
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      {!isLoading && result && (
        <StatRow
          entries={[
            { label: "fully covered", value: result.summary.covered },
            { label: "at risk", value: result.summary.atRisk },
            { label: "unstaffed", value: result.summary.unstaffed },
          ]}
        />
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="size-6 rounded-full border-2 border-gold border-t-transparent animate-spin" />
        </div>
      ) : result && result.roles.length === 0 ? (
        <EmptyState
          icon={Grid3x3}
          title="No shifts scheduled this week"
          body="Build the roster in the Shifts tab — coverage shows up here once shifts exist."
        />
      ) : (
        result && (
          <div className="overflow-x-auto rounded-xl border border-dark-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-200">
                  <th className="px-4 py-2 text-left text-xs font-medium text-dark-500 uppercase tracking-wider">Role</th>
                  {days.map((d) => (
                    <th key={d} className="px-2 py-2 text-center text-xs font-medium text-dark-500 uppercase tracking-wider">
                      {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", timeZone: "UTC" })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.roles.map((role) => (
                  <tr key={role.roleId} className="border-b border-dark-200/30 last:border-b-0">
                    <td className="px-4 py-2 text-white whitespace-nowrap">{role.roleName}</td>
                    {days.map((d) => {
                      const cell = cellByKey.get(`${d}::${role.roleId}`);
                      if (!cell) {
                        return <td key={d} className="px-2 py-2 text-center text-dark-700">—</td>;
                      }
                      return (
                        <td key={d} className="px-2 py-1.5 text-center">
                          <span
                            title={cell.detail ?? cellLabel(cell.status)}
                            className={`inline-flex min-w-16 flex-col items-center rounded-lg border px-2 py-1 ${cellTone(cell.status)}`}
                          >
                            <span className="text-xs font-semibold">{cell.rosteredHours}h</span>
                            <span className="text-[10px]">{cellLabel(cell.status)}</span>
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

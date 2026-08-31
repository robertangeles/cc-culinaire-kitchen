/**
 * @module components/roster/RosterCalendarView
 *
 * Drag-to-build week calendar for Roster. X = 7 day columns (Mon-Sun), each
 * subdivided into one sub-lane per role at this venue; Y = time-of-day, a
 * full 24h scroll (default position ~6am) — never a fixed business-hours
 * window that could clip an odd-hours shift. Role is immutable on a shift
 * once created (server-enforced), so it has to be a spatial dimension of
 * the grid: a drag-create gesture inside one lane already knows its role
 * without an extra picker step, and a move/resize drag never lets a shift
 * cross into a different role's lane.
 *
 * Four gestures, four existing endpoints — no new mutation surface beyond
 * the one new read endpoint (GET /shifts/calendar, via useRosterCalendar):
 *   - drag empty lane space      -> create (POST /shifts)
 *   - drag an existing Draft block -> reschedule (PUT /shifts/:id)
 *   - drag a Draft block's edge  -> resize (same PUT)
 *   - drag a staff chip onto a Draft block -> assign (POST .../assignments)
 * Published shifts render read-only (no drag handles) — the server 409s on
 * any of those four for a non-Draft shift, so the grid must never offer a
 * gesture the API will reject.
 *
 * No charting/DnD library — hand-rolled Pointer Events + elementFromPoint,
 * same "hand-roll it" convention as MiniCalendar.tsx/StaffingCoverageView.tsx.
 * Position math (time<->pixel, day-column, lane index) lives in the pure,
 * separately-unit-tested lib/rosterCalendarMath.ts — this file only wires
 * that math to pointer events and renders the result.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight, Loader2, Users } from "lucide-react";
import { useLocation } from "../../context/LocationContext.js";
import { useHasPermission } from "../../hooks/useHasPermission.js";
import { useRosterRoles, useOrgMembers, useRosterCalendar, type CalendarShift, type RosterRole } from "../../hooks/useRoster.js";
import { EmptyState } from "../ui/EmptyState.js";
import {
  minutesForPixel,
  pixelForMinutes,
  snapMinutes,
  minutesSinceMidnight,
  addDaysIso,
  mondayOfWeek,
  laneIndexForRole,
} from "../../lib/rosterCalendarMath.js";

const HOUR_HEIGHT = 48; // px per hour row
const GRID_HEIGHT = 24 * HOUR_HEIGHT;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const ROLE_ACCENT = [
  "border-l-rose-500", "border-l-amber-500", "border-l-emerald-500", "border-l-cyan-500",
  "border-l-blue-500", "border-l-violet-500", "border-l-fuchsia-500", "border-l-teal-500",
];
function roleAccent(roleId: string, roleIds: string[]): string {
  const idx = laneIndexForRole(roleId, roleIds);
  return ROLE_ACCENT[idx >= 0 ? idx % ROLE_ACCENT.length : 0];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** dayIso + minutes-since-local-midnight -> a real Date, browser-local (matches ShiftsManager's own time convention). */
function dateFromDayAndMinutes(dayIso: string, minutes: number): Date {
  const [y, m, d] = dayIso.split("-").map(Number);
  return new Date(y, m - 1, d, 0, minutes, 0, 0);
}

function formatHourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? "am" : "pm"}`;
}

function formatTimeRange(startIso: string, endIso: string): string {
  const fmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  return `${new Date(startIso).toLocaleTimeString("en-AU", fmt)}–${new Date(endIso).toLocaleTimeString("en-AU", fmt)}`;
}

/** The lane element (day x role cell) currently under a client point, if any. */
function laneAt(clientX: number, clientY: number): HTMLElement | null {
  const el = document.elementFromPoint(clientX, clientY);
  return (el?.closest("[data-day-iso][data-role-id]") as HTMLElement) ?? null;
}

/** If `shiftId` is the one currently being moved/resized, its live (start, end) minutes — else null. */
function dragOverrideFor(drag: DragState | null, shiftId: string): { start: number; end: number } | null {
  if (!drag) return null;
  if (drag.kind === "move" && drag.shift.shiftId === shiftId) {
    return { start: drag.startMinutes, end: drag.startMinutes + drag.durationMinutes };
  }
  if (drag.kind === "resize" && drag.shift.shiftId === shiftId) {
    return { start: drag.startMinutes, end: drag.endMinutes };
  }
  return null;
}

type DragState =
  | { kind: "create"; dayIso: string; roleId: string; anchorMinutes: number; nowMinutes: number }
  | { kind: "move"; shift: CalendarShift; grabOffsetMinutes: number; durationMinutes: number; dayIso: string; startMinutes: number }
  | { kind: "resize"; shift: CalendarShift; edge: "top" | "bottom"; startMinutes: number; endMinutes: number }
  | { kind: "assign"; userId: number; staffName: string; overShiftId: string | null };

export function RosterCalendarView() {
  const { locations, selectedLocationId } = useLocation();
  const hasPermission = useHasPermission();
  const canManage = hasPermission("roster:manage");
  const orgId = locations.find((l) => l.storeLocationId === selectedLocationId)?.organisationId ?? null;

  const { roles } = useRosterRoles();
  const venueRoles = useMemo(
    () => roles.filter((r: RosterRole) => r.storeLocationId === null || r.storeLocationId === selectedLocationId),
    [roles, selectedLocationId],
  );
  const roleIds = useMemo(() => venueRoles.map((r) => r.rosterRoleId), [venueRoles]);

  const { members } = useOrgMembers(orgId);
  const [weekStart, setWeekStart] = useState(() => mondayOfWeek(todayIso()));
  const weekEnd = addDaysIso(weekStart, 6);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i)), [weekStart]);

  const { calendarShifts, isLoading, error, create, updateTime, assign } = useRosterCalendar(
    selectedLocationId,
    // Padded a day on each side: the query boundary is bare UTC midnight,
    // but times are browser-local (see module doc) — a Monday-6am shift in
    // a timezone ahead of UTC has a Sunday UTC startDatetime, and would be
    // clipped by an unpadded `from`. shiftsForLane's local-day comparison
    // is what actually buckets each shift into its correct column; this
    // padding only has to be wide enough that the real week's shifts are
    // never excluded before reaching that filter.
    addDaysIso(weekStart, -1),
    addDaysIso(weekEnd, 1),
  );

  const [drag, setDrag] = useState<DragState | null>(null);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [showStaffDrawer, setShowStaffDrawer] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Default scroll position ~6am, once, on mount — every day column has
    // its OWN independent scroll container (only synced to each other on a
    // user-driven scroll, via onScroll below), so the hour rail alone isn't
    // enough: every column needs this set or they open misaligned with it.
    const top = pixelForMinutes(6 * 60, HOUR_HEIGHT) - 40;
    if (gridRef.current) gridRef.current.scrollTop = top;
    document.querySelectorAll<HTMLElement>("[data-calendar-scroller]").forEach((el) => {
      el.scrollTop = top;
    });
  }, [days]);

  function showBanner(tone: "error" | "success", text: string) {
    setBanner({ tone, text });
    window.setTimeout(() => setBanner((b) => (b?.text === text ? null : b)), 6000);
  }

  // Bucketed once per shift-list load, not per render — onPointerMove calls
  // setDrag() at pointer-move frequency during a drag, and shiftsForLane()
  // used to re-filter the full shift list for every (day x role) lane on
  // every one of those renders. Keyed only on calendarShifts, so a drag in
  // progress never invalidates it; the "shift renders in its hovered lane"
  // special case is applied separately in shiftsForLane below.
  const shiftsByLaneKey = useMemo(() => {
    const map = new Map<string, CalendarShift[]>();
    for (const s of calendarShifts) {
      const local = new Date(s.startDatetime);
      const dayIso = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
      const key = `${dayIso}|${s.rosterRoleId}`;
      const bucket = map.get(key);
      if (bucket) bucket.push(s);
      else map.set(key, [s]);
    }
    return map;
  }, [calendarShifts]);

  function shiftsForLane(dayIso: string, roleId: string): CalendarShift[] {
    const base = shiftsByLaneKey.get(`${dayIso}|${roleId}`) ?? [];
    if (drag?.kind !== "move") return base;
    // A shift being actively dragged to a different day renders ONLY in the
    // day it's currently hovering over, not its still-stored day —
    // otherwise it would visually stay put while the cursor moves.
    const withoutDragged = base.filter((s) => s.shiftId !== drag.shift.shiftId);
    return drag.dayIso === dayIso && drag.shift.rosterRoleId === roleId ? [...withoutDragged, drag.shift] : withoutDragged;
  }

  // ── Drag lifecycle ──────────────────────────────────────────────

  function beginDrag(state: DragState, e: React.PointerEvent) {
    e.preventDefault();
    // Defensive: clears any listeners a previous drag left dangling (a
    // pointerup that never fires — e.g. released outside the window, or a
    // system dialog stealing focus mid-drag — would otherwise stack a
    // second set of handlers on the next drag).
    endDrag();
    dragRef.current = state;
    setDrag(state);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", onPointerUp, { once: true });
  }

  function endDrag() {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    dragRef.current = null;
    setDrag(null);
  }

  function onPointerMove(e: PointerEvent) {
    const current = dragRef.current;
    if (!current) return;

    if (current.kind === "assign") {
      // Only the shift block matters for assign — no lane lookup needed,
      // so this is the sole elementFromPoint hit-test per move event here.
      const shiftEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest("[data-shift-id]") as HTMLElement | null;
      const next = { ...current, overShiftId: shiftEl?.dataset.shiftId ?? null };
      dragRef.current = next;
      setDrag(next);
      return;
    }

    const lane = laneAt(e.clientX, e.clientY);
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const minutes = Math.min(1440, Math.max(0, snapMinutes(minutesForPixel(offsetY, HOUR_HEIGHT))));

    if (current.kind === "create") {
      // A create-drag stays within the lane it started in — never crosses
      // day or role, since it has no existing identity to carry across.
      if (lane.dataset.dayIso !== current.dayIso || lane.dataset.roleId !== current.roleId) return;
      const next = { ...current, nowMinutes: minutes };
      dragRef.current = next;
      setDrag(next);
    } else if (current.kind === "move") {
      // Constrained to the shift's OWN role lane — role is immutable, so a
      // move can change day but never role.
      if (lane.dataset.roleId !== current.shift.rosterRoleId) return;
      const anchored = Math.min(1440 - current.durationMinutes, Math.max(0, minutes - current.grabOffsetMinutes));
      const next = { ...current, dayIso: lane.dataset.dayIso!, startMinutes: snapMinutes(anchored) };
      dragRef.current = next;
      setDrag(next);
    } else if (current.kind === "resize") {
      if (lane.dataset.roleId !== current.shift.rosterRoleId) return;
      const next =
        current.edge === "top"
          ? { ...current, startMinutes: Math.min(minutes, current.endMinutes - 15) }
          : { ...current, endMinutes: Math.max(minutes, current.startMinutes + 15) };
      dragRef.current = next;
      setDrag(next);
    }
  }

  async function onPointerUp() {
    const final = dragRef.current;
    endDrag();
    if (!final || !selectedLocationId) return;

    try {
      if (final.kind === "create") {
        const lo = Math.min(final.anchorMinutes, final.nowMinutes);
        const hi = Math.max(final.anchorMinutes, final.nowMinutes);
        const endMinutes = hi === lo ? lo + 30 : hi; // a click-with-no-drag still makes a 30-minute shift
        await create({
          storeLocationId: selectedLocationId,
          rosterRoleId: final.roleId,
          startDatetime: dateFromDayAndMinutes(final.dayIso, lo).toISOString(),
          endDatetime: dateFromDayAndMinutes(final.dayIso, endMinutes).toISOString(),
        });
        showBanner("success", "Shift created.");
      } else if (final.kind === "move") {
        await updateTime(final.shift.shiftId, {
          startDatetime: dateFromDayAndMinutes(final.dayIso, final.startMinutes).toISOString(),
          endDatetime: dateFromDayAndMinutes(final.dayIso, final.startMinutes + final.durationMinutes).toISOString(),
        });
      } else if (final.kind === "resize") {
        const dayIso = new Date(final.shift.startDatetime).toISOString().slice(0, 10);
        await updateTime(final.shift.shiftId, {
          startDatetime: dateFromDayAndMinutes(dayIso, final.startMinutes).toISOString(),
          endDatetime: dateFromDayAndMinutes(dayIso, final.endMinutes).toISOString(),
        });
      } else if (final.kind === "assign") {
        if (!final.overShiftId) return;
        await assign(final.overShiftId, final.userId);
        showBanner("success", `${final.staffName} assigned.`);
      }
    } catch (err: unknown) {
      showBanner("error", err instanceof Error ? err.message : "That didn't work.");
    }
  }

  // ── Render ───────────────────────────────────────────────────────

  if (!selectedLocationId) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="Pick a venue"
        body="Select a store location to see its roster calendar."
      />
    );
  }

  if (venueRoles.length === 0 && !isLoading) {
    return (
      <EmptyState
        icon={Users}
        title="No roles set up yet"
        body="Add a role on the Roles tab before building shifts on the calendar — every shift needs one."
      />
    );
  }

  return (
    <div>
      {/* Week navigator */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekStart(addDaysIso(weekStart, -7))}
            className="flex size-8 items-center justify-center rounded-lg border border-dark-200 text-dark-600 hover:text-[#FAFAFA] hover:bg-dark-100 transition-colors"
            aria-label="Previous week"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm font-medium text-[#E5E5E5] min-w-40 text-center">
            {new Date(weekStart).toLocaleDateString("en-AU", { day: "numeric", month: "short" })} –{" "}
            {new Date(weekEnd).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
          </span>
          <button
            type="button"
            onClick={() => setWeekStart(addDaysIso(weekStart, 7))}
            className="flex size-8 items-center justify-center rounded-lg border border-dark-200 text-dark-600 hover:text-[#FAFAFA] hover:bg-dark-100 transition-colors"
            aria-label="Next week"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(mondayOfWeek(todayIso()))}
            className="ml-1 rounded-lg border border-dark-200 px-2.5 py-1 text-xs text-dark-600 hover:text-[#FAFAFA] hover:bg-dark-100 transition-colors"
          >
            This week
          </button>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowStaffDrawer((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              showStaffDrawer ? "border-gold/40 bg-gold-dim text-gold" : "border-dark-200 text-dark-600 hover:text-[#FAFAFA]"
            }`}
          >
            <Users className="size-3.5" />
            Staff
          </button>
        )}
      </div>

      {banner && (
        <div
          className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
            banner.tone === "error" ? "border-red-500/20 bg-red-500/10 text-red-400" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
          }`}
        >
          {banner.text}
        </div>
      )}

      {/* Role legend — colour is never the only signal (each block also
          shows its role name as text), this just orients the eye. */}
      <div className="mb-3 flex flex-wrap gap-3">
        {venueRoles.map((r) => (
          <span key={r.rosterRoleId} className="flex items-center gap-1.5 text-xs text-dark-600">
            <span className={`size-2.5 rounded-full border-2 ${roleAccent(r.rosterRoleId, roleIds).replace("border-l-", "border-")}`} />
            {r.roleName}
          </span>
        ))}
      </div>

      <div className="flex gap-3">
        <div className="flex-1 flex rounded-xl border border-dark-200 overflow-hidden">
          {/* Hour rail */}
          <div className="w-12 flex-shrink-0 border-r border-dark-200 bg-dark-50">
            <div className="h-8 border-b border-dark-200" />
            <div ref={gridRef} className="overflow-y-auto" style={{ height: 420 }} id="roster-calendar-hour-rail">
              <div style={{ height: GRID_HEIGHT }} className="relative">
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 text-right pr-1.5 text-[10px] text-dark-600 -translate-y-1/2"
                    style={{ top: pixelForMinutes(h * 60, HOUR_HEIGHT) }}
                  >
                    {formatHourLabel(h)}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Day columns */}
          <div className="flex-1 overflow-x-auto">
            <div className="grid grid-cols-7" style={{ minWidth: Math.max(840, venueRoles.length * 7 * 90) }}>
              {days.map((dayIso, i) => (
                <div key={dayIso} className={`${i > 0 ? "border-l border-dark-200" : ""}`}>
                  <div className="h-8 flex items-center justify-center border-b border-dark-200 text-xs font-medium text-dark-600">
                    {DAY_LABELS[i]} {new Date(dayIso).getDate()}
                  </div>
                  <div
                    className="overflow-y-hidden"
                    style={{ height: 420 }}
                    onScroll={(e) => {
                      // Keep every column (and the hour rail) in sync with
                      // whichever one the user actually scrolled.
                      const top = e.currentTarget.scrollTop;
                      document.querySelectorAll<HTMLElement>("[data-calendar-scroller]").forEach((el) => {
                        if (el !== e.currentTarget) el.scrollTop = top;
                      });
                      if (gridRef.current) gridRef.current.scrollTop = top;
                    }}
                    data-calendar-scroller
                  >
                    <div className="flex" style={{ height: GRID_HEIGHT }}>
                      {venueRoles.map((role) => (
                        <div
                          key={role.rosterRoleId}
                          data-day-iso={dayIso}
                          data-role-id={role.rosterRoleId}
                          className="relative flex-1 border-r border-dark-200/50 last:border-r-0"
                          onPointerDown={(e) => {
                            if (!canManage || e.target !== e.currentTarget) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            const minutes = snapMinutes(minutesForPixel(e.clientY - rect.top, HOUR_HEIGHT));
                            beginDrag({ kind: "create", dayIso, roleId: role.rosterRoleId, anchorMinutes: minutes, nowMinutes: minutes }, e);
                          }}
                        >
                          {/* Hour gridlines */}
                          {Array.from({ length: 24 }, (_, h) => (
                            <div key={h} className="absolute left-0 right-0 border-t border-dark-200/30" style={{ top: pixelForMinutes(h * 60, HOUR_HEIGHT) }} />
                          ))}

                          {/* Live create ghost */}
                          {drag?.kind === "create" && drag.dayIso === dayIso && drag.roleId === role.rosterRoleId && (
                            <div
                              className={`absolute left-0.5 right-0.5 rounded border-l-4 border border-dashed border-gold/60 bg-gold-dim ${roleAccent(role.rosterRoleId, roleIds)}`}
                              style={{
                                top: pixelForMinutes(Math.min(drag.anchorMinutes, drag.nowMinutes), HOUR_HEIGHT),
                                height: Math.max(8, pixelForMinutes(Math.abs(drag.nowMinutes - drag.anchorMinutes), HOUR_HEIGHT)),
                              }}
                            />
                          )}

                          {shiftsForLane(dayIso, role.rosterRoleId).map((s) => {
                            const override = dragOverrideFor(drag, s.shiftId);
                            const storedStartMinutes = minutesSinceMidnight(new Date(s.startDatetime));
                            const storedEndMinutes = minutesSinceMidnight(new Date(s.endDatetime));
                            const startMinutes = override?.start ?? storedStartMinutes;
                            const endMinutes = override?.end ?? storedEndMinutes;
                            const isDraft = s.status === "Draft";
                            const isDropTarget = drag?.kind === "assign" && drag.overShiftId === s.shiftId;

                            return (
                              <div
                                key={s.shiftId}
                                data-shift-id={isDraft ? s.shiftId : undefined}
                                title={`${role.roleName} — ${formatTimeRange(s.startDatetime, s.endDatetime)} — ${
                                  s.assignments.length === 0 ? "Unassigned" : s.assignments.map((a) => a.staffName).join(", ")
                                } — ${s.status}`}
                                className={`absolute left-0.5 right-0.5 rounded border-l-4 px-1.5 py-1 text-[11px] leading-tight overflow-hidden ${roleAccent(role.rosterRoleId, roleIds)} ${
                                  isDraft ? "bg-dark-100 border border-dark-300 cursor-grab active:cursor-grabbing" : "bg-dark-200/70 border border-dark-300/50 opacity-90"
                                } ${isDropTarget ? "ring-2 ring-gold" : ""}`}
                                style={{ top: pixelForMinutes(startMinutes, HOUR_HEIGHT), height: Math.max(18, pixelForMinutes(endMinutes - startMinutes, HOUR_HEIGHT)) }}
                                onPointerDown={(e) => {
                                  if (!canManage || !isDraft) return;
                                  e.stopPropagation();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const grabY = e.clientY - rect.top;
                                  const nearEdge = 8;
                                  if (grabY <= nearEdge) {
                                    beginDrag({ kind: "resize", shift: s, edge: "top", startMinutes: storedStartMinutes, endMinutes: storedEndMinutes }, e);
                                  } else if (rect.height - grabY <= nearEdge) {
                                    beginDrag({ kind: "resize", shift: s, edge: "bottom", startMinutes: storedStartMinutes, endMinutes: storedEndMinutes }, e);
                                  } else {
                                    const grabOffsetMinutes = minutesForPixel(grabY, HOUR_HEIGHT);
                                    beginDrag(
                                      {
                                        kind: "move",
                                        shift: s,
                                        grabOffsetMinutes,
                                        durationMinutes: storedEndMinutes - storedStartMinutes,
                                        dayIso,
                                        startMinutes: storedStartMinutes,
                                      },
                                      e,
                                    );
                                  }
                                }}
                              >
                                <div className="font-medium text-[#FAFAFA] truncate">{role.roleName}</div>
                                <div className="text-dark-600 truncate">{formatTimeRange(s.startDatetime, s.endDatetime)}</div>
                                <div className="truncate text-dark-600">
                                  {s.assignments.length === 0 ? "Unassigned" : s.assignments.map((a) => a.staffName).join(", ")}
                                </div>
                                {!isDraft && <div className="text-dark-600 italic">{s.status}</div>}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Staff drawer — drag a chip onto a Draft shift to assign. */}
        {canManage && showStaffDrawer && (
          <div className="w-48 flex-shrink-0 rounded-xl border border-dark-200 p-2">
            <p className="mb-2 px-1 text-xs font-medium text-dark-600">Drag onto a shift to assign</p>
            <div className="space-y-1">
              {members.map((m) => (
                <div
                  key={m.userId}
                  onPointerDown={(e) => beginDrag({ kind: "assign", userId: m.userId, staffName: m.displayName, overShiftId: null }, e)}
                  className="cursor-grab active:cursor-grabbing rounded-lg border border-dark-200 bg-dark-100 px-2 py-1.5 text-xs text-[#E5E5E5] truncate select-none"
                >
                  {m.displayName}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-6 text-dark-600">
          <Loader2 className="size-4 animate-spin mr-2" /> Loading…
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <p className="mt-3 text-xs text-dark-600">
        Draft shifts can be dragged and resized; drag a name from Staff onto one to assign it.{" "}
        {canManage ? "Cancel a shift from the Shifts tab." : "You have view-only access."}
      </p>
    </div>
  );
}

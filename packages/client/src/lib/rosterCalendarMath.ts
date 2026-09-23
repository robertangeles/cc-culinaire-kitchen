/**
 * @module lib/rosterCalendarMath
 *
 * Pure position math for the drag-to-build week calendar
 * (components/roster/RosterCalendarView.tsx). No DOM, no pointer events —
 * mirrors this codebase's "pure decision logic, separately unit-tested"
 * convention (complianceExpiryMath.ts, rosterAssignmentRules.ts). The
 * interactive component converts pointer positions to minutes/dates by
 * calling into this file; this file never touches a pointer event.
 *
 * Day-of-week math is Monday-start, matching MiniCalendar.tsx's existing
 * `(firstDay.getDay()+6)%7` offset convention. Time-of-day math is
 * browser-local (Date.getHours()/getMinutes()), matching ShiftsManager's
 * existing formatShiftTime — not venue-local. See that component's own
 * comment for why this is an accepted, pre-existing simplification.
 */

const MINUTES_PER_HOUR = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Pixel Y position -> minutes since midnight, given the height of one hour row. */
export function minutesForPixel(pixelY: number, hourHeightPx: number): number {
  return (pixelY / hourHeightPx) * MINUTES_PER_HOUR;
}

/** Minutes since midnight -> pixel Y position, given the height of one hour row. */
export function pixelForMinutes(minutes: number, hourHeightPx: number): number {
  return (minutes / MINUTES_PER_HOUR) * hourHeightPx;
}

/** Round to the nearest grid step (default 15 minutes). */
export function snapMinutes(minutes: number, stepMinutes = 15): number {
  // `|| 0` normalizes a -0 result (e.g. snapMinutes(-7)) to plain 0 —
  // arithmetically identical, but a bare -0 is a surprising thing to hand a
  // caller building a Date or a display string from it.
  return Math.round(minutes / stepMinutes) * stepMinutes || 0;
}

/** Minutes since local midnight for a Date — browser-local, see module doc. */
export function minutesSinceMidnight(date: Date): number {
  return date.getHours() * MINUTES_PER_HOUR + date.getMinutes();
}

/**
 * A Date's own local calendar day as "YYYY-MM-DD" — browser-local, see
 * module doc. Never `.toISOString().slice(0, 10)` for this: that's the UTC
 * day, which disagrees with the local day (and therefore with which lane a
 * shift renders in) for any shift whose local start time falls before the
 * UTC offset "catches up" — e.g. an 8am AEDT (UTC+11) shift is still the
 * previous day in UTC. Silently moved a shift a day backward when the
 * resize gesture used the UTC form to re-derive a shift's day.
 */
export function localDayIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Add N days to an ISO date string ("YYYY-MM-DD"), UTC-safe. */
export function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** The Monday on or before the given ISO date — the start of its calendar week. */
export function mondayOfWeek(dateIso: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const offsetFromMonday = (date.getUTCDay() + 6) % 7; // Sun=0 -> 6, Mon=1 -> 0
  return addDaysIso(dateIso, -offsetFromMonday);
}

/** How many days `dateIso` is after `weekStartIso` — 0-6 for a date within that week. */
export function dayColumnIndexForDate(dateIso: string, weekStartIso: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [sy, sm, sd] = weekStartIso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(sy, sm - 1, sd)) / MS_PER_DAY);
}

/** Index of a role within the venue's role list — -1 if not found (unknown lane). */
export function laneIndexForRole(roleId: string, roleIds: string[]): number {
  return roleIds.indexOf(roleId);
}

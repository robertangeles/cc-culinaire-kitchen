/**
 * What the roster screens show, as pure functions. A shift is an instant; every day and time is read on its VENUE's clock, so it says the
 * same on every phone. Nothing here uses the phone's own zone.
 */

import { daysBetweenLocal, durationHours } from "@culinaire/shared";
import type { StoreLocation } from "@culinaire/shared/schemas/auth";
import type { MyShift, OpenSwap } from "@culinaire/shared/schemas/roster";

/** What the server uses for a venue with no zone (`getVenueTimezone`). */
const DEFAULT_ZONE = "Australia/Melbourne";

export function zoneOr(zone: string | null | undefined): string {
  if (!zone) return DEFAULT_ZONE;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_ZONE;
  }
}

/** The part of a shift its times are read from. */
export interface Span {
  startDatetime: string;
  endDatetime: string;
  ianaTimezone: string;
}

const day = (iso: string, timeZone: string, options: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleDateString("en-AU", { ...options, timeZone }).replace(/,/g, "");
// Node writes "9:00 am", some phones "9:00 AM" or with a narrow space: one spelling everywhere.
const clock = (iso: string, timeZone: string) => new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).replace(/\s+/g, " ").toLowerCase();

/** "Thu 26 Nov". */
export const dayLabel = (s: Span) => day(s.startDatetime, zoneOr(s.ianaTimezone), { weekday: "short", day: "numeric", month: "short" });
/** "Thursday 26 November 2026", for a shift's own page. */
export const longDay = (s: Span) => day(s.startDatetime, zoneOr(s.ianaTimezone), { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** "9:00 am–5:00 pm"; the day it ends is added when that is another day. */
export function timeLabel(s: Span): string {
  const zone = zoneOr(s.ianaTimezone);
  const span = `${clock(s.startDatetime, zone)}–${clock(s.endDatetime, zone)}`;
  return daysBetweenLocal(s.startDatetime, s.endDatetime, zone) === 0 ? span : `${span} ${day(s.endDatetime, zone, { weekday: "short" })}`;
}

export const hoursLabel = (s: Span) => `${Math.round(durationHours(s.startDatetime, s.endDatetime) * 100) / 100} h`;

/** The venue's calendar day, "2026-11-26". */
export function venueToday(zone: string | undefined, now: number): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zoneOr(zone), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Which Monday-to-Sunday week a shift starts in, on its venue's clock. */
export function weekOf(s: Span, now: number): "past" | "this" | "next" | "later" {
  const zone = zoneOr(s.ianaTimezone);
  const today = new Date(now).toISOString();
  const weekday = WEEK.indexOf(new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" }).format(new Date(now)));
  const fromMonday = weekday + daysBetweenLocal(today, s.startDatetime, zone);
  return fromMonday < 0 ? "past" : fromMonday < 7 ? "this" : fromMonday < 14 ? "next" : "later";
}

/** Staff see published shifts only (the owner has not decided on drafts). */
const isDraft = (s: MyShift) => s.status === "Draft";
export const published = (shifts: MyShift[]) => shifts.filter((s) => !isDraft(s));

/** Draft shifts a manager has asked a public-holiday question about: the question is answered on the web, the shift is not shown. */
export const hiddenConsents = (shifts: MyShift[]) => shifts.filter((s) => isDraft(s) && s.publicHolidayConsent === "Requested").length;

export function rosterSections(shifts: MyShift[], now: number): { title: string; shifts: MyShift[] }[] {
  const weeks = { this: [] as MyShift[], next: [] as MyShift[], later: [] as MyShift[] };
  for (const s of published(shifts)) {
    const week = weekOf(s, now);
    if (week !== "past") weeks[week].push(s);
  }
  return [
    { title: "This week", shifts: weeks.this },
    { title: "Next week", shifts: weeks.next },
    { title: "Later", shifts: weeks.later },
  ].filter((section) => section.shifts.length > 0);
}

export const isOver = (s: Span, now: number) => Date.parse(s.endDatetime) <= now;
export const hasStarted = (s: { startDatetime: string }, now: number) => Date.parse(s.startDatetime) <= now;

/** True while the person owes an answer: to the shift itself, or to its public-holiday question. */
export const answerNeeded = (s: MyShift, now: number) => !isOver(s, now) && (s.assignmentStatus === "Pending" || s.publicHolidayConsent === "Requested");

/** One short word for a row; never colour alone. */
export function statusWord(s: MyShift, now: number): string {
  if (answerNeeded(s, now)) return "Needs your answer";
  if (isOver(s, now)) return "Finished";
  return s.assignmentStatus === "Pending" ? "Not answered" : s.assignmentStatus;
}

/** A colleague's offer, with the venue's zone its times are read in. */
export type ShownSwap = OpenSwap & { ianaTimezone: string; locationName: string };

/** Statuses staff never see. A server that sends none (an older one) cannot say, and its swaps are shown. */
const HIDDEN_STATUS = ["Draft", "Cancelled"];

/** The offers a person can be shown: a colleague's, of a published shift that has not started, at a venue whose zone is known. `hidden` is how many had to be left out for that last reason. */
export function shownSwaps(swaps: OpenSwap[], userId: number, locations: StoreLocation[], shifts: MyShift[], now: number): { shown: ShownSwap[]; hidden: number } {
  const open = swaps.filter((s) => s.fromUserId !== userId && !hasStarted(s, now) && !HIDDEN_STATUS.includes(s.shiftStatus ?? ""));
  const shown = open.flatMap((s) => {
    const venue = swapZone(s, locations, shifts);
    return venue ? [{ ...s, ianaTimezone: venue.zone, locationName: venue.locationName }] : [];
  });
  return { shown, hidden: open.length - shown.length };
}

/**
 * The venue's zone and name as the server sends them with the swap; from an older server, known only for a venue the person works at (or
 * has a shift at). Null means the time cannot be said truthfully.
 */
export function swapZone(swap: OpenSwap, locations: StoreLocation[], shifts: MyShift[]): { zone: string; locationName: string } | null {
  if (swap.ianaTimezone) return { zone: zoneOr(swap.ianaTimezone), locationName: swap.locationName ?? "" };
  const loc = locations.find((l) => l.storeLocationId === swap.storeLocationId && l.ianaTimezone);
  if (loc) return { zone: zoneOr(loc.ianaTimezone), locationName: loc.locationName };
  const mine = shifts.find((s) => s.storeLocationId === swap.storeLocationId && s.ianaTimezone);
  return mine ? { zone: zoneOr(mine.ianaTimezone), locationName: mine.locationName } : null;
}

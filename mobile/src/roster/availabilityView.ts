/** A weekly window a person can work, as the form checks it and the list shows it. Times are on the venue's clock and never converted. */

import { formatAuDate } from "@culinaire/shared";
import { isTime, parseTypedDate } from "../ui/typedDate";

/** The server's fields (`AvailabilitySchema` in rosterController). */
export interface AvailabilityWindow {
  storeLocationId: string | null;
  /** 0 is Sunday. */
  dayOfWeek: number;
  availableFrom: string;
  availableUntil: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Monday first, as the roster's week runs. */
export const WEEKDAYS = [...DAYS.slice(1), DAYS[0]];
export const dayName = (dayOfWeek: number) => DAYS[dayOfWeek] ?? "";
export const dayNumber = (name: string) => DAYS.indexOf(name);

export const windowText = (w: AvailabilityWindow) => `${dayName(w.dayOfWeek)} ${w.availableFrom}–${w.availableUntil}`;
export const datesText = (w: AvailabilityWindow) => `From ${formatAuDate(w.effectiveFrom)}${w.effectiveUntil ? ` to ${formatAuDate(w.effectiveUntil)}` : ""}`;

/** Monday to Sunday, then by the time it starts. */
export const byWeek = (a: AvailabilityWindow, b: AvailabilityWindow) => ((a.dayOfWeek + 6) % 7) - ((b.dayOfWeek + 6) % 7) || a.availableFrom.localeCompare(b.availableFrom) || a.effectiveFrom.localeCompare(b.effectiveFrom);

/** Exactly the fields migration 0005 makes unique per person. */
export const sameWindow = (a: AvailabilityWindow, b: AvailabilityWindow) =>
  a.storeLocationId === b.storeLocationId && a.dayOfWeek === b.dayOfWeek && a.availableFrom === b.availableFrom && a.availableUntil === b.availableUntil && a.effectiveFrom === b.effectiveFrom && a.effectiveUntil === b.effectiveUntil;

/** As typed: day-first dates, "" for no end date. */
export interface AvailabilityForm {
  day: string;
  from: string;
  until: string;
  startsOn: string;
  endsOn: string;
}

/** The window a form means, or the one thing to fix. `others` are the windows already there (not the one being changed). */
export function readForm(form: AvailabilityForm, storeLocationId: string | null, others: AvailabilityWindow[]): { window: AvailabilityWindow } | { error: string } {
  if (!isTime(form.from) || !isTime(form.until)) return { error: "Use 24-hour times such as 09:00 and 17:30." };
  if (form.until <= form.from) return { error: "The end time must be after the start time. For work past midnight, add a second window on the next day." };
  const effectiveFrom = parseTypedDate(form.startsOn);
  if (!effectiveFrom) return { error: "Enter the first day as day, month, year, such as 03/12/2026." };
  const effectiveUntil = form.endsOn.trim() === "" ? null : parseTypedDate(form.endsOn);
  if (form.endsOn.trim() !== "" && !effectiveUntil) return { error: "Enter the last day as day, month, year, or leave it empty." };
  if (effectiveUntil && effectiveUntil < effectiveFrom) return { error: "The last day can't be before the first." };
  const window = { storeLocationId, dayOfWeek: dayNumber(form.day), availableFrom: form.from, availableUntil: form.until, effectiveFrom, effectiveUntil };
  if (others.some((o) => sameWindow(o, window))) return { error: "You already have this availability." };
  return { window };
}

/**
 * @module services/pushQuietHours
 *
 * Pure: is a moment inside a person's quiet hours. The window is minutes after local midnight in the person's own
 * IANA time zone, so daylight saving moves it with them. A window that ends before it starts crosses midnight.
 */

export interface QuietWindow {
  startMinute: number;
  endMinute: number;
  timeZone: string;
}

/** "07:30" -> 450. The caller has already checked the shape (`QuietHoursSchema`). */
export function minutesOf(timeOfDay: string): number {
  const [h, m] = timeOfDay.split(":").map(Number);
  return h * 60 + m;
}

/** 450 -> "07:30". */
export function timeOfDayOf(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** True when `timeZone` is one this runtime can format in. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Minutes after local midnight at `now` in `timeZone`. */
function localMinute(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return get("hour") * 60 + get("minute");
}

/**
 * An unknown zone reads as "not quiet": a person whose window cannot be read is pushed to rather than silently
 * never told about their shift. `PUT push-preferences` refuses unknown zones, so this only guards a runtime whose zone data changed.
 */
export function isQuietNow(now: Date, window: QuietWindow): boolean {
  if (!isKnownTimeZone(window.timeZone)) return false;
  const minute = localMinute(now, window.timeZone);
  const { startMinute: start, endMinute: end } = window;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

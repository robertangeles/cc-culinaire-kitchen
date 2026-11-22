/**
 * A report range arrives as date-only strings from the web ("2026-03-05") and as timestamps from the phone.
 * `new Date("2026-03-05")` is midnight, so using it as an inclusive end drops that whole day.
 *
 * shortcut: a date-only value is a UTC day, not the venue's local day; fix when venue time zones are modelled.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function dayBounds(value: string): { start: Date; end: Date } {
  const start = new Date(value);
  if (!DATE_ONLY.test(value)) return { start, end: start };
  return { start, end: new Date(start.getTime() + 24 * 3600 * 1000 - 1) };
}

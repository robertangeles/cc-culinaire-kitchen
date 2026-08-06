/**
 * @module utils/dates
 *
 * Australian date formatting for compliance UI copy, e.g.
 * "Alex's RSA expired on 15 June 2026".
 *
 * Why this exists: this project runs on a US-hosted server, so the host's
 * default locale is not Australian. `Date#toLocaleDateString()` called
 * without an explicit locale renders US-style ("June 15, 2026"), which
 * reads wrong to every Australian operator on a compliance screen. Always
 * pass an explicit locale and explicit options — never rely on host default
 * locale.
 *
 * "YYYY-MM-DD" string inputs are calendar dates, not timestamps.
 * `new Date("2026-06-15")` parses as UTC midnight — formatting that on a
 * host west of UTC (e.g. the US) renders 14 June, one day early. Parsing the
 * string into local year/month/day components and building the Date with
 * the local constructor sidesteps the shift: the Date is built and read
 * back in the same (host) timezone, so the calendar day never moves.
 */

/** Convert input to a Date holding the intended calendar day in local time.
 *  Date instances pass through unchanged; only "YYYY-MM-DD" strings need
 *  the local-constructor treatment described above. */
function toCalendarDate(d: Date | string): Date {
  if (typeof d === "string") {
    const [year, month, day] = d.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return d;
}

/** "15 June 2026" */
export function formatAuDate(d: Date | string): string {
  return toCalendarDate(d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "15/06/2026" */
export function formatAuDateShort(d: Date | string): string {
  return toCalendarDate(d).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

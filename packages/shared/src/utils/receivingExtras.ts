/**
 * @module utils/receivingExtras
 *
 * The rules for what a delivery line and its docket may carry beyond quantities and prices: an expiry
 * date and a lot number per line, the supplier's docket number per delivery. The server enforces them
 * and the web and the phone check the same rules before they send.
 *
 * Expiry is a calendar day ("YYYY-MM-DD"). On a line that is taken in it may not be before the day the
 * delivery was received; a rejected line may carry any past day, because the printed date is the evidence
 * for rejecting a pack as expired. No line may be more than EXPIRY_YEARS_AHEAD years after the delivery
 * (a typed "2205" is a slip, not a shelf life). The received day is read as the UTC day of the session's
 * start, less one day: a kitchen east of UTC is already on the next day when UTC is not, and must never be
 * refused for today's date.
 */

/** Longest lot or docket number, in characters, after trimming. */
export const RECEIVING_TEXT_MAX = 50;
/** Latest expiry accepted, in years after the delivery. */
export const EXPIRY_YEARS_AHEAD = 10;

export type ReceivingExtrasCode =
  | "EXPIRY_DATE_INVALID"
  | "EXPIRY_DATE_OUT_OF_RANGE"
  | "LOT_NUMBER_TOO_LONG"
  | "DOCKET_NUMBER_TOO_LONG";

export interface ReceivingExtrasProblem {
  code: ReceivingExtrasCode;
  message: string;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Null when `value` is a real "YYYY-MM-DD" day within range, for a line with `lineStatus`, of a delivery received at `receivedAt`. */
export function expiryDateProblem(value: string, receivedAt: Date | string, lineStatus: string): ReceivingExtrasProblem | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const day = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!m || !day || isoDay(day) !== value) {
    return { code: "EXPIRY_DATE_INVALID", message: "Enter the expiry date as a real day." };
  }
  const received = new Date(receivedAt);
  const earliest = new Date(Date.UTC(received.getUTCFullYear(), received.getUTCMonth(), received.getUTCDate() - 1));
  const latest = new Date(Date.UTC(received.getUTCFullYear() + EXPIRY_YEARS_AHEAD, received.getUTCMonth(), received.getUTCDate()));
  if (day < earliest && lineStatus !== "REJECTED") return { code: "EXPIRY_DATE_OUT_OF_RANGE", message: "The expiry date has passed. Clear it to accept this line, or keep the line rejected." };
  if (day > latest) {
    return { code: "EXPIRY_DATE_OUT_OF_RANGE", message: `The expiry date must be within ${EXPIRY_YEARS_AHEAD} years of the delivery.` };
  }
  return null;
}

/** Null when a lot or docket number, as typed, fits. Blank is fine: it clears the field. */
export function receivingTextProblem(kind: "lot" | "docket", value: string): ReceivingExtrasProblem | null {
  if (value.trim().length <= RECEIVING_TEXT_MAX) return null;
  return kind === "lot"
    ? { code: "LOT_NUMBER_TOO_LONG", message: `A lot number is at most ${RECEIVING_TEXT_MAX} characters.` }
    : { code: "DOCKET_NUMBER_TOO_LONG", message: `A docket number is at most ${RECEIVING_TEXT_MAX} characters.` };
}

/** What is stored for a typed lot or docket number: trimmed, and null when blank. */
export const receivingText = (value: string): string | null => value.trim() || null;

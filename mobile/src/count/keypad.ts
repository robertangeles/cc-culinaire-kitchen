/**
 * The count keypad as a pure function of the typed text (design rules D13): digits, one decimal point
 * with at most three decimals, nothing above 99,999 (the server's limit), a visible "0 - none here"
 * key that records zero on purpose, and blank meaning "not counted" (never zero).
 */

export type Key = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back" | "zero";

const MAX = 99999;
const MAX_DECIMALS = 3;

export function press(entry: string, key: Key): string {
  if (key === "zero") return "0";
  if (key === "back") return entry.slice(0, -1);

  if (key === ".") {
    if (entry.includes(".")) return entry;
    return entry === "" ? "0." : `${entry}.`;
  }

  // A digit.
  const [, decimals = ""] = entry.split(".");
  if (entry.includes(".") && decimals.length >= MAX_DECIMALS) return entry;
  const next = entry === "0" ? key : entry + key;
  return Number(next) > MAX ? entry : next;
}

/** The sentence to show when a digit was refused for being too big, otherwise null. */
export function limitMessage(entry: string, key: Key): string | null {
  if (key === "back" || key === "zero" || key === ".") return null;
  const [, decimals = ""] = entry.split(".");
  if (entry.includes(".") && decimals.length >= MAX_DECIMALS) return null;
  const next = entry === "0" ? key : entry + key;
  return Number(next) > MAX ? "The largest number is 99,999." : null;
}

/** The number the entry means, or null when nothing countable has been typed yet. */
export function parseEntry(entry: string): number | null {
  if (entry === "" || entry === ".") return null;
  const n = Number(entry);
  return Number.isFinite(n) ? n : null;
}

/**
 * The "0 - none here" key: on a blank entry it records a deliberate zero; once digits are typed it is
 * just the digit 0 (so 10 and 100 can be typed).
 */
export function zeroKey(entry: string): Key {
  return entry === "" ? "zero" : "0";
}

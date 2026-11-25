/** Dates and times typed on a number pad: the separators are put in as the digits arrive. Calendar days only, never a moment, so no time zone is involved. */

const digits = (text: string, max: number) => text.replace(/\D/g, "").slice(0, max);

/** "03122026" -> "03/12/2026", as far as it has been typed. */
export function maskDate(text: string): string {
  const d = digits(text, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join("/");
}

/** "0930" -> "09:30", as far as it has been typed. */
export function maskTime(text: string): string {
  const d = digits(text, 4);
  return [d.slice(0, 2), d.slice(2)].filter(Boolean).join(":");
}

/** "03/12/2026" (day first) -> "2026-12-03"; null when it is not a real day. */
export function parseTypedDate(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** "2026-12-03" -> "03/12/2026", for a field that starts filled in. */
export const typedDate = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

export const isTime = (text: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(text);

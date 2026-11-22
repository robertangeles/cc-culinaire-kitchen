/**
 * Machine-readable error bodies. `error` stays the human sentence the web shows;
 * `code` is what a client (the phone's offline queue) branches on instead of
 * matching English text. Only errors that a client has to act on carry a code.
 */

/** Codes the server sends today. New ones are additive; clients must tolerate unknown strings. */
export const SERVER_ERROR_CODES = [
  "ALREADY_CONFIRMED",
  "INCOMPATIBLE_UNITS",
  "INVALID_STATE",
  "NOT_FOUND",
  "LOCATION_NOT_ALLOWED",
] as const;
export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];

export interface ApiErrorBody {
  error: string;
  code?: string;
}

/**
 * Lenient reader for an error response body: a body with the wrong shape (an HTML
 * error page, `{ error: { ... } }` from the 37 sites that still send an object,
 * a missing field) yields what it can instead of throwing.
 */
export function parseApiErrorBody(raw: unknown): { error?: string; code?: string } {
  if (typeof raw !== "object" || raw === null) return {};
  const { error, code } = raw as { error?: unknown; code?: unknown };
  return {
    error: typeof error === "string" ? error : undefined,
    code: typeof code === "string" ? code : undefined,
  };
}

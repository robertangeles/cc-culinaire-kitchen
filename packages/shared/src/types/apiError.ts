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
  "FORBIDDEN",
  "CONFLICT",
  "VALIDATION",
  "SHEET_INCOMPLETE",
  "EDIT_WINDOW_EXPIRED",
  "LOCATION_NOT_ALLOWED",
  "FEATURE_DISABLED",
  "REFRESH_TOKEN_REUSED",
  "ACCOUNT_SUSPENDED",
  "ACCOUNT_CANCELLED",
  // Stock take (the phone's count queue branches on these; names match packages/shared/src/schemas/stockTake.ts on the phone branch).
  "STOCK_TAKE_AREA_HELD",
  "STOCK_TAKE_AREA_SUBMITTED",
  "STOCK_TAKE_AREA_CLOSED",
  "STOCK_TAKE_CLAIMED_BY_OTHER",
  "STOCK_TAKE_CLAIM_CHANGED",
  // Prep (Wave 2): the session was ended, or another device changed the task first. Both answer 409.
  "PREP_SESSION_ENDED",
  "PREP_TASK_CHANGED",
  // Sign in with Apple (POST /api/auth/apple/idtoken and /apple/link).
  "APPLE_NOT_CONFIGURED",
  "APPLE_UNAVAILABLE",
  "APPLE_TOKEN_INVALID",
  "APPLE_EMAIL_MISSING",
  "APPLE_EMAIL_NOT_VERIFIED",
  "APPLE_ALREADY_LINKED",
  "ACCOUNT_EMAIL_UNVERIFIED",
  "UNAUTHENTICATED",
  "RATE_LIMITED",
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

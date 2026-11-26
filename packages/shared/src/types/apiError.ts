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
  // Receiving (Wave 1): a line the rules refuse. The delivery stays open; the chef fixes the line.
  "SHORT_QTY_REQUIRED",
  "SHORT_QTY_NOT_LESS",
  "PRICE_REQUIRED",
  "UNIT_NOT_CONVERTIBLE",
  // Front-of-house shelf (Wave 3): a count taken before the shelf's last sale, restock or waste. 409; count again.
  "FOH_COUNT_STALE",
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
  // Chat, recipes and the model-backed screens (Wave 6 hardening).
  "FREE_SESSIONS_EXHAUSTED",
  "GUEST_QUOTA_EXHAUSTED",
  "AI_UNAVAILABLE",
  "AI_TIMEOUT",
  "EMAIL_FAILED",
  // Profile and account: change password, two-step verification, profile photo.
  "INVALID_CREDENTIALS",
  "WEAK_PASSWORD",
  "PASSWORD_NOT_SET",
  "RECENT_SIGN_IN_REQUIRED",
  "MFA_REQUIRED",
  "INVALID_MFA_CODE",
  "INVALID_MFA_SESSION",
  "MFA_ALREADY_ENABLED",
  "FILE_TOO_LARGE",
  "UNSUPPORTED_FILE_TYPE",
  "UPLOAD_FAILED",
  // Orders, approvals and credit notes (Wave 5).
  "SELF_APPROVAL_NOT_ALLOWED",
  "ALREADY_EMAILED",
  "PDF_TIMEOUT",
  "ALREADY_CREDITED",
  "CREDIT_EXCEEDS_DISCREPANCY",
  "DISCREPANCY_VALUE_UNKNOWN",
  // Roster (Wave 4). Assigning to a shift answers 409 for three different reasons; a swap claim for three more.
  "ASSIGNMENT_BLOCKED_COMPLIANCE",
  "SHIFT_ALREADY_ASSIGNED",
  "SHIFT_NOT_DRAFT",
  "SWAP_CLAIMED_BY_YOU",
  "SWAP_CLAIMED_BY_OTHER",
  "SWAP_CANCELLED",
  // A sale's idempotency key was already used for a different sale (Wave 7): a client bug, never retry the same request.
  "IDEMPOTENCY_KEY_REUSED",
  // Compliance documents: the private document store is not set up or not answering (503). Try again later.
  "STORAGE_UNAVAILABLE",
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

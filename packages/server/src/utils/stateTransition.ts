/**
 * Lightweight state machine transition validator.
 *
 * Usage:
 *   const PO_TRANSITIONS = {
 *     DRAFT: ["SUBMITTED", "PENDING_APPROVAL", "CANCELLED"],
 *     PENDING_APPROVAL: ["SENT", "DRAFT", "CANCELLED"],
 *     SENT: ["RECEIVING", "CANCELLED"],
 *     ...
 *   };
 *   validateTransition("DRAFT", "SUBMITTED", PO_TRANSITIONS);
 *   // throws InvalidStateError if transition is not allowed
 */

import { AppError } from "./appError.js";

// ── PO status transitions ────────────────────────────────────────────
export const PO_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PENDING_APPROVAL", "SENT", "CANCELLED"],
  PENDING_APPROVAL: ["SENT", "DRAFT", "CANCELLED"],
  SENT: ["RECEIVING", "CANCELLED"],
  RECEIVING: ["RECEIVED", "PARTIAL_RECEIVED"],
  RECEIVED: [],
  PARTIAL_RECEIVED: [],
  CANCELLED: [],
};

// ── Receiving session status transitions ─────────────────────────────
export const RECEIVING_SESSION_TRANSITIONS: Record<string, string[]> = {
  ACTIVE: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * Validates that a state transition is allowed.
 * @throws AppError (409 INVALID_STATE) if the transition is not allowed.
 */
export function validateTransition(
  currentStatus: string,
  targetStatus: string,
  allowedTransitions: Record<string, string[]>,
  entityName = "entity",
): void {
  const allowed = allowedTransitions[currentStatus];
  if (!allowed) {
    throw new Error(
      `Unknown ${entityName} status: ${currentStatus}`,
    );
  }
  if (!allowed.includes(targetStatus)) {
    throw new AppError(
      409,
      "INVALID_STATE",
      `Cannot transition ${entityName} from ${currentStatus} to ${targetStatus}`,
    );
  }
}

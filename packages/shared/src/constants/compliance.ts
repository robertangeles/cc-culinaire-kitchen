/**
 * How long a Pending compliance document must wait before the staff subject
 * can nudge a verifier (CV-C7). Shared by the client (offers the button /
 * colors the waiting badge) and the server (the actual enforcement) so the
 * two never drift apart.
 */
export const NUDGE_ELIGIBLE_AFTER_HOURS = 48;

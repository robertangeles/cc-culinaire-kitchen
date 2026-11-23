/**
 * @module services/pushCopy
 *
 * What a push says. A push shows on a locked screen, so the text is fixed per type and never built from the
 * notification's payload: no staff name, no document type, no date. The details stay in the in-app inbox,
 * which the person opens after unlocking.
 */

import type { NotificationType } from "@culinaire/shared/schemas/push";

export interface PushCopy {
  title: string;
  body: string;
}

const FALLBACK: PushCopy = { title: "CulinAIre Kitchen", body: "You have a new notification." };

const COPY: Record<NotificationType, PushCopy> = {
  APPROVAL_REQUIRED: { title: "Approval needed", body: "Something is waiting for your approval." },
  PO_APPROVED: { title: "Order approved", body: "One of your orders was approved." },
  PO_REJECTED: { title: "Order not approved", body: "One of your orders was not approved." },
  DISCREPANCY_ALERT: { title: "Delivery discrepancy", body: "A delivery needs your attention." },
  DELIVERY_OVERDUE: { title: "Delivery overdue", body: "A delivery is overdue." },
  BRAIN_CAPTURE_ERROR: { title: "Kitchen Brain", body: "Kitchen Brain needs your attention." },
  BRAIN_DIGEST: { title: "Kitchen Brain", body: "Your Kitchen Brain digest is ready." },
  BRAIN_NUDGE: { title: "Kitchen Brain", body: "Kitchen Brain has a suggestion for you." },
  DOCUMENT_EXPIRY_ALERT: { title: "Compliance", body: "A compliance document needs attention." },
  HOLIDAY_CONSENT_REQUESTED: { title: "Your shifts", body: "Your answer is needed on a shift." },
  HOLIDAY_CONSENT_DECLINED: { title: "Your shifts", body: "A shift answer was declined." },
  SHIFT_SWAP_CLAIMED: { title: "Your shifts", body: "Someone picked up your shift swap." },
  COMPLIANCE_DOCUMENT_NUDGE: { title: "Compliance", body: "A document is waiting for review." },
  SHIFT_ASSIGNED: { title: "Your shifts", body: "You have a new shift." },
  SHIFT_CHANGED: { title: "Your shifts", body: "One of your shifts changed." },
  SHIFT_CANCELLED: { title: "Your shifts", body: "One of your shifts was cancelled." },
  ROSTER_PUBLISHED: { title: "Your shifts", body: "The roster was published." },
  DOCUMENT_VERIFIED: { title: "Compliance", body: "A document of yours was verified." },
  DOCUMENT_REJECTED: { title: "Compliance", body: "A document of yours was not accepted." },
};

/** The text for a type; a type this server version does not list (rows are written by newer code) gets the plain fallback. */
export function pushCopy(type: string): PushCopy {
  return COPY[type as NotificationType] ?? FALLBACK;
}

/** The settings screen's name for each type: generic, like the push itself. */
export const PUSH_TYPE_LABELS: Record<NotificationType, string> = {
  APPROVAL_REQUIRED: "Approvals needed",
  PO_APPROVED: "Orders approved",
  PO_REJECTED: "Orders not approved",
  DISCREPANCY_ALERT: "Delivery discrepancies",
  DELIVERY_OVERDUE: "Overdue deliveries",
  BRAIN_CAPTURE_ERROR: "Kitchen Brain problems",
  BRAIN_DIGEST: "Kitchen Brain digests",
  BRAIN_NUDGE: "Kitchen Brain suggestions",
  DOCUMENT_EXPIRY_ALERT: "Compliance document alerts",
  HOLIDAY_CONSENT_REQUESTED: "Public holiday shift requests",
  HOLIDAY_CONSENT_DECLINED: "Public holiday shift declines",
  SHIFT_SWAP_CLAIMED: "Shift swaps picked up",
  COMPLIANCE_DOCUMENT_NUDGE: "Documents waiting for review",
  SHIFT_ASSIGNED: "New shifts",
  SHIFT_CHANGED: "Shift changes",
  SHIFT_CANCELLED: "Shift cancellations",
  ROSTER_PUBLISHED: "Roster published",
  DOCUMENT_VERIFIED: "Documents verified",
  DOCUMENT_REJECTED: "Documents rejected",
};

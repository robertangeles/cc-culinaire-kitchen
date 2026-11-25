/**
 * What the inbox shows for a notification, and where tapping it goes. Pure, so every type is tested here.
 * The inbox is behind the phone's lock, so it may say more than the push did (an order number, a reason); the push text is the server's.
 */

import { pushLink } from "@culinaire/shared/schemas/push";
import type { AppNotification } from "@culinaire/shared/schemas/notifications";
import type { AuthUser } from "../api/auth";
import { orderRights } from "../orders/orderView";
import { hasAnyPermission, moduleTabs } from "../shell/tabs";

/** A heading per type, and the sentence used when the payload has nothing better. Every type the server writes is here. */
const COPY: Record<string, { title: string; body: string }> = {
  APPROVAL_REQUIRED: { title: "Approval needed", body: "An order is waiting for your approval." },
  PO_APPROVED: { title: "Order approved", body: "One of your orders was approved." },
  PO_REJECTED: { title: "Order not approved", body: "One of your orders was not approved." },
  DISCREPANCY_ALERT: { title: "Delivery discrepancy", body: "A delivery did not match its order." },
  DELIVERY_OVERDUE: { title: "Delivery overdue", body: "A delivery is overdue." },
  BRAIN_CAPTURE_ERROR: { title: "Kitchen Brain problem", body: "Kitchen Brain could not save chat memories." },
  BRAIN_DIGEST: { title: "Kitchen Brain digest", body: "Your Kitchen Brain digest is ready." },
  BRAIN_NUDGE: { title: "Kitchen Brain suggestion", body: "Kitchen Brain has a suggestion for you." },
  DOCUMENT_EXPIRY_ALERT: { title: "Document expiring", body: "A compliance document is expiring." },
  HOLIDAY_CONSENT_REQUESTED: { title: "Public holiday shift", body: "Your answer is needed on a public holiday shift." },
  HOLIDAY_CONSENT_DECLINED: { title: "Public holiday shift declined", body: "A public holiday shift was declined." },
  SHIFT_SWAP_CLAIMED: { title: "Shift swap picked up", body: "Someone picked up your shift swap." },
  COMPLIANCE_DOCUMENT_NUDGE: { title: "Document to review", body: "A document is waiting for review." },
  SHIFT_ASSIGNED: { title: "New shift", body: "A shift was assigned to you." },
  SHIFT_CHANGED: { title: "Shift changed", body: "One of your shifts changed." },
  SHIFT_CANCELLED: { title: "Shift cancelled", body: "One of your shifts was cancelled." },
  ROSTER_PUBLISHED: { title: "Roster published", body: "The roster was published." },
  DOCUMENT_VERIFIED: { title: "Document verified", body: "A document of yours was verified." },
  DOCUMENT_REJECTED: { title: "Document not accepted", body: "A document of yours was not accepted." },
};
const FALLBACK = { title: "Notification", body: "You have a new notification." };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

/** A sentence built from the payload fields a type carries, or null when they are missing. */
function detail(type: string, p: Record<string, unknown>): string | null {
  const po = str(p.poNumber);
  switch (type) {
    case "APPROVAL_REQUIRED":
      return po && `Order ${po} is waiting for your approval.`;
    case "PO_APPROVED":
      return po && `Order ${po} was approved.`;
    case "PO_REJECTED": {
      const reason = str(p.reason);
      return po && (reason ? `Order ${po} was not approved: ${reason}` : `Order ${po} was not approved.`);
    }
    case "DISCREPANCY_ALERT":
      return po && `The delivery for order ${po} did not match the order.`;
    case "DELIVERY_OVERDUE":
      return po && `The delivery for order ${po} is overdue.`;
    case "DOCUMENT_EXPIRY_ALERT": {
      const doc = str(p.documentType);
      const who = str(p.staffName) ?? str(p.venueName);
      const when = str(p.expiryDate);
      if (!doc || !when) return null;
      return `${doc}${who ? ` for ${who}` : ""} expires on ${when}.`;
    }
    case "HOLIDAY_CONSENT_REQUESTED": {
      const day = str(p.shiftDate);
      return day && `Your answer is needed on a public holiday shift on ${day}.`;
    }
    case "BRAIN_CAPTURE_ERROR": {
      const errors = str(p.errorsDelta);
      const hours = str(p.windowHours);
      return errors && hours && `${errors} chat memories failed to save in the last ${hours} hours.`;
    }
    default:
      return null;
  }
}

/** The heading and sentence for one notification; never empty, whatever the type or payload. */
export function notificationText(n: Pick<AppNotification, "type" | "payload">): { title: string; body: string } {
  const copy = COPY[n.type] ?? FALLBACK;
  // A producer that wrote its own sentence (`body`, the digest's `summary`) knows best.
  return { title: copy.title, body: str(n.payload.body) ?? str(n.payload.summary) ?? detail(n.type, n.payload) ?? copy.body };
}

/** "Just now", "5 min ago", "3 h ago", "2 days ago". */
export function timeAgo(iso: string, now: number): string {
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(mins) || mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

const ORDER_TYPES = ["APPROVAL_REQUIRED", "PO_APPROVED", "PO_REJECTED", "DISCREPANCY_ALERT"];
/** About the person's own shifts. Not HOLIDAY_CONSENT_DECLINED: that one tells a manager about someone else's. */
const SHIFT_TYPES = ["SHIFT_ASSIGNED", "SHIFT_CHANGED", "SHIFT_CANCELLED", "ROSTER_PUBLISHED", "SHIFT_SWAP_CLAIMED", "HOLIDAY_CONSENT_REQUESTED"];
/** About the person's own document. Not COMPLIANCE_DOCUMENT_NUDGE: that one asks a verifier. An expiry alert reaches both; the page says so when the document is not theirs. */
const DOCUMENT_TYPES = ["DOCUMENT_VERIFIED", "DOCUMENT_REJECTED", "DOCUMENT_EXPIRY_ALERT"];
const ORDERS_TAB = moduleTabs.find((t) => t.route === "(orders)")!.anyPermission!;

/**
 * The phone screen a notification opens, or null when the phone has none for it yet (the inbox shows the text instead).
 * The server's link (`pushLink`) names the web-shaped route; only the ones the phone has a screen for are mapped. A manager's notifications
 * about someone else's shift or document stay in the inbox: those are answered on the web. An overdue delivery is still in the Receive list; opening the delivery itself would start receiving it.
 */
export function phoneRoute(type: string, link: string, user: AuthUser): string | null {
  if (type === "DELIVERY_OVERDUE" && link.startsWith("/purchasing") && hasAnyPermission(user, ["purchasing:receive"])) return "/(app)/(receive)";
  if (ORDER_TYPES.includes(type) && link.startsWith("/purchasing") && hasAnyPermission(user, ORDERS_TAB) && orderRights(user).list) {
    // `from` tells the order it was opened from outside its tab, so its way back is the list.
    const poId = /^\/purchasing\/orders\/([0-9a-f-]+)$/i.exec(link)?.[1];
    return poId ? `/(app)/(orders)/order?poId=${poId}&from=link` : "/(app)/(orders)";
  }
  if (SHIFT_TYPES.includes(type) && link.startsWith("/shifts") && hasAnyPermission(user, ["roster:read-own"])) {
    const shiftId = /^\/shifts\/([0-9a-f-]+)$/i.exec(link)?.[1];
    return shiftId ? `/(app)/(roster)/shift?shiftId=${shiftId}&from=link` : "/(app)/(roster)";
  }
  if (DOCUMENT_TYPES.includes(type) && link.startsWith("/compliance") && hasAnyPermission(user, ["compliance:read-own"])) {
    const id = /^\/compliance\/documents\/([0-9a-f-]+)$/i.exec(link)?.[1];
    return id ? `/(app)/(documents)/document?id=${id}&from=link` : "/(app)/(documents)";
  }
  return null;
}

/** The phone screen for an inbox row. A discrepancy is about a delivery, and its payload says of which order (a push has no payload: it opens the list). */
export function routeFor(n: AppNotification, user: AuthUser): string | null {
  const { poId } = n.payload;
  const link = n.type === "DISCREPANCY_ALERT" && typeof poId === "string" ? pushLink(n.type, "purchase_order", poId) : pushLink(n.type, n.relatedEntityType, n.relatedEntityId);
  return phoneRoute(n.type, link, user);
}

/** Every type the inbox has words for (the tests check it covers the server's list). */
export const KNOWN_TYPES = Object.keys(COPY);

import { z } from "zod";

/**
 * Every in-app notification type the server writes (`notification.type` is varchar(30): a longer name is refused by the
 * database). A push carries one of these; the phone's settings screen lists them, and `pushLink` says where each one opens.
 */
export const NOTIFICATION_TYPES = [
  "APPROVAL_REQUIRED",
  "PO_APPROVED",
  "PO_REJECTED",
  "DISCREPANCY_ALERT",
  "DELIVERY_OVERDUE",
  "BRAIN_CAPTURE_ERROR",
  "BRAIN_DIGEST",
  "BRAIN_NUDGE",
  "DOCUMENT_EXPIRY_ALERT",
  "HOLIDAY_CONSENT_REQUESTED",
  "HOLIDAY_CONSENT_DECLINED",
  "SHIFT_SWAP_CLAIMED",
  "COMPLIANCE_DOCUMENT_NUDGE",
  "SHIFT_ASSIGNED",
  "SHIFT_CHANGED",
  "SHIFT_CANCELLED",
  "ROSTER_PUBLISHED",
  "DOCUMENT_VERIFIED",
  "DOCUMENT_REJECTED",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** An in-app route: path segments only, so a push can never send the phone to another site or a protocol handler. */
export const PUSH_LINK_PATTERN = /^\/(?!\/)[A-Za-z0-9\-/]*$/;

/** Where the phone opens when a push is tapped; also what the inbox falls back to for a type it does not know. */
export const INBOX_LINK = "/notifications";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The route a notification opens: the record it is about when `relatedEntityType` is the right kind and the id is a
 * real id, else the list that record lives in, else the inbox. The phone's screens behind these routes are built per wave;
 * until one exists the phone opens the inbox. Never carries a name, a document type or a date.
 */
export function pushLink(type: string, relatedEntityType?: string | null, relatedEntityId?: string | null): string {
  const entity = (kind: string) => (relatedEntityType === kind && relatedEntityId && UUID.test(relatedEntityId) ? relatedEntityId : null);
  switch (type as NotificationType) {
    case "SHIFT_ASSIGNED":
    case "SHIFT_CHANGED": {
      const id = entity("shift");
      return id ? `/shifts/${id}` : "/shifts";
    }
    case "SHIFT_CANCELLED": // gone from My Shifts, so the list
    case "ROSTER_PUBLISHED":
    case "SHIFT_SWAP_CLAIMED":
    case "HOLIDAY_CONSENT_REQUESTED":
    case "HOLIDAY_CONSENT_DECLINED":
      return "/shifts";
    case "DOCUMENT_VERIFIED":
    case "DOCUMENT_REJECTED":
    case "DOCUMENT_EXPIRY_ALERT":
    case "COMPLIANCE_DOCUMENT_NUDGE": {
      const id = entity("compliance_document");
      return id ? `/compliance/documents/${id}` : "/compliance";
    }
    case "APPROVAL_REQUIRED":
    case "PO_APPROVED":
    case "PO_REJECTED":
    case "DISCREPANCY_ALERT":
    case "DELIVERY_OVERDUE": {
      const id = entity("purchase_order");
      return id ? `/purchasing/orders/${id}` : "/purchasing";
    }
    case "BRAIN_CAPTURE_ERROR":
    case "BRAIN_DIGEST":
    case "BRAIN_NUDGE":
      return INBOX_LINK;
    default:
      return INBOX_LINK;
  }
}

/** The `data` of a push: ids and a route, never text a lock screen could show. The phone reads it when a push is tapped. */
export const PushDataSchema = z.object({
  notificationId: z.string(),
  type: z.string(),
  link: z.string().regex(PUSH_LINK_PATTERN),
});
export type PushData = z.infer<typeof PushDataSchema>;

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeOfDay = z.string().regex(TIME_OF_DAY, "Use a 24-hour time such as 22:00");

export const QuietHoursSchema = z
  .object({ start: timeOfDay, end: timeOfDay, timeZone: z.string().min(1).max(64) })
  .refine((q) => q.start !== q.end, { message: "Quiet hours must start and end at different times" });
export type QuietHours = z.infer<typeof QuietHoursSchema>;

/** `PUT /api/notifications/push-preferences`: each key is optional; `disabledTypes` replaces the whole list, `quietHours: null` clears the window. */
export const PushPreferencesUpdateSchema = z.object({
  disabledTypes: z.array(z.enum(NOTIFICATION_TYPES)).max(NOTIFICATION_TYPES.length).optional(),
  quietHours: QuietHoursSchema.nullable().optional(),
});
export type PushPreferencesUpdate = z.infer<typeof PushPreferencesUpdateSchema>;

/** `GET` and `PUT /api/notifications/push-preferences`. A type this phone does not know is listed with the server's label and shown as is. */
export const PushPreferencesSchema = z.object({
  types: z.array(z.object({ type: z.string(), label: z.string(), enabled: z.boolean() })).catch([]),
  quietHours: QuietHoursSchema.nullable().catch(null),
});
export type PushPreferences = z.infer<typeof PushPreferencesSchema>;

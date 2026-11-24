import { z } from "zod";

/**
 * One row of `GET /api/inventory/notifications` (the bell's list: unread in-app notifications, newest first). The payload's
 * shape depends on the type and on the server version, so it is kept as a loose record and read field by field.
 */
export const AppNotificationSchema = z.object({
  notificationId: z.string(),
  type: z.string(),
  payload: z.record(z.unknown()).catch({}),
  relatedEntityType: z.string().nullable().catch(null),
  relatedEntityId: z.string().nullable().catch(null),
  createdAt: z.string(),
});
export type AppNotification = z.infer<typeof AppNotificationSchema>;

/** A row this app cannot read is left out rather than failing the whole list. */
export const AppNotificationListSchema = z
  .array(z.unknown())
  .transform((rows) => rows.flatMap((r) => {
    const parsed = AppNotificationSchema.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  }));

/** `GET /api/inventory/notifications/count`. */
export const UnreadCountSchema = z.object({ count: z.number().int().nonnegative().catch(0) });

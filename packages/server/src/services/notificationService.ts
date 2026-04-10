/**
 * @module services/notificationService
 *
 * Transactional notification system for the purchasing module.
 * Supports in-app (notification bell) and email (Resend) channels.
 * Polymorphic: type + JSONB payload for type-specific data.
 */

import { eq, and, ne, inArray, desc, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  notification,
  user,
  rolePermission,
  permission,
  userRole,
  userOrganisation,
} from "../db/schema.js";
import { sendDirectEmail } from "./emailService.js";
import pino from "pino";

const logger = pino({ name: "notificationService" });

// ── Notification types ───────────────────────────────────────────────
export type NotificationType =
  | "APPROVAL_REQUIRED"
  | "PO_APPROVED"
  | "PO_REJECTED"
  | "DISCREPANCY_ALERT"
  | "DELIVERY_OVERDUE";

export type NotificationChannel = "IN_APP" | "EMAIL";

export interface CreateNotificationParams {
  organisationId: number;
  recipientUserId: number;
  type: NotificationType;
  channel?: NotificationChannel;
  payload: Record<string, unknown>;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

// ── Core CRUD ────────────────────────────────────────────────────────

/**
 * Create an in-app notification (stored in DB, displayed in notification bell).
 */
export async function createInApp(
  params: Omit<CreateNotificationParams, "channel">,
) {
  const [row] = await db
    .insert(notification)
    .values({
      organisationId: params.organisationId,
      recipientUserId: params.recipientUserId,
      type: params.type,
      channel: "IN_APP",
      status: "SENT",
      payload: params.payload,
      relatedEntityType: params.relatedEntityType,
      relatedEntityId: params.relatedEntityId,
      sentAt: new Date(),
    })
    .returning();

  logger.info(
    { notificationId: row.notificationId, type: params.type, userId: params.recipientUserId },
    "In-app notification created",
  );

  return row;
}

/**
 * Send an email notification via Resend and log it.
 */
export async function sendEmailNotification(
  params: CreateNotificationParams & { recipientEmail: string; subject: string; htmlBody: string },
) {
  // Insert the notification record first
  const [row] = await db
    .insert(notification)
    .values({
      organisationId: params.organisationId,
      recipientUserId: params.recipientUserId,
      type: params.type,
      channel: "EMAIL",
      status: "PENDING",
      payload: params.payload,
      relatedEntityType: params.relatedEntityType,
      relatedEntityId: params.relatedEntityId,
    })
    .returning();

  // Attempt email send
  const result = await sendDirectEmail(params.recipientEmail, params.subject, params.htmlBody);

  // Update notification status
  await db
    .update(notification)
    .set({
      status: result.sent ? "SENT" : "FAILED",
      sentAt: result.sent ? new Date() : undefined,
    })
    .where(eq(notification.notificationId, row.notificationId));

  if (!result.sent) {
    logger.error(
      { notificationId: row.notificationId, error: result.error },
      "Email notification failed",
    );
  } else {
    logger.info(
      { notificationId: row.notificationId, type: params.type },
      "Email notification sent",
    );
  }

  return { notificationId: row.notificationId, sent: result.sent, error: result.error };
}

// ── Notification bell queries ────────────────────────────────────────

/**
 * Get unread/unacted in-app notifications for a user.
 */
export async function getUnreadForUser(userId: number, limit = 20) {
  return db
    .select()
    .from(notification)
    .where(
      and(
        eq(notification.recipientUserId, userId),
        eq(notification.channel, "IN_APP"),
        ne(notification.status, "READ"),
        ne(notification.status, "DISMISSED"),
      ),
    )
    .orderBy(desc(notification.createdAt))
    .limit(limit);
}

/**
 * Get count of unread in-app notifications for a user.
 */
export async function getUnreadCount(userId: number): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notification)
    .where(
      and(
        eq(notification.recipientUserId, userId),
        eq(notification.channel, "IN_APP"),
        ne(notification.status, "READ"),
        ne(notification.status, "DISMISSED"),
      ),
    );

  return result?.count ?? 0;
}

/**
 * Mark a notification as read.
 */
export async function markAsRead(notificationId: string, userId: number) {
  const [updated] = await db
    .update(notification)
    .set({ status: "READ", readAt: new Date() })
    .where(
      and(
        eq(notification.notificationId, notificationId),
        eq(notification.recipientUserId, userId),
      ),
    )
    .returning();

  return updated;
}

/**
 * Dismiss a notification (user explicitly closed it).
 */
export async function dismiss(notificationId: string, userId: number) {
  const [updated] = await db
    .update(notification)
    .set({ status: "DISMISSED" })
    .where(
      and(
        eq(notification.notificationId, notificationId),
        eq(notification.recipientUserId, userId),
      ),
    )
    .returning();

  return updated;
}

// ── Bulk notification helpers ────────────────────────────────────────

/**
 * Find all users in an org with a specific permission.
 * Used for notifying all HQ admins of pending approvals.
 */
export async function getUsersWithPermission(
  orgId: number,
  permissionKey: string,
): Promise<Array<{ userId: number; userEmail: string; userName: string }>> {
  const rows = await db
    .select({
      userId: user.userId,
      userEmail: user.userEmail,
      userName: user.userName,
    })
    .from(user)
    .innerJoin(userOrganisation, eq(user.userId, userOrganisation.userId))
    .innerJoin(userRole, eq(user.userId, userRole.userId))
    .innerJoin(rolePermission, eq(userRole.roleId, rolePermission.roleId))
    .innerJoin(permission, eq(rolePermission.permissionId, permission.permissionId))
    .where(
      and(
        eq(userOrganisation.organisationId, orgId),
        eq(permission.permissionKey, permissionKey),
      ),
    );

  // Deduplicate (a user might have multiple roles granting the same permission)
  const seen = new Set<number>();
  return rows.filter((r) => {
    if (seen.has(r.userId)) return false;
    seen.add(r.userId);
    return true;
  });
}

/**
 * Notify all HQ admins (users with purchasing:approve) of a pending PO.
 * Creates both in-app and email notifications for each admin.
 */
export async function notifyHQAdmins(
  orgId: number,
  type: NotificationType,
  payload: Record<string, unknown>,
  relatedEntityType: string,
  relatedEntityId: string,
  emailSubject: string,
  emailBody: string,
) {
  const admins = await getUsersWithPermission(orgId, "purchasing:approve");

  logger.info(
    { orgId, adminCount: admins.length, type },
    "Notifying HQ admins",
  );

  const results = [];

  for (const admin of admins) {
    // In-app notification
    await createInApp({
      organisationId: orgId,
      recipientUserId: admin.userId,
      type,
      payload,
      relatedEntityType,
      relatedEntityId,
    });

    // Email notification
    const emailResult = await sendEmailNotification({
      organisationId: orgId,
      recipientUserId: admin.userId,
      recipientEmail: admin.userEmail,
      type,
      payload,
      relatedEntityType,
      relatedEntityId,
      subject: emailSubject,
      htmlBody: emailBody,
    });

    results.push({ userId: admin.userId, ...emailResult });
  }

  return results;
}

/**
 * Check if a notification already exists for an entity to prevent duplicates.
 * Used by overdue checker to throttle repeated notifications.
 */
export async function hasRecentNotification(
  relatedEntityType: string,
  relatedEntityId: string,
  type: NotificationType,
  withinHours = 24,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - withinHours * 60 * 60 * 1000);

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notification)
    .where(
      and(
        eq(notification.relatedEntityType, relatedEntityType),
        eq(notification.relatedEntityId, relatedEntityId),
        eq(notification.type, type),
        sql`${notification.createdAt} > ${cutoff}`,
      ),
    );

  return (result?.count ?? 0) > 0;
}

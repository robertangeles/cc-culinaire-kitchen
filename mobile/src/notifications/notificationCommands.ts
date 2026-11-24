/**
 * Marking a notification read is a queued command, so it works with no signal and the row does not come back on the next refresh.
 * `PATCH .../read` is safe to repeat; a 404 means the notification is gone (dismissed on the web, or the account's), which is done too.
 */

import { ApiError } from "../api/client";
import type { CommandHandler } from "../outbox/outbox";
import type { NotificationsApi } from "./notificationsApi";

export interface NotificationReadCommand {
  notificationId: string;
}

export const NOTIFICATION_READ = "notification.read";
export const NOTIFICATION_TYPES = [NOTIFICATION_READ];

export function notificationHandlers(api: Pick<NotificationsApi, "markRead">): CommandHandler<unknown>[] {
  const read: CommandHandler<NotificationReadCommand> = {
    type: NOTIFICATION_READ,
    version: 1,
    key: (c) => `notification:${c.notificationId}`,
    send: (c) => api.markRead(c.notificationId),
    isApplied: (err: ApiError) => err.code === "not_found",
    // Reading it twice is reading it once.
    latestOnly: true,
    maxServerFailures: 5,
    describe: () => "Mark a notification read",
  };
  return [read as CommandHandler<unknown>];
}

import { AppNotificationListSchema, UnreadCountSchema, type AppNotification } from "@culinaire/shared/schemas/notifications";
import { PushPreferencesSchema, type PushPreferences, type PushPreferencesUpdate } from "@culinaire/shared/schemas/push";
import type { ApiClient, TokenStore } from "../api/client";

/** The in-app list (the web bell's routes, every signed-in person) and this device's push token and settings. */
export function createNotificationsApi(client: ApiClient, tokenStore: TokenStore) {
  return {
    /** Unread in-app notifications, newest first. The server keeps no read history: a read one leaves this list. */
    list(limit = 50): Promise<AppNotification[]> {
      return client.request("GET", `/api/inventory/notifications?limit=${limit}`, { schema: AppNotificationListSchema });
    },

    async unreadCount(): Promise<number> {
      return (await client.request("GET", "/api/inventory/notifications/count", { schema: UnreadCountSchema })).count;
    },

    /** Safe to repeat: a read one answers with the row again. */
    async markRead(notificationId: string): Promise<void> {
      await client.request("PATCH", `/api/inventory/notifications/${encodeURIComponent(notificationId)}/read`);
    },

    /** The refresh token goes with it, so the server ties the token to this sign-in and drops it when the sign-in ends. */
    async registerDevice(deviceToken: string, platform: "android" | "ios"): Promise<void> {
      const tokens = await tokenStore.load();
      await client.request("POST", "/api/notifications/register-device", { body: { deviceToken, platform, refreshToken: tokens?.refreshToken } });
    },

    async unregisterDevice(deviceToken: string, timeoutMs?: number): Promise<void> {
      await client.request("POST", "/api/notifications/unregister-device", { body: { deviceToken }, timeoutMs });
    },

    preferences(): Promise<PushPreferences> {
      return client.request("GET", "/api/notifications/push-preferences", { schema: PushPreferencesSchema });
    },

    savePreferences(update: PushPreferencesUpdate): Promise<PushPreferences> {
      return client.request("PUT", "/api/notifications/push-preferences", { body: update, schema: PushPreferencesSchema });
    },
  };
}

export type NotificationsApi = ReturnType<typeof createNotificationsApi>;

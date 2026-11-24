/**
 * The `expo-notifications` side of push: the system permission, the Expo push token, and what a push does when it arrives or is tapped.
 * Kept thin; the decisions are in `push.ts`, which the tests drive with a fake.
 */

import { Linking, Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import type { Permission, PushNative } from "./push";

const CHANNEL = "default";

/** Android 13 shows the permission prompt only once the app has a channel; older Android needs one to show anything. */
async function ensureChannel() {
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Notifications", importance: Notifications.AndroidImportance.HIGH });
}

const read = (p: Notifications.NotificationPermissionsStatus): Permission => ({ status: p.status as Permission["status"], canAskAgain: p.canAskAgain });

export const nativePush: PushNative = {
  platform: Platform.OS === "ios" ? "ios" : "android",
  permission: async () => read(await Notifications.getPermissionsAsync()),
  async requestPermission() {
    await ensureChannel();
    return read(await Notifications.requestPermissionsAsync());
  },
  async token() {
    // The Expo project id comes from `eas init` (the owner's account); without it, and without Firebase on Android, there is no token.
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) throw new Error("No Expo project id in this build");
    await ensureChannel();
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  },
  openSettings: () => void Linking.openSettings(),
};

/**
 * A push that arrives while the app is open shows as a banner too, and `onArrive` runs (the inbox refreshes). A tapped push gives its
 * `data` to `onTap`, including the one that started the app; that one is cleared once handled, so a remount does not open it again.
 */
export function listenForPushes({ onArrive, onTap }: { onArrive: () => void; onTap: (data: unknown) => void }): () => void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  const arrived = Notifications.addNotificationReceivedListener(() => onArrive());
  const tapped = Notifications.addNotificationResponseReceivedListener((r) => {
    onTap(r.notification.request.content.data);
    Notifications.clearLastNotificationResponse();
  });
  const launched = Notifications.getLastNotificationResponse();
  if (launched) {
    Notifications.clearLastNotificationResponse();
    onTap(launched.notification.request.content.data);
  }
  return () => {
    arrived.remove();
    tapped.remove();
  };
}

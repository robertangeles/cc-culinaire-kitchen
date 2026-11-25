import { Alert } from "react-native";

/**
 * A native question (Alert) sits above the lock screen and cannot be closed from here. One left open when the app locked must not be
 * answerable by whoever picks the phone up: while the app is locked its buttons do nothing.
 */
export function lockAlerts(isLocked: () => boolean): void {
  const show = Alert.alert;
  Alert.alert = (title, message, buttons, options) =>
    show(
      title,
      message,
      buttons?.map((b) => {
        const press = b.onPress as ((value?: unknown) => void) | undefined;
        return press ? { ...b, onPress: (value?: unknown) => (isLocked() ? undefined : press(value)) } : b;
      }),
      options,
    );
}

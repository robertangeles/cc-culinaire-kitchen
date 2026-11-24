import { Stack } from "expo-router";

/** The inbox: one screen. Its store is app-wide (`src/runtime/notifications.ts`), because the tab badge and a tapped push read it too. */
export default function InboxLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

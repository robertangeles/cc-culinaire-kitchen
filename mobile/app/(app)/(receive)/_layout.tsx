import { Stack } from "expo-router";

// Not "index": the Count module's index already owns "/", and two groups cannot share a path.
export const unstable_settings = { initialRouteName: "deliveries/index" };

/** The receiving module: the deliveries queue, then one delivery at a time. */
export default function ReceiveLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

import { Stack } from "expo-router";
import { ConsumptionProvider } from "../../../src/consumption/ConsumptionProvider";
import { useSession } from "../../../src/runtime/appContext";

/** The usage module: one usage store per location, shared by its screens. */
export default function UsageLayout() {
  const { state } = useSession();
  if (state.phase !== "ready") return null;
  const { user } = state;
  return (
    <ConsumptionProvider locationId={state.location.storeLocationId} viewer={{ userId: user.userId, userName: user.userName, isAdmin: user.roles.includes("Administrator") }}>
      <Stack screenOptions={{ headerShown: false }} />
    </ConsumptionProvider>
  );
}

import { Stack } from "expo-router";
import { MovementProvider } from "../../../src/movements/MovementProvider";
import { useSession } from "../../../src/runtime/appContext";

/** The moves module: one moves store per location, shared by its screens. */
export default function MovesLayout() {
  const { state } = useSession();
  if (state.phase !== "ready") return null;
  return (
    <MovementProvider locationId={state.location.storeLocationId} userName={state.user.userName}>
      <Stack screenOptions={{ headerShown: false }} />
    </MovementProvider>
  );
}

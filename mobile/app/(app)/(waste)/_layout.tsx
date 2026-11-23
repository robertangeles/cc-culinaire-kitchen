import { Stack } from "expo-router";
import { WasteProvider } from "../../../src/waste/WasteProvider";
import { useSession } from "../../../src/runtime/appContext";

/** The waste module: one waste store per location, shared by its screens. */
export default function WasteLayout() {
  const { state } = useSession();
  if (state.phase !== "ready") return null;
  return (
    <WasteProvider locationId={state.location.storeLocationId}>
      <Stack screenOptions={{ headerShown: false }} />
    </WasteProvider>
  );
}

import { Stack } from "expo-router";
import { CountProvider } from "../../../src/count/CountProvider";
import { useSession } from "../../../src/runtime/appContext";

/** The counting module: one count store per location, shared by its screens. */
export default function CountLayout() {
  const { state } = useSession();
  if (state.phase !== "ready") return null;
  return (
    <CountProvider locationId={state.location.storeLocationId}>
      <Stack screenOptions={{ headerShown: false }} />
    </CountProvider>
  );
}

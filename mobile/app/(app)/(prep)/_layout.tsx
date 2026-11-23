import { Stack } from "expo-router";
import { PrepProvider } from "../../../src/prep/PrepProvider";
import { useSession } from "../../../src/runtime/appContext";
import { hasAnyPermission } from "../../../src/shell/tabs";

/** The prep module: one prep store per location, shared by its screens. Only `prep:manage` holders may make the list. */
export default function PrepLayout() {
  const { state } = useSession();
  if (state.phase !== "ready") return null;
  return (
    <PrepProvider locationId={state.location.storeLocationId} canPlan={hasAnyPermission(state.user, ["prep:manage"])}>
      <Stack screenOptions={{ headerShown: false }} />
    </PrepProvider>
  );
}

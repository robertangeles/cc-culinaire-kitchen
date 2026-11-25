import { Stack } from "expo-router";
import { MenuProvider } from "../../../src/menu/MenuProvider";
import { useSession } from "../../../src/runtime/appContext";
import { hasAnyPermission } from "../../../src/shell/tabs";

/** The menu module: one menu store shared by its screens. Costs show only for `inventory:cost` holders. */
export default function MenuLayout() {
  const { state } = useSession();
  if (state.phase !== "ready") return null;
  return (
    <MenuProvider locationId={state.location.storeLocationId} canSeeCost={hasAnyPermission(state.user, ["inventory:cost"])}>
      <Stack screenOptions={{ headerShown: false }} />
    </MenuProvider>
  );
}

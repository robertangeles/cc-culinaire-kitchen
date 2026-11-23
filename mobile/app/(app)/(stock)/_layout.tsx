import { Stack } from "expo-router";
import { StockProvider } from "../../../src/stock/StockProvider";
import { useSession } from "../../../src/runtime/appContext";
import { hasAnyPermission } from "../../../src/shell/tabs";

/** The stock module: one stock store per location, shared by its screens. Quantities and value show only for `inventory:cost` holders. */
export default function StockLayout() {
  const { state } = useSession();
  if (state.phase !== "ready") return null;
  return (
    <StockProvider locationId={state.location.storeLocationId} canSeeQty={hasAnyPermission(state.user, ["inventory:cost"])}>
      <Stack screenOptions={{ headerShown: false }} />
    </StockProvider>
  );
}

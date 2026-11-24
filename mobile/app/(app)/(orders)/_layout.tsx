import { Stack } from "expo-router";
import { OrdersProvider } from "../../../src/orders/OrdersProvider";
import { useSession } from "../../../src/runtime/appContext";

/** The orders module: purchase orders, the approvals queue and credit notes, sharing their lists and the order being written. */
export default function OrdersLayout() {
  const { state } = useSession();
  if (state.phase !== "ready") return null;
  return (
    <OrdersProvider user={state.user} locationId={state.location.storeLocationId}>
      <Stack screenOptions={{ headerShown: false }} />
    </OrdersProvider>
  );
}

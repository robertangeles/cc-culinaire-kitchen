import { Stack } from "expo-router";
import { TransferProvider } from "../../../src/transfers/TransferProvider";
import { useSession } from "../../../src/runtime/appContext";

/** The transfers module: one transfer store per location, shared by its screens. */
export default function TransfersLayout() {
  const { state } = useSession();
  if (state.phase !== "ready") return null;
  return (
    <TransferProvider locationId={state.location.storeLocationId} locationName={state.location.locationName} userName={state.user.userName}>
      <Stack screenOptions={{ headerShown: false }} />
    </TransferProvider>
  );
}

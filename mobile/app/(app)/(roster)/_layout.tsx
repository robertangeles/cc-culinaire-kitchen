import { Stack } from "expo-router";
import { RosterProvider } from "../../../src/roster/RosterProvider";
import { useSession } from "../../../src/runtime/appContext";

/** The roster module, staff side: my shifts, the open swaps and my availability. */
export default function RosterLayout() {
  const { state } = useSession();
  if (state.phase !== "ready") return null;
  return (
    <RosterProvider userId={state.user.userId}>
      <Stack screenOptions={{ headerShown: false }} />
    </RosterProvider>
  );
}

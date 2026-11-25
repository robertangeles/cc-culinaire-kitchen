import { Stack } from "expo-router";
import { BrainProvider } from "../../../src/brain/BrainProvider";
import { useSession } from "../../../src/runtime/appContext";

/** Your Brain: one screen. */
export default function BrainLayout() {
  const { state } = useSession();
  if (state.phase !== "ready") return null;
  return (
    <BrainProvider userId={state.user.userId}>
      <Stack screenOptions={{ headerShown: false }} />
    </BrainProvider>
  );
}

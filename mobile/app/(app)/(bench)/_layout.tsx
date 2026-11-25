import { Stack } from "expo-router";
import { BenchProvider } from "../../../src/bench/BenchProvider";
import { useSession } from "../../../src/runtime/appContext";

/** The Bench: its list and its rooms share one live connection. */
export default function BenchLayout() {
  const { state } = useSession();
  if (state.phase !== "ready") return null;
  return (
    <BenchProvider userId={state.user.userId}>
      <Stack screenOptions={{ headerShown: false }} />
    </BenchProvider>
  );
}

import { Stack } from "expo-router";
import { DocumentsProvider } from "../../../src/compliance/DocumentsProvider";
import { useSession } from "../../../src/runtime/appContext";

/** The compliance module, staff side: the person's own certificates. */
export default function DocumentsLayout() {
  const { state } = useSession();
  if (state.phase !== "ready") return null;
  return (
    <DocumentsProvider userId={state.user.userId}>
      <Stack screenOptions={{ headerShown: false }} />
    </DocumentsProvider>
  );
}

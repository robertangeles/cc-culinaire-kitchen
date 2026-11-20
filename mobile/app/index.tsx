import { session, useSession } from "../src/app/appContext";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { Button } from "../src/ui/Button";

// Placeholder home (PR 3b): PR 3d replaces this with the areas list of the open stock take.
export default function Home() {
  const { state } = useSession();
  if (state.phase !== "ready") return null;
  return (
    <Screen>
      <Text variant="title">{state.location.locationName}</Text>
      <Text variant="muted">Signed in as {state.user.userName}.</Text>
      <Button kind="quiet" label="Sign out" onPress={() => void session.signOut()} />
    </Screen>
  );
}

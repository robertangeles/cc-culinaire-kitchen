import { session, useSession } from "../src/runtime/appContext";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { Button } from "../src/ui/Button";

export default function NoAccess() {
  const { state } = useSession();
  return (
    <Screen>
      <Text variant="title">No location yet</Text>
      <Text>{state.phase === "noAccess" ? state.reason : ""}</Text>
      <Button label="Sign out" onPress={() => void session.signOut()} />
    </Screen>
  );
}

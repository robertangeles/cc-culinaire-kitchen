import { session, useSession } from "../../src/runtime/appContext";
import { visibleTabs } from "../../src/shell/tabs";
import { Screen } from "../../src/ui/Screen";
import { Text } from "../../src/ui/Text";
import { Button } from "../../src/ui/Button";
import { Surface } from "../../src/ui/Surface";
import { View } from "react-native";
import { space } from "../../src/theme";

/** Who is signed in and where, plus the two things every person needs whatever they can open: change location and sign out. */
export default function Account() {
  const { state } = useSession();
  if (state.phase !== "ready") return null;
  const { user, location, locations } = state;

  return (
    <Screen>
      <Text variant="title">{user.userName || "Your account"}</Text>
      <Surface>
        <View style={{ padding: space.lg, gap: space.xs }}>
          {user.userEmail ? <Text variant="meta">{user.userEmail}</Text> : null}
          <Text>{location.locationName}</Text>
        </View>
      </Surface>
      {visibleTabs(user).length === 0 ? <Text variant="muted">Nothing on your account is available on the phone yet. Ask your manager.</Text> : null}
      {locations.length > 1 ? <Button kind="ghost" label="Change location" onPress={() => session.changeLocation()} /> : null}
      <Button kind="quiet" label="Sign out" onPress={() => void session.signOut()} />
    </Screen>
  );
}

import { Pressable } from "react-native";
import { session, useSession } from "../src/app/appContext";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { Button } from "../src/ui/Button";
import { size } from "../src/theme";
import { useColors } from "../src/ui/theme";

export default function ChooseLocation() {
  const { state, busy } = useSession();
  const c = useColors();
  if (state.phase !== "chooseLocation") return null;

  return (
    <Screen>
      <Text variant="title">Where are you counting?</Text>
      {state.locations.map((l) => (
        <Pressable
          key={l.storeLocationId}
          accessibilityRole="button"
          accessibilityLabel={l.storeLocationId === state.current?.storeLocationId ? `${l.locationName}, current location` : l.locationName}
          disabled={busy}
          onPress={() => void session.chooseLocation(l.storeLocationId)}
          style={{ minHeight: size.tap, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: c.border, opacity: busy ? 0.5 : 1 }}
        >
          <Text>{l.locationName}</Text>
          {l.storeLocationId === state.current?.storeLocationId ? <Text variant="muted">Current location</Text> : null}
        </Pressable>
      ))}
      {state.error ? (
        <Text variant="error" accessibilityLiveRegion="polite">
          {state.error}
        </Text>
      ) : null}
      {state.current ? <Button kind="quiet" label="Cancel" onPress={() => session.cancelChangeLocation()} /> : null}
      <Button kind="quiet" label="Sign out" onPress={() => void session.signOut()} />
    </Screen>
  );
}

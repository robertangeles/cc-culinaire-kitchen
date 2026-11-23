import { Pressable } from "react-native";
import { session, useSession } from "../src/runtime/appContext";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { Button } from "../src/ui/Button";
import { Surface, rowDivider } from "../src/ui/Surface";
import { fontFamily, size, space } from "../src/theme";
import { useColors } from "../src/ui/theme";

export default function ChooseLocation() {
  const { state, busy } = useSession();
  const c = useColors();
  if (state.phase !== "chooseLocation") return null;

  return (
    <Screen align="top">
      <Text variant="title">Where are you working?</Text>
      <Surface>
      {state.locations.map((l, index) => (
        <Pressable
          key={l.storeLocationId}
          accessibilityRole="button"
          accessibilityLabel={l.storeLocationId === state.current?.storeLocationId ? `${l.locationName}, current location` : l.locationName}
          disabled={busy}
          onPress={() => void session.chooseLocation(l.storeLocationId)}
          style={[{ minHeight: size.tap + 8, justifyContent: "center", paddingHorizontal: space.lg, paddingVertical: space.sm, opacity: busy ? 0.5 : 1 }, rowDivider(index, c.border)]}
        >
          <Text style={{ fontFamily: fontFamily.title, fontSize: 20 }}>{l.locationName}</Text>
          {l.storeLocationId === state.current?.storeLocationId ? <Text variant="meta">Current location</Text> : null}
        </Pressable>
      ))}
      </Surface>
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

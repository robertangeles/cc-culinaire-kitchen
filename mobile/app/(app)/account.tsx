import { appleEnabled, session, useSession } from "../../src/runtime/appContext";
import { QueueStatus } from "../../src/outbox/QueueStatus";
import { PREP_TYPES } from "../../src/prep/prepCommands";
import { CONSUMPTION_TYPES } from "../../src/consumption/consumptionCommands";
import { MOVEMENT_TYPES } from "../../src/movements/movementCommands";
import { WASTE_TYPES } from "../../src/waste/wasteCommands";
import { Screen } from "../../src/ui/Screen";
import { Text } from "../../src/ui/Text";
import { Button } from "../../src/ui/Button";
import { Surface } from "../../src/ui/Surface";
import { LegalLinks } from "../../src/ui/LegalLinks";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { space } from "../../src/theme";

/** Who is signed in and where, plus the two things every person needs whatever they can open: change location and sign out. */
export default function Account() {
  const { state } = useSession();
  const router = useRouter();
  if (state.phase !== "ready") return null;
  const { user, location, locations } = state;

  return (
    <Screen align="top">
      <Text variant="title">{user.userName || "Your account"}</Text>
      <Surface>
        <View style={{ padding: space.lg, gap: space.xs }}>
          {user.userEmail ? <Text variant="meta">{user.userEmail}</Text> : null}
          <Text>{location.locationName}</Text>
        </View>
      </Surface>
      {/* What is waiting on this phone and what the server refused. Each module's command types are listed here (counts have their own screen). */}
      <QueueStatus types={[...WASTE_TYPES, ...PREP_TYPES, ...CONSUMPTION_TYPES, ...MOVEMENT_TYPES]} />
      {locations.length > 1 ? <Button kind="ghost" label="Change location" onPress={() => session.changeLocation()} /> : null}
      {appleEnabled ? <Button kind="ghost" label="Add Sign in with Apple" onPress={() => router.push("/link-apple")} /> : null}
      <Button kind="quiet" label="Sign out" onPress={() => void session.signOut()} />
      <LegalLinks />
      <Button kind="danger" label="Delete my account" onPress={() => router.push("/delete-account")} />
    </Screen>
  );
}

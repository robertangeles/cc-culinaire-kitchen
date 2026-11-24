import { appleEnabled, session, useSession } from "../../src/runtime/appContext";
import { QueueStatus } from "../../src/outbox/QueueStatus";
import { PREP_TYPES } from "../../src/prep/prepCommands";
import { CONSUMPTION_TYPES } from "../../src/consumption/consumptionCommands";
import { MOVEMENT_TYPES } from "../../src/movements/movementCommands";
import { WASTE_TYPES } from "../../src/waste/wasteCommands";
import { NOTIFICATION_TYPES } from "../../src/notifications/notificationCommands";
import { Screen } from "../../src/ui/Screen";
import { Text } from "../../src/ui/Text";
import { Button } from "../../src/ui/Button";
import { Surface, rowDivider } from "../../src/ui/Surface";
import { Avatar } from "../../src/ui/Avatar";
import { LegalLinks } from "../../src/ui/LegalLinks";
import { useRouter, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { fontFamily, size, space } from "../../src/theme";
import { useColors } from "../../src/ui/theme";

const ROWS: { label: string; href: Href }[] = [
  { label: "My details", href: "/profile" },
  { label: "Kitchen profile", href: "/kitchen-profile" },
  { label: "Password", href: "/change-password" },
  { label: "Two-step verification", href: "/two-step" },
  { label: "Notifications", href: "/notification-settings" },
];

/** Who is signed in and where, the profile and security screens, and what every person needs whatever they can open: change location and sign out. */
export default function Account() {
  const { state } = useSession();
  const router = useRouter();
  const c = useColors();
  if (state.phase !== "ready") return null;
  const { user, location, locations } = state;

  return (
    <Screen align="top">
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
        <Avatar photoPath={user.userPhotoPath} name={user.userName} />
        <View style={{ flex: 1, gap: space.xs }}>
          <Text variant="title">{user.userName || "Your account"}</Text>
          {user.userEmail ? <Text variant="meta">{user.userEmail}</Text> : null}
          <Text>{location.locationName}</Text>
        </View>
      </View>
      <Surface>
        {ROWS.map((row, index) => (
          <Pressable
            key={row.label}
            accessibilityRole="button"
            accessibilityLabel={row.label}
            onPress={() => router.push(row.href)}
            style={({ pressed }) => [{ minHeight: size.tap, flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, backgroundColor: pressed ? c.surface : undefined }, rowDivider(index, c.border)]}
          >
            <Text style={{ flex: 1, fontFamily: fontFamily.uiStrong }}>{row.label}</Text>
            <Text style={{ color: c.accentText, fontSize: 22 }}>›</Text>
          </Pressable>
        ))}
      </Surface>
      {/* What is waiting on this phone and what the server refused. Each module's command types are listed here (counts have their own screen). */}
      <QueueStatus types={[...WASTE_TYPES, ...PREP_TYPES, ...CONSUMPTION_TYPES, ...MOVEMENT_TYPES, ...NOTIFICATION_TYPES]} />
      {locations.length > 1 ? <Button kind="ghost" label="Change location" onPress={() => session.changeLocation()} /> : null}
      {appleEnabled ? <Button kind="ghost" label="Add Sign in with Apple" onPress={() => router.push("/link-apple")} /> : null}
      <Button kind="quiet" label="Sign out" onPress={() => void session.signOut()} />
      <LegalLinks />
      <Button kind="danger" label="Delete my account" onPress={() => router.push("/delete-account")} />
    </Screen>
  );
}

import { Pressable, View } from "react-native";
import { useNavigation } from "expo-router";
import { useSession } from "../../src/runtime/appContext";
import { useInbox } from "../../src/runtime/notifications";
import { tabBar } from "../../src/shell/tabs";
import { Screen } from "../../src/ui/Screen";
import { Text } from "../../src/ui/Text";
import { Chip, Surface, rowDivider } from "../../src/ui/Surface";
import { TabIcon, type TabIconName } from "../../src/ui/TabIcon";
import { useColors } from "../../src/ui/theme";
import { fontFamily, size, space } from "../../src/theme";

/** The fifth tab when a person has more modules than the tab bar holds: the modules that did not fit, then Account. */
export default function More() {
  const { state } = useSession();
  const navigation = useNavigation<{ navigate: (route: string) => void }>();
  const c = useColors();
  const { unread } = useInbox();
  if (state.phase !== "ready") return null;
  const rows: { route: string; title: string; icon: TabIconName }[] = [...tabBar(state.user).more, { route: "account", title: "Account", icon: "account" }];

  return (
    <Screen align="top">
      <Text variant="title">More</Text>
      <Surface>
        {rows.map((row, index) => (
          <Pressable
            key={row.route}
            accessibilityRole="button"
            accessibilityLabel={row.route === "(inbox)" && unread > 0 ? `${row.title}, ${unread} unread` : row.title}
            onPress={() => navigation.navigate(row.route)}
            style={[{ minHeight: size.tap + 8, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg }, rowDivider(index, c.border)]}
          >
            <TabIcon name={row.icon} color={c.accentText} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fontFamily.title, fontSize: 20 }}>{row.title}</Text>
            </View>
            {row.route === "(inbox)" && unread > 0 ? <Chip label={`${unread > 99 ? "99+" : unread} unread`} /> : null}
          </Pressable>
        ))}
      </Surface>
    </Screen>
  );
}

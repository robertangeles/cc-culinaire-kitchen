import { Tabs } from "expo-router";
import { useSession } from "../../src/runtime/appContext";
import { canOpen, moduleTabs } from "../../src/shell/tabs";
import { TabIcon } from "../../src/ui/TabIcon";
import { useColors } from "../../src/ui/theme";
import { fontFamily, size } from "../../src/theme";

/** The signed-in app: one tab per module the person's permissions open, then Account. Each module is a route group next to this file. */
export default function AppTabs() {
  const { state } = useSession();
  const c = useColors();
  if (state.phase !== "ready") return null;
  const { user } = state;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accentText,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, minHeight: size.tap },
        tabBarLabelStyle: { fontFamily: fontFamily.uiStrong, fontSize: 16 },
      }}
    >
      {moduleTabs.map((tab) => (
        // A tab the person cannot open is not in the navigator at all, so a link or a back press cannot reach it.
        <Tabs.Protected key={tab.route} guard={canOpen(user, tab)}>
          <Tabs.Screen name={tab.route} options={{ title: tab.title, tabBarIcon: ({ color }) => <TabIcon name={tab.icon} color={color} /> }} />
        </Tabs.Protected>
      ))}
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: ({ color }) => <TabIcon name="account" color={color} /> }} />
    </Tabs>
  );
}

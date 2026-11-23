import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/runtime/appContext";
import { canOpen, moduleTabs, tabBar } from "../../src/shell/tabs";
import { TabIcon } from "../../src/ui/TabIcon";
import { useColors } from "../../src/ui/theme";
import { fontFamily, size, space } from "../../src/theme";

/**
 * The signed-in app: one tab per module the person's permissions open, then Account; at most five buttons, so a person with more
 * modules gets four and More (the rest and Account). Each module is a route group next to this file.
 */
export default function AppTabs() {
  const { state } = useSession();
  const c = useColors();
  // The system navigation bar (three buttons or the gesture handle) sits over the bottom of the window: the bar's own height starts above it.
  const insets = useSafeAreaInsets();
  if (state.phase !== "ready") return null;
  const { user } = state;
  const { more } = tabBar(user);
  const overflow = more.length > 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accentText,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, height: size.tabBar + insets.bottom, paddingTop: space.sm, paddingBottom: space.sm + insets.bottom },
        tabBarLabelStyle: { fontFamily: fontFamily.uiStrong, fontSize: 16 },
      }}
    >
      {moduleTabs.map((tab) => (
        // A tab the person cannot open is not in the navigator at all, so a link or a back press cannot reach it. One under More has no button.
        <Tabs.Protected key={tab.route} guard={canOpen(user, tab)}>
          <Tabs.Screen name={tab.route} options={{ title: tab.title, href: more.includes(tab) ? null : undefined, tabBarIcon: ({ color }) => <TabIcon name={tab.icon} color={color} /> }} />
        </Tabs.Protected>
      ))}
      <Tabs.Screen name="more" options={{ title: "More", href: overflow ? undefined : null, tabBarIcon: ({ color }) => <TabIcon name="more" color={color} /> }} />
      <Tabs.Screen name="account" options={{ title: "Account", href: overflow ? null : undefined, tabBarIcon: ({ color }) => <TabIcon name="account" color={color} /> }} />
    </Tabs>
  );
}

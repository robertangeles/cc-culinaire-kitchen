import { useRef } from "react";
import { Platform, View, type ColorValue } from "react-native";
import { Redirect, Tabs, usePathname, useSegments } from "expo-router";
import { BottomTabBar } from "expo-router/tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/runtime/appContext";
import { useInbox } from "../../src/runtime/notifications";
import { canOpen, homeHref, moduleTabs, tabBar, tabLabels } from "../../src/shell/tabs";
import { TabIcon, type TabIconName } from "../../src/ui/TabIcon";
import { Text } from "../../src/ui/Text";
import { useColors } from "../../src/ui/theme";
import { fontFamily, size, space } from "../../src/theme";

/**
 * A tab with no button on the bar, still open to navigation. Not `href: null`: expo-router hides such a tab and, when it is opened, sends
 * the person to the first tab instead (More > Move landed on Prep on the moto g86). The item style takes away the empty slot the button leaves.
 */
const INBOX = "(inbox)";

const noButton = (hide: boolean) => (hide ? { tabBarButton: () => null, tabBarItemStyle: { display: "none" as const } } : {});

/** The bar's one active style: the open tab's icon in copper on a sunk-paper pill; the others are quiet grey line icons. */
function BarIcon({ name, color, focused }: { name: TabIconName; color: ColorValue; focused: boolean }) {
  const c = useColors();
  return (
    <View style={{ width: size.tabPill, height: size.tabIcon + 6, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: focused ? c.field : "transparent" }}>
      <TabIcon name={name} color={color} size={size.tabIcon} />
    </View>
  );
}

/** A short label under the icon (beside it on a tablet). Scales with the phone's text size up to 1.3x, so the longest one ("Receive") still fits a fifth of a phone. */
function BarLabel({ color, children, position }: { color: ColorValue; children: string; position: "beside-icon" | "below-icon" }) {
  return (
    <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ color, fontFamily: fontFamily.uiStrong, fontSize: 12, lineHeight: 16, letterSpacing: 0.2, ...(position === "beside-icon" ? { marginStart: space.sm } : { marginTop: 2 }) }}>
      {children}
    </Text>
  );
}

/**
 * The signed-in app: one tab per module the person's permissions open, then Account; at most five buttons, so a person with more
 * modules gets four and More (the rest and Account). Each module is a route group next to this file.
 */
export default function AppTabs() {
  const { state } = useSession();
  const c = useColors();
  // The system navigation bar (three buttons or the gesture handle) sits over the bottom of the window: the bar's own height starts above it.
  const insets = useSafeAreaInsets();
  const { unread } = useInbox();
  const pathname = usePathname();
  const segments = useSegments();
  // True once the tabs have been drawn: only the first landing is sent home, never a tab the person opens later.
  const landed = useRef(false);
  if (state.phase !== "ready") return null;
  const { user } = state;
  // Sign-in and a cold start both land on "/", which every module's list answers to (expo-router opens the group that sorts first, Ask).
  // Replaced before the tabs exist, so Ask is not left behind in the Back history.
  const home = homeHref(user);
  if (!landed.current && pathname === "/" && !segments.some((s) => `/${s}` === home)) return <Redirect href={home} />;
  landed.current = true;
  const { more } = tabBar(user);
  const overflow = more.length > 0;
  // iOS only: on Android the library sets no label, and a button is read by its title.
  const labels = Platform.OS === "ios" ? tabLabels(user) : {};
  const underMore = overflow ? [...more.map((t) => t.route), "account"] : [];
  // The unread count on the Inbox button, or on More when the Inbox is listed under it.
  const badge = unread > 0 ? (unread > 99 ? "99+" : unread) : undefined;
  const inboxUnderMore = more.some((t) => t.route === INBOX);

  return (
    <Tabs
      // Back retraces the step: from a screen opened under More to the More list, from More to the tab the person was on.
      backBehavior="history"
      // A screen under More has no button of its own to light up: the bar is told More is the open tab, so More is highlighted.
      tabBar={(props) => {
        const { routes, index } = props.state;
        const shown = underMore.includes(routes[index].name) ? routes.findIndex((r) => r.name === "more") : index;
        return <BottomTabBar {...props} state={{ ...props.state, index: shown }} />;
      }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accentText,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, height: size.tabBar + insets.bottom, paddingTop: space.xs, paddingBottom: space.xs + insets.bottom },
        tabBarIconStyle: { width: size.tabPill, height: size.tabIcon + 6 },
        tabBarLabel: BarLabel,
      }}
    >
      {moduleTabs.map((tab) => (
        // A tab the person cannot open is not in the navigator at all, so a link or a back press cannot reach it. One under More has no button.
        <Tabs.Protected key={tab.route} guard={canOpen(user, tab)}>
          <Tabs.Screen name={tab.route} options={{ title: tab.title, tabBarAccessibilityLabel: labels[tab.title], tabBarBadge: tab.route === INBOX ? badge : undefined, ...noButton(more.includes(tab)), tabBarIcon: ({ color, focused }) => <BarIcon name={tab.icon} color={color} focused={focused} /> }} />
        </Tabs.Protected>
      ))}
      <Tabs.Screen name="account" options={{ title: "Account", tabBarAccessibilityLabel: labels.Account, ...noButton(overflow), tabBarIcon: ({ color, focused }) => <BarIcon name="account" color={color} focused={focused} /> }} />
      <Tabs.Screen
        name="more"
        options={{ title: "More", tabBarAccessibilityLabel: labels.More, tabBarBadge: inboxUnderMore ? badge : undefined, ...noButton(!overflow), tabBarIcon: ({ color, focused }) => <BarIcon name="more" color={color} focused={focused} /> }}
        // The bar ignores a press on the tab it thinks is open, which More is while a screen under it shows: open the list here instead.
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate("more");
          },
        })}
      />
    </Tabs>
  );
}

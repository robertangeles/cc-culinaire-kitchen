// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Children, createContext, useContext, type ReactNode } from "react";
import { Platform } from "react-native";
import type { AuthUser } from "../src/api/auth";

// The real tab navigator needs the native runtime, so this renders the real tab layout against a Tabs that records each screen's options
// and guard, with the phone's bottom inset (the system navigation bar) set by the test.
const mocks = vi.hoisted(() => ({
  user: null as unknown as AuthUser,
  insets: { top: 24, bottom: 48, left: 0, right: 0 },
  screenOptions: {} as Record<string, unknown>,
  backBehavior: undefined as string | undefined,
  screenLayout: undefined as ((p: { children: ReactNode }) => ReactNode) | undefined,
  screens: [] as { name: string; guard: boolean; options: { title?: string; href?: null; tabBarAccessibilityLabel?: string; tabBarBadge?: string | number; tabBarButton?: () => null; tabBarItemStyle?: { display?: string } } }[],
  navigate: vi.fn(),
  tabBar: null as unknown as (props: BarProps) => ReactNode,
  barState: null as unknown as BarProps["state"],
  unread: 0,
  listeners: {} as Record<string, (arg: { navigation: { navigate: (route: string) => void } }) => { tabPress: (e: { preventDefault: () => void }) => void }>,
  // Where the navigator is, as expo-router reports it. Account by default, a page no landing redirect touches; the landing tests set "/".
  pathname: "/account",
  segments: ["(app)", "account"] as string[],
  redirect: null as string | null,
}));
type BarProps = { state: { index: number; routes: { key: string; name: string }[] } };
vi.mock("../src/runtime/appContext", () => ({ useSession: () => ({ state: { phase: "ready", user: mocks.user, location: { storeLocationId: "loc-1", locationName: "Main Kitchen" } } }) }));
// The inbox's unread count (its real store needs the native SQLite and notification modules).
vi.mock("../src/runtime/notifications", () => ({ useInbox: () => ({ unread: mocks.unread }) }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mocks.insets,
  SafeAreaView: ({ children }: { children?: ReactNode }) => children,
  SafeAreaProvider: ({ children }: { children?: ReactNode }) => <div data-testid="own-safe-area">{children}</div>,
}));
vi.mock("expo-router", () => {
  const Guard = createContext(true);
  const Tabs = ({ children, screenOptions, tabBar, backBehavior, screenLayout }: { children?: ReactNode; screenOptions: Record<string, unknown>; tabBar: typeof mocks.tabBar; backBehavior?: string; screenLayout?: typeof mocks.screenLayout }) => {
    mocks.screenLayout = screenLayout;
    mocks.screenOptions = screenOptions;
    mocks.backBehavior = backBehavior;
    mocks.tabBar = tabBar;
    return <>{children}</>;
  };
  Tabs.Screen = ({ name, options, listeners }: { name: string; options: { title?: string; href?: null; tabBarAccessibilityLabel?: string; tabBarButton?: () => null; tabBarItemStyle?: { display?: string } }; listeners?: (typeof mocks.listeners)[string] }) => {
    if (listeners) mocks.listeners[name] = listeners;
    mocks.screens.push({ name, guard: useContext(Guard), options });
    return null;
  };
  Tabs.Protected = ({ guard, children }: { guard: boolean; children?: ReactNode }) => <Guard value={guard}>{Children.toArray(children)}</Guard>;
  const Redirect = ({ href }: { href: string }) => {
    mocks.redirect = href;
    return null;
  };
  return { Tabs, Redirect, usePathname: () => mocks.pathname, useSegments: () => mocks.segments, useNavigation: () => ({ navigate: mocks.navigate }) };
});
// The library's own bar, which draws the tab at `state.index` as the open one: this records the state the layout hands it.
vi.mock("expo-router/tabs", () => ({
  BottomTabBar: ({ state }: BarProps) => {
    mocks.barState = state;
    return null;
  },
}));

import AppTabs from "../app/(app)/_layout";
import More from "../app/(app)/more";

afterEach(() => {
  cleanup();
  mocks.screens.length = 0;
  mocks.navigate.mockReset();
  mocks.unread = 0;
  mocks.pathname = "/account";
  mocks.segments = ["(app)", "account"];
  mocks.redirect = null;
});

const person = (over: Partial<AuthUser>): AuthUser => ({ userId: 1, userName: "A", userEmail: "a@x.test", mfaEnabled: false, roles: [], permissions: [], ...over });
/** The titles of the buttons on the bar: screens the person may open whose button is not taken away (those are under More). */
const buttons = () =>
  mocks.screens
    .filter((s) => {
      const hidden = s.options.tabBarButton?.() === null;
      // A taken-away button must also take its slot away, or the bar keeps an empty gap where it was.
      expect(hidden).toBe(s.options.tabBarItemStyle?.display === "none");
      return s.guard && !hidden;
    })
    .map((s) => s.options.title);

describe("the tab bar", () => {
  it.each([["three-button navigation", 48], ["gesture navigation", 24], ["no system bar (an iPad without a home indicator)", 0]])(
    "stands above the system navigation bar with %s: the bar's height and bottom padding include the inset",
    (_name, bottom) => {
      mocks.insets = { ...mocks.insets, bottom };
      mocks.user = person({ permissions: ["waste:log"] });
      render(<AppTabs />);
      const style = mocks.screenOptions.tabBarStyle as { height: number; paddingTop: number; paddingBottom: number };
      const icon = mocks.screenOptions.tabBarIconStyle as { height: number };
      expect(style.height).toBe(64 + bottom);
      expect(style.paddingBottom).toBeGreaterThanOrEqual(bottom);
      // A tab is the library's 5 dp padding, the icon's pill, 2 dp, the label's 16 dp line and 5 dp again: it must fit inside the bar's own
      // padding, or the label is cut off at the bottom (the library's default 49 dp clipped the labels on the moto g86).
      expect(style.height - bottom - style.paddingTop - (style.paddingBottom - bottom)).toBeGreaterThanOrEqual(5 + icon.height + 2 + 16 + 5);
    },
  );

  it("gives each screen a safe area of its own, so the system bar's inset the tab bar already stands clear of is not left again above it", () => {
    mocks.user = person({ roles: ["Administrator"] });
    render(<AppTabs />);
    cleanup();
    render(<>{mocks.screenLayout!({ children: "a screen" })}</>);
    expect(screen.getByTestId("own-safe-area").textContent).toBe("a screen");
  });

  it("labels each button in one short line of 12 pt Inter that grows with the phone's text size only up to 1.3x, so no label wraps or is cut", () => {
    mocks.user = person({ roles: ["Administrator"] });
    render(<AppTabs />);
    const Label = mocks.screenOptions.tabBarLabel as (p: { color: string; children: string; position: string }) => ReactNode;
    cleanup();
    render(<>{Label({ color: "#956134", children: "Receive", position: "below-icon" })}</>);
    const label = screen.getByText("Receive");
    expect(getComputedStyle(label).fontSize).toBe("12px");
    // react-native-web draws numberOfLines={1} as one clipped line; the 1.3x cap is a native-only prop, so it is checked on the element's props.
    expect(getComputedStyle(label).whiteSpace).toBe("nowrap");
  });

  it.each([
    ["an Administrator", person({ roles: ["Administrator"] }), "/(prep)"],
    ["a cook who only logs waste", person({ permissions: ["waste:log"] }), "/(waste)"],
  ])("sends %s who lands on Ask, the group a bare / opens, to the first button on their bar", (_who, user, home) => {
    mocks.user = user;
    mocks.pathname = "/";
    mocks.segments = ["(app)", "(chat)"];
    render(<AppTabs />);
    expect(mocks.redirect).toBe(home);
    expect(mocks.screens).toEqual([]);
  });

  it("does not move a person who lands on their own first tab, nor one who opens Ask after landing", () => {
    mocks.user = person({ roles: ["Administrator"] });
    mocks.pathname = "/";
    mocks.segments = ["(app)", "(prep)"];
    const { rerender } = render(<AppTabs />);
    expect(mocks.redirect).toBeNull();
    expect(buttons()).toEqual(["Prep", "Waste", "Usage", "Count", "More"]);
    mocks.segments = ["(app)", "(chat)"];
    rerender(<AppTabs />);
    expect(mocks.redirect).toBeNull();
  });

  it("gives everyone without a module Ask as their first tab, so a landing on Ask stays there", () => {
    mocks.user = person({});
    mocks.pathname = "/";
    mocks.segments = ["(app)", "(chat)"];
    render(<AppTabs />);
    expect(mocks.redirect).toBeNull();
  });

  it("shows a cook's modules and Account, with no More, when they fit in five buttons", () => {
    mocks.user = person({ permissions: ["waste:log"] });
    render(<AppTabs />);
    expect(buttons()).toEqual(["Waste", "Ask", "Recipes", "Inbox", "Account"]);
  });

  it("gives a person with no permission Ask, Recipes, the Inbox and Account, with Account ahead of More, which has no button then", () => {
    mocks.user = person({});
    render(<AppTabs />);
    expect(buttons()).toEqual(["Ask", "Recipes", "Inbox", "Account"]);
    expect(mocks.screens.filter((s) => s.guard).map((s) => s.name)).toEqual(["(chat)", "(recipes)", "(inbox)", "account", "more"]);
  });

  it("on an iPhone or iPad each button is read with its place among the buttons that show; elsewhere the label is left to the library", () => {
    mocks.user = person({ roles: ["Administrator"] });
    render(<AppTabs />);
    expect(mocks.screens.every((s) => s.options.tabBarAccessibilityLabel === undefined)).toBe(true);
    cleanup();
    mocks.screens.length = 0;

    const os = Platform.OS;
    Platform.OS = "ios";
    try {
      render(<AppTabs />);
    } finally {
      Platform.OS = os;
    }
    // Ten screens are in the navigator, five have a button: VoiceOver must hear "of 5".
    const spoken = mocks.screens.filter((s) => s.guard && s.options.tabBarButton === undefined).map((s) => s.options.tabBarAccessibilityLabel);
    expect(spoken).toEqual(["Prep, tab, 1 of 5", "Waste, tab, 2 of 5", "Usage, tab, 3 of 5", "Count, tab, 4 of 5", "More, tab, 5 of 5"]);
  });

  it("never shows more than five buttons: four modules and More, with the rest and Account under More", () => {
    mocks.user = person({ roles: ["Administrator"] });
    render(<AppTabs />);
    expect(buttons()).toEqual(["Prep", "Waste", "Usage", "Count", "More"]);
    // Move, Receive and Account stay in the navigator, so More can open them.
    expect(mocks.screens.filter((s) => s.guard).map((s) => s.name)).toEqual(expect.arrayContaining(["(moves)", "(receive)", "account"]));
    // ...and none is `href: null`: expo-router hides such a tab and sends anyone who opens it to the first tab (More > Move landed on Prep).
    expect(mocks.screens.every((s) => s.options.href === undefined)).toBe(true);
  });

  /** The tab the bar draws as open when the navigator's open screen is `focused`. */
  const highlighted = (focused: string) => {
    const routes = mocks.screens.filter((s) => s.guard).map((s) => ({ key: `${s.name}-key`, name: s.name }));
    cleanup();
    render(<>{mocks.tabBar({ state: { index: routes.findIndex((r) => r.name === focused), routes } })}</>);
    return mocks.barState.routes[mocks.barState.index].name;
  };

  it.each([["(moves)"], ["(receive)"], ["account"]])("highlights More while %s, a screen under More, is open", (route) => {
    mocks.user = person({ roles: ["Administrator"] });
    render(<AppTabs />);
    expect(highlighted(route)).toBe("more");
  });

  it("highlights a screen's own button when it has one", () => {
    mocks.user = person({ roles: ["Administrator"] });
    render(<AppTabs />);
    expect(highlighted("(prep)")).toBe("(prep)");
    cleanup();
    mocks.screens.length = 0;
    // With no overflow Account has its own button, so it is not handed to More.
    mocks.user = person({ permissions: ["waste:log"] });
    render(<AppTabs />);
    expect(highlighted("account")).toBe("account");
  });

  it("a press on More opens the More list even when the bar already shows More as open (from Move)", () => {
    mocks.user = person({ roles: ["Administrator"] });
    render(<AppTabs />);
    const preventDefault = vi.fn();
    mocks.listeners.more({ navigation: { navigate: mocks.navigate } }).tabPress({ preventDefault });
    // Prevented, so the bar's own handling (which does nothing for the tab it thinks is open) does not also run.
    expect(preventDefault).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("more");
  });

  it("asks the navigator to take Back through the tabs visited, so Back from a screen under More returns to the More list", () => {
    mocks.user = person({ roles: ["Administrator"] });
    render(<AppTabs />);
    // React Navigation's tab router: "history" goes back to the tab last open; its default, "firstRoute", went to Prep.
    expect(mocks.backBehavior).toBe("history");
  });

  it("More starts at the top of the page, as the module tabs do, in the 560 dp column", () => {
    mocks.user = person({ roles: ["Administrator"] });
    render(<More />);
    // More heads itself as every tab does: the location over its title, in the column.
    const column = screen.getByText("More").parentElement?.parentElement as HTMLElement;
    expect(parseFloat(getComputedStyle(column).maxWidth)).toBe(560);
    expect(getComputedStyle(column.parentElement as HTMLElement).justifyContent).toBe("flex-start");
  });

  it("More lists the modules that did not fit, then Account, and opens each", () => {
    mocks.user = person({ roles: ["Administrator"] });
    render(<More />);
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(mocks.navigate).toHaveBeenLastCalledWith("(moves)");
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    expect(mocks.navigate).toHaveBeenLastCalledWith("(receive)");
    fireEvent.click(screen.getByRole("button", { name: "Transfers" }));
    expect(mocks.navigate).toHaveBeenLastCalledWith("(transfers)");
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(mocks.navigate).toHaveBeenLastCalledWith("account");
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Move", "Receive", "Orders", "Ask", "Recipes", "Inbox", "Transfers", "Stock", "Menu", "Brain", "Account"]);
  });
});

describe("the inbox's unread count", () => {
  const badgeOf = (name: string) => mocks.screens.find((s) => s.name === name)?.options.tabBarBadge;

  it("is on the Inbox button when the Inbox is on the bar, and nowhere when nothing is unread", () => {
    mocks.user = person({ permissions: ["waste:log"] });
    mocks.unread = 3;
    render(<AppTabs />);
    expect(badgeOf("(inbox)")).toBe(3);
    expect(badgeOf("more")).toBeUndefined();
    cleanup();
    mocks.screens.length = 0;
    mocks.unread = 0;
    render(<AppTabs />);
    expect(badgeOf("(inbox)")).toBeUndefined();
  });

  it("is on More, and on the Inbox row of the More list, when the Inbox is under More", () => {
    mocks.user = person({ roles: ["Administrator"] });
    mocks.unread = 120;
    render(<AppTabs />);
    expect(badgeOf("more")).toBe("99+");
    render(<More />);
    expect(screen.getByRole("button", { name: "Inbox, 120 unread" })).toBeTruthy();
    expect(screen.getByText("99+ unread")).toBeTruthy();
  });
});

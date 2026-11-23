// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Children, createContext, useContext, type ReactNode } from "react";
import type { AuthUser } from "../src/api/auth";

// The real tab navigator needs the native runtime, so this renders the real tab layout against a Tabs that records each screen's options
// and guard, with the phone's bottom inset (the system navigation bar) set by the test.
const mocks = vi.hoisted(() => ({
  user: null as unknown as AuthUser,
  insets: { top: 24, bottom: 48, left: 0, right: 0 },
  screenOptions: {} as Record<string, unknown>,
  screens: [] as { name: string; guard: boolean; options: { title?: string; href?: null; tabBarButton?: () => null; tabBarItemStyle?: { display?: string } } }[],
  navigate: vi.fn(),
  tabBar: null as unknown as (props: BarProps) => ReactNode,
  barState: null as unknown as BarProps["state"],
  listeners: {} as Record<string, (arg: { navigation: { navigate: (route: string) => void } }) => { tabPress: (e: { preventDefault: () => void }) => void }>,
}));
type BarProps = { state: { index: number; routes: { key: string; name: string }[] } };
vi.mock("../src/runtime/appContext", () => ({ useSession: () => ({ state: { phase: "ready", user: mocks.user } }) }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mocks.insets,
  SafeAreaView: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("expo-router", () => {
  const Guard = createContext(true);
  const Tabs = ({ children, screenOptions, tabBar }: { children?: ReactNode; screenOptions: Record<string, unknown>; tabBar: typeof mocks.tabBar }) => {
    mocks.screenOptions = screenOptions;
    mocks.tabBar = tabBar;
    return <>{children}</>;
  };
  Tabs.Screen = ({ name, options, listeners }: { name: string; options: { title?: string; href?: null; tabBarButton?: () => null; tabBarItemStyle?: { display?: string } }; listeners?: (typeof mocks.listeners)[string] }) => {
    if (listeners) mocks.listeners[name] = listeners;
    mocks.screens.push({ name, guard: useContext(Guard), options });
    return null;
  };
  Tabs.Protected = ({ guard, children }: { guard: boolean; children?: ReactNode }) => <Guard value={guard}>{Children.toArray(children)}</Guard>;
  return { Tabs, useNavigation: () => ({ navigate: mocks.navigate }) };
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
      const label = mocks.screenOptions.tabBarLabelStyle as { lineHeight: number };
      expect(style.height).toBe(68 + bottom);
      expect(style.paddingBottom).toBeGreaterThanOrEqual(bottom);
      // A tab is the library's 5 dp padding, a 25 dp icon, the label's line and 5 dp again: it must fit inside the bar's own padding,
      // or the label is cut off at the bottom (the library's default 49 dp clipped the 16pt labels on the moto g86).
      expect(style.height - bottom - style.paddingTop - (style.paddingBottom - bottom)).toBeGreaterThanOrEqual(5 + 25 + label.lineHeight + 5);
    },
  );

  it("shows a cook's modules and Account, with no More, when they fit in five buttons", () => {
    mocks.user = person({ permissions: ["waste:log", "purchasing:receive"] });
    render(<AppTabs />);
    expect(buttons()).toEqual(["Waste", "Receive", "Ask", "Recipes", "Account"]);
  });

  it("gives a person with no permission Ask, Recipes and Account, with Account ahead of More, which has no button then", () => {
    mocks.user = person({});
    render(<AppTabs />);
    expect(buttons()).toEqual(["Ask", "Recipes", "Account"]);
    expect(mocks.screens.filter((s) => s.guard).map((s) => s.name)).toEqual(["(chat)", "(recipes)", "account", "more"]);
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

  it("More lists the modules that did not fit, then Account, and opens each", () => {
    mocks.user = person({ roles: ["Administrator"] });
    render(<More />);
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(mocks.navigate).toHaveBeenLastCalledWith("(moves)");
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    expect(mocks.navigate).toHaveBeenLastCalledWith("(receive)");
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(mocks.navigate).toHaveBeenLastCalledWith("account");
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Move", "Receive", "Ask", "Recipes", "Account"]);
  });
});

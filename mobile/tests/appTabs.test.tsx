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
}));
vi.mock("../src/runtime/appContext", () => ({ useSession: () => ({ state: { phase: "ready", user: mocks.user } }) }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mocks.insets,
  SafeAreaView: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("expo-router", () => {
  const Guard = createContext(true);
  const Tabs = ({ children, screenOptions }: { children?: ReactNode; screenOptions: Record<string, unknown> }) => {
    mocks.screenOptions = screenOptions;
    return <>{children}</>;
  };
  Tabs.Screen = ({ name, options }: { name: string; options: { title?: string; href?: null; tabBarButton?: () => null; tabBarItemStyle?: { display?: string } } }) => {
    mocks.screens.push({ name, guard: useContext(Guard), options });
    return null;
  };
  Tabs.Protected = ({ guard, children }: { guard: boolean; children?: ReactNode }) => <Guard value={guard}>{Children.toArray(children)}</Guard>;
  return { Tabs, useNavigation: () => ({ navigate: mocks.navigate }) };
});

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
    mocks.user = person({ permissions: ["inventory:count", "waste:log"] });
    render(<AppTabs />);
    expect(buttons()).toEqual(["Waste", "Usage", "Count", "Move", "Account"]);
  });

  it("never shows more than five buttons: four modules and More, with the rest and Account under More", () => {
    mocks.user = person({ roles: ["Administrator"] });
    render(<AppTabs />);
    expect(buttons()).toEqual(["Prep", "Waste", "Usage", "Count", "More"]);
    // Move and Account stay in the navigator, so More can open them.
    expect(mocks.screens.filter((s) => s.guard).map((s) => s.name)).toEqual(expect.arrayContaining(["(moves)", "account"]));
    // ...and none is `href: null`: expo-router hides such a tab and sends anyone who opens it to the first tab (More > Move landed on Prep).
    expect(mocks.screens.every((s) => s.options.href === undefined)).toBe(true);
  });

  it("More lists the modules that did not fit, then Account, and opens each", () => {
    mocks.user = person({ roles: ["Administrator"] });
    render(<More />);
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(mocks.navigate).toHaveBeenLastCalledWith("(moves)");
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(mocks.navigate).toHaveBeenLastCalledWith("account");
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Move", "Account"]);
  });
});

import { afterEach, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { configure } from "@testing-library/react";
import { reduceMotion as reduceMotionState, screenFocus as screenFocusState } from "./testing/mocks";

// `findBy*` and `waitFor` give up after 1 s by default, but one `getByRole` search in jsdom costs 200-300 ms here (most of it
// jsdom's getComputedStyle; the receiving delivery screen after a line is saved) and about five times that on the loaded CI runner.
// Each search blocks the thread, so the polls use up the wait and two receiving tests timed out at 1 s. A re-render itself takes 4-25 ms.
// The test timeout in vitest.config.ts was raised for the same reason; this is its per-wait twin.
configure({ asyncUtilTimeout: 10_000 });

// Screen tests render the real screens with react-native-web in jsdom. Only native-only modules are faked here.
vi.mock("expo-haptics", () => ({ impactAsync: vi.fn(), ImpactFeedbackStyle: { Light: "light" } }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn().mockResolvedValue(true) }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "0.0.0-test" } } }));
vi.mock("expo-status-bar", () => ({ StatusBar: () => null }));
vi.mock("expo-linear-gradient", async () => {
  const { View } = await import("react-native");
  return { LinearGradient: ({ children, style }: { children?: ReactNode; style?: object }) => createElement(View, { style }, children) };
});
vi.mock("react-native-safe-area-context", async () => {
  const { View } = await import("react-native");
  return {
    SafeAreaView: ({ children, style }: { children?: ReactNode; style?: object }) => createElement(View, { style }, children),
    SafeAreaProvider: ({ children }: { children?: ReactNode }) => children,
  };
});
vi.mock("react-native-svg", async () => {
  const { View } = await import("react-native");
  return { default: ({ children, style }: { children?: ReactNode; style?: object }) => createElement(View, { style }, children), Path: () => null };
});
vi.mock("expo-router", async () => {
  const { routerMock, searchParams, focusEffects, screenFocus } = await import("./testing/mocks");
  const { useEffect } = await import("react");
  // As the real hook: the effect runs when the screen is shown, and again each time it regains focus.
  const useFocusEffect = (effect: () => void) =>
    useEffect(() => {
      if (screenFocus.current) effect();
      focusEffects.add(effect);
      return () => void focusEffects.delete(effect);
    }, [effect]);
  return { useRouter: () => routerMock, useLocalSearchParams: () => searchParams.current, useFocusEffect };
});

if (typeof window !== "undefined") {
  // jsdom has no matchMedia; react-native-web reads the reduce-motion setting through it.
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes("prefers-reduced-motion") ? reduceMotionState.current : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

afterEach(async () => {
  reduceMotionState.current = false;
  screenFocusState.current = true;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  vi.clearAllMocks();
});

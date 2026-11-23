import { afterEach, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { reduceMotion as reduceMotionState } from "./testing/mocks";

// Screen tests render the real screens with react-native-web in jsdom. Only native-only modules are faked here.
vi.mock("expo-haptics", () => ({ impactAsync: vi.fn(), ImpactFeedbackStyle: { Light: "light" } }));
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
  const { routerMock, searchParams, focusEffects } = await import("./testing/mocks");
  const { useEffect } = await import("react");
  // As the real hook: the effect runs when the screen is shown, and again each time it regains focus.
  const useFocusEffect = (effect: () => void) =>
    useEffect(() => {
      effect();
      focusEffects.add(effect);
      return () => void focusEffects.delete(effect);
    }, [effect]);
  return { useRouter: () => routerMock, useLocalSearchParams: () => searchParams.current, useFocusEffect };
});

if (typeof window !== "undefined") {
  // findBy and waitFor give up after 1 s by default; on a loaded CI runner one role query alone can take longer than that.
  const { configure } = await import("@testing-library/react");
  configure({ asyncUtilTimeout: 10_000 });
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
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  vi.clearAllMocks();
});

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
  const { routerMock, searchParams } = await import("./testing/mocks");
  return { useRouter: () => routerMock, useLocalSearchParams: () => searchParams.current };
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
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  vi.clearAllMocks();
});

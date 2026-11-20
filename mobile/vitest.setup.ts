import { afterEach, vi } from "vitest";
import { createElement, type ReactNode } from "react";

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
vi.mock("expo-router", async () => {
  const { routerMock, searchParams } = await import("./testing/mocks");
  return { useRouter: () => routerMock, useLocalSearchParams: () => searchParams.current };
});

afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  vi.clearAllMocks();
});

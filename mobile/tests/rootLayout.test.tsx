// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Children, createContext, useContext, type ReactNode } from "react";

// A fresh launch with no session once landed on legal.tsx ("Not found") instead of Sign in: expo-router sends a guarded screen to the first
// unguarded file unless the guard says where to go. The real router needs the native runtime, so this renders the real root layout against a
// Stack that records each guard: in every phase, every guarded group must redirect to a screen that is open in that phase.
const mocks = vi.hoisted(() => ({
  phase: { current: "signedOut" },
  groups: [] as { guard: boolean; redirectTo?: string; screens: string[] }[],
}));
vi.mock("../src/runtime/appContext", () => ({ session: { restore: vi.fn() }, useSession: () => ({ state: { phase: mocks.phase.current } }) }));
vi.mock("../src/runtime/appOutbox", () => ({ startOutbox: vi.fn() }));
vi.mock("expo-splash-screen", () => ({ preventAutoHideAsync: async () => {}, hideAsync: async () => {} }));
vi.mock("expo-status-bar", () => ({ StatusBar: () => null }));
vi.mock("@expo-google-fonts/fraunces", () => ({ useFonts: () => [true], Fraunces_400Regular: 1, Fraunces_600SemiBold: 1 }));
vi.mock("@expo-google-fonts/inter", () => ({ Inter_400Regular: 1, Inter_600SemiBold: 1 }));
vi.mock("expo-router", () => {
  const Group = createContext<{ screens: string[] } | null>(null);
  const Stack = ({ children }: { children?: ReactNode }) => children;
  Stack.Screen = ({ name }: { name: string }) => {
    useContext(Group)?.screens.push(name);
    return null;
  };
  Stack.Protected = ({ guard, redirectTo, children }: { guard: boolean; redirectTo?: string; children?: ReactNode }) => {
    const group = { guard, redirectTo, screens: [] as string[] };
    mocks.groups.push(group);
    return <Group value={group}>{Children.toArray(children)}</Group>;
  };
  return { Stack };
});

import RootLayout from "../app/_layout";

afterEach(() => {
  cleanup();
  mocks.groups.length = 0;
});

// The screen each phase must reach (the file under app/), and the path that file lives at.
const landing: [phase: string, screen: string, path: string][] = [
  ["signedOut", "sign-in", "/sign-in"],
  ["mfa", "mfa", "/mfa"],
  ["chooseLocation", "location", "/location"],
  ["firstRun", "first-run", "/first-run"],
  ["updateRequired", "update-required", "/update-required"],
  ["accountDeleted", "account-deleted", "/account-deleted"],
  ["ready", "(app)", "/"],
];

describe("root layout guards", () => {
  it.each(landing)("in the %s phase a guarded screen redirects to %s, the screen open in that phase", (phase, screen, path) => {
    mocks.phase.current = phase;
    render(<RootLayout />);
    const open = mocks.groups.filter((g) => g.guard).flatMap((g) => g.screens);
    expect(open).toContain(screen);
    const guarded = mocks.groups.filter((g) => !g.guard);
    expect(guarded.length).toBeGreaterThan(0);
    for (const g of guarded) expect(g.redirectTo).toBe(path);
  });
});

import { vi } from "vitest";

/** Shared fakes for the native-only modules, so screen tests can drive and inspect them. */
export const routerMock = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
export const searchParams: { current: Record<string, string> } = { current: {} };

/** The session as screens see it: tests set `sessionState.current` and inspect `sessionMock`. */
export const sessionMock = { signIn: vi.fn(), submitCode: vi.fn(), chooseLocation: vi.fn(), signOut: vi.fn() };
export const sessionState: { current: { state: unknown; busy: boolean } } = { current: { state: { phase: "signedOut" }, busy: false } };

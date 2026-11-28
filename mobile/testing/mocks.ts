import { vi } from "vitest";

/** Shared fakes for the native-only modules, so screen tests can drive and inspect them. */
export const routerMock = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), dismissTo: vi.fn() };
export const searchParams: { current: Record<string, string> } = { current: {} };
/** The mounted screens' focus effects. `returnToScreen()` runs them again, as coming back to a screen left mounted does. */
export const focusEffects = new Set<() => void>();
export const returnToScreen = () => focusEffects.forEach((run) => run());
/** Whether the mounted screens are in view. A test sets it false for a screen left mounted behind another tab. */
export const screenFocus = { current: true };

/** The session as screens see it: tests set `sessionState.current` and inspect `sessionMock`. */
export const sessionMock = { signIn: vi.fn(), signInWithGoogle: vi.fn(), signInWithApple: vi.fn(), submitCode: vi.fn(), chooseLocation: vi.fn(), changeLocation: vi.fn(), cancelChangeLocation: vi.fn(), signOut: vi.fn() };
export const sessionState: { current: { state: unknown; busy: boolean } } = { current: { state: { phase: "signedOut" }, busy: false } };

/** The account calls the registration, forgot-password and check-email screens make (they never call fetch). */
/** Whether this build has a Google web client ID, i.e. whether the Continue with Google button is offered. */
export const googleConfig = { enabled: false };

/** Whether this build offers Sign in with Apple, i.e. whether it runs on iPhone or iPad. */
export const appleConfig = { enabled: false };

export const authApiMock = { register: vi.fn(), forgotPassword: vi.fn(), resendVerification: vi.fn() };

/** The phone's "reduce motion" setting, as react-native-web reads it (jsdom has no matchMedia of its own). */
export const reduceMotion = { current: false };

/** The roster's and documents' saved copies, in memory and always readable (the lock and the sealing are `lockedCache.test.ts`'s). */
export function memoryCache(at = "2026-11-25T20:00:00.000Z") {
  const rows = new Map<string, unknown>();
  const read = async <T>(name: string, schema: { parse(data: unknown): T }) => (rows.has(name) ? { at, data: schema.parse(rows.get(name)) } : null);
  return {
    rows,
    owner: () => "1:L1",
    // A spy that keeps the generic signature the stores call.
    read: vi.fn(read) as unknown as typeof read,
    write: vi.fn(async (name: string, _owner: string | null, data: unknown) => void rows.set(name, data)),
    remove: vi.fn(async (name: string) => void rows.delete(name)),
  };
}

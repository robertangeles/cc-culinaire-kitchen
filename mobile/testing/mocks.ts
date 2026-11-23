import { vi } from "vitest";

/** Shared fakes for the native-only modules, so screen tests can drive and inspect them. */
export const routerMock = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
export const searchParams: { current: Record<string, string> } = { current: {} };
/** The mounted screens' focus effects. `returnToScreen()` runs them again, as coming back to a screen left mounted does. */
export const focusEffects = new Set<() => void>();
export const returnToScreen = () => focusEffects.forEach((run) => run());

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

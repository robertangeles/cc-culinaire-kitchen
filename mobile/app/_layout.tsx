import { useEffect, type ReactNode } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts, Fraunces_400Regular, Fraunces_600SemiBold } from "@expo-google-fonts/fraunces";
import { Inter_400Regular, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { appLockOff } from "../src/config";
import { LockProvider } from "../src/lock/LockProvider";
import { session, useSession } from "../src/runtime/appContext";
import { appLock } from "../src/runtime/appLock";
import { startLockedCache } from "../src/runtime/lockedCache";
import { startOutbox } from "../src/runtime/appOutbox";
import { startNotifications } from "../src/runtime/notifications";
import { clearPickedPhotos } from "../src/photos/photoFiles";

void SplashScreen.preventAutoHideAsync();

/** Where each phase lives. A guarded screen redirects here; without it expo-router picks the first unguarded file (legal.tsx), so a fresh launch landed on "Not found". */
const HOME = { restoring: "/", signedOut: "/sign-in", mfa: "/mfa", chooseLocation: "/location", firstRun: "/first-run", updateRequired: "/update-required", accountDeleted: "/account-deleted", ready: "/" } as const;

/** What is around every screen. Anyone signed in is behind the app lock, at the location choice and first run too (it is only on for the people it is for). */
function Shell({ children }: { children: ReactNode }) {
  const { state } = useSession();
  return (
    <SafeAreaProvider>
      {/* One status bar for every screen: dark icons on the light paper. */}
      <StatusBar style="dark" />
      <LockProvider lock={appLock} user={!appLockOff && "user" in state ? state.user : null} onSignOut={() => void session.signOut()}>
        {children}
      </LockProvider>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Fraunces_400Regular, Fraunces_600SemiBold, Inter_400Regular, Inter_600SemiBold });
  const { state } = useSession();

  useEffect(() => {
    startOutbox();
    startNotifications();
    startLockedCache();
    // A photo left behind when the app was closed partway through a form.
    clearPickedPhotos();
    void session.restore();
  }, []);

  const ready = fontsLoaded && state.phase !== "restoring";
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  // Each screen exists only in its phase, so the back button can never reach a screen from the wrong state.
  return (
    <Shell>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected redirectTo={HOME[state.phase]} guard={state.phase === "signedOut"}>
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="forgot-password" />
          <Stack.Screen name="check-email" />
        </Stack.Protected>
        <Stack.Protected redirectTo={HOME[state.phase]} guard={state.phase === "mfa"}>
          <Stack.Screen name="mfa" />
        </Stack.Protected>
        <Stack.Protected redirectTo={HOME[state.phase]} guard={state.phase === "chooseLocation"}>
          <Stack.Screen name="location" />
        </Stack.Protected>
        <Stack.Protected redirectTo={HOME[state.phase]} guard={state.phase === "firstRun"}>
          <Stack.Screen name="first-run" />
        </Stack.Protected>
        <Stack.Protected redirectTo={HOME[state.phase]} guard={state.phase === "updateRequired"}>
          <Stack.Screen name="update-required" />
        </Stack.Protected>
        <Stack.Protected redirectTo={HOME[state.phase]} guard={state.phase === "accountDeleted"}>
          <Stack.Screen name="account-deleted" />
        </Stack.Protected>
        <Stack.Protected redirectTo={HOME[state.phase]} guard={state.phase === "ready"}>
          <Stack.Screen name="(app)" />
          <Stack.Screen name="link-apple" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="change-password" />
          <Stack.Screen name="two-step" />
          <Stack.Screen name="kitchen-profile" />
          <Stack.Screen name="notification-settings" />
        </Stack.Protected>
        {/* Reachable before a location is joined too: a person who cannot join must still be able to delete the account (App Store 5.1.1(v)). */}
        <Stack.Protected redirectTo={HOME[state.phase]} guard={state.phase === "ready" || state.phase === "firstRun"}>
          <Stack.Screen name="delete-account" />
        </Stack.Protected>
      </Stack>
    </Shell>
  );
}

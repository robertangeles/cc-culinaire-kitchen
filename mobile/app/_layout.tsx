import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts, Fraunces_400Regular, Fraunces_600SemiBold } from "@expo-google-fonts/fraunces";
import { Inter_400Regular, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { session, useSession } from "../src/runtime/appContext";
import { startOutbox } from "../src/runtime/appOutbox";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Fraunces_400Regular, Fraunces_600SemiBold, Inter_400Regular, Inter_600SemiBold });
  const { state } = useSession();

  useEffect(() => {
    startOutbox();
    void session.restore();
  }, []);

  const ready = fontsLoaded && state.phase !== "restoring";
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  // Each screen exists only in its phase, so the back button can never reach a screen from the wrong state.
  return (
    <SafeAreaProvider>
      {/* One status bar for every screen: dark icons on the light paper. */}
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={state.phase === "signedOut"}>
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="forgot-password" />
          <Stack.Screen name="check-email" />
        </Stack.Protected>
        <Stack.Protected guard={state.phase === "mfa"}>
          <Stack.Screen name="mfa" />
        </Stack.Protected>
        <Stack.Protected guard={state.phase === "chooseLocation"}>
          <Stack.Screen name="location" />
        </Stack.Protected>
        <Stack.Protected guard={state.phase === "firstRun"}>
          <Stack.Screen name="first-run" />
        </Stack.Protected>
        <Stack.Protected guard={state.phase === "updateRequired"}>
          <Stack.Screen name="update-required" />
        </Stack.Protected>
        <Stack.Protected guard={state.phase === "accountDeleted"}>
          <Stack.Screen name="account-deleted" />
        </Stack.Protected>
        <Stack.Protected guard={state.phase === "ready"}>
          <Stack.Screen name="(app)" />
          <Stack.Screen name="delete-account" />
          <Stack.Screen name="link-apple" />
        </Stack.Protected>
      </Stack>
    </SafeAreaProvider>
  );
}

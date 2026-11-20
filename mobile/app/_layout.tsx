import { useEffect } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useFonts, Fraunces_600SemiBold } from "@expo-google-fonts/fraunces";
import { Inter_400Regular, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { session, useSession } from "../src/app/appContext";
import { startOutbox } from "../src/app/appOutbox";
import { CountProvider } from "../src/app/countContext";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Fraunces_600SemiBold, Inter_400Regular, Inter_600SemiBold });
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
  const stack = (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={state.phase === "signedOut"}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Protected guard={state.phase === "mfa"}>
          <Stack.Screen name="mfa" />
        </Stack.Protected>
        <Stack.Protected guard={state.phase === "chooseLocation"}>
          <Stack.Screen name="location" />
        </Stack.Protected>
        <Stack.Protected guard={state.phase === "noAccess"}>
          <Stack.Screen name="no-access" />
        </Stack.Protected>
        <Stack.Protected guard={state.phase === "ready"}>
          <Stack.Screen name="index" />
          <Stack.Screen name="area/[name]" />
          <Stack.Screen name="attention" />
        </Stack.Protected>
      </Stack>
  );

  return (
    <SafeAreaProvider>
      {state.phase === "ready" ? <CountProvider locationId={state.location.storeLocationId}>{stack}</CountProvider> : stack}
    </SafeAreaProvider>
  );
}

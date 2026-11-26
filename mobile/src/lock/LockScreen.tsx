import { useEffect } from "react";
import { BackHandler, Keyboard } from "react-native";
import { Brand } from "../ui/Brand";
import { Button } from "../ui/Button";
import { Screen } from "../ui/Screen";
import { Text } from "../ui/Text";
import type { LockSnapshot } from "./appLock";

const PROBLEM = {
  lockout: "Too many tries. Wait a minute, then unlock with this device's passcode.",
  failed: "That didn't work. Try again.",
};

/** What a locked app shows: no name, no place, nothing of the kitchen. */
export function LockScreen({ problem, busy, onUnlock, onSignOut }: Pick<LockSnapshot, "problem" | "busy"> & { onUnlock: () => void; onSignOut: () => void }) {
  useEffect(() => {
    Keyboard.dismiss();
    // Android's Back would otherwise move the screens behind the lock.
    const back = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => back.remove();
  }, []);

  return (
    <Screen>
      <Brand size={140} />
      <Text variant="label">App lock</Text>
      {problem === "unprotected" ? (
        <>
          <Text variant="title">Set up a screen lock</Text>
          <Text>Your account can see rosters or certificates, so the app opens only on a device with a passcode, a fingerprint or a face set up. Turn one on in the device&apos;s settings, then tap Unlock. Or sign out.</Text>
        </>
      ) : (
        <>
          <Text variant="title">Locked</Text>
          <Text>Unlock with your face, your fingerprint or this device&apos;s passcode.</Text>
          {problem ? (
            <Text variant="error" accessibilityLiveRegion="polite">
              {PROBLEM[problem]}
            </Text>
          ) : null}
        </>
      )}
      <Button label="Unlock" disabled={busy} onPress={onUnlock} />
      <Button kind="quiet" label="Sign out" onPress={onSignOut} />
    </Screen>
  );
}

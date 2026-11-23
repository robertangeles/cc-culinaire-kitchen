import { StyleSheet, View, useColorScheme } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { radius, size } from "../theme";

/**
 * Apple's own "Continue with Apple" button (App Store review expects it, and it localises itself). It matches the
 * height and corner radius of the other buttons. It cannot be disabled, so while a sign-in runs it is dimmed and ignores taps.
 */
export function AppleButton({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  const dark = useColorScheme() === "dark";
  return (
    <View style={[styles.wrap, { opacity: busy ? 0.5 : 1 }]} pointerEvents={busy ? "none" : "auto"}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={radius.button}
        onPress={() => !busy && onPress()}
        style={styles.button}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { minHeight: size.primaryButton },
  button: { height: size.primaryButton, width: "100%" },
});

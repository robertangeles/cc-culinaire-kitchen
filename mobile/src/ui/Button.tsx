import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { fontFamily, fontSize, radius, size } from "../theme";
import { Text } from "./Text";
import { useColors } from "./theme";

interface Props {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** "primary" is the copper gradient; "ghost" is outlined paper; "quiet" is a text-only action. */
  kind?: "primary" | "ghost" | "quiet";
  /** A mark before the label (the Google "G"). */
  leading?: ReactNode;
}

export function Button({ label, onPress, disabled, kind = "primary", leading }: Props) {
  const c = useColors();
  if (kind === "ghost") {
    return (
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.ghost, { backgroundColor: c.surface, borderColor: c.border, opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
        {leading ? <View accessibilityElementsHidden>{leading}</View> : null}
        <Text style={{ color: c.text, fontFamily: fontFamily.uiStrong, fontSize: fontSize.body + 2 }}>{label}</Text>
      </Pressable>
    );
  }
  if (kind === "quiet") {
    return (
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={[styles.quiet, { opacity: disabled ? 0.5 : 1 }]}>
        <Text style={{ color: c.accentText, fontFamily: fontFamily.uiStrong }}>{label}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [{ opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
      <LinearGradient colors={[c.buttonFrom, c.buttonTo]} style={styles.primary}>
        <Text style={{ color: c.buttonText, fontFamily: fontFamily.uiStrong, fontSize: fontSize.body + 2 }}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: { minHeight: size.primaryButton, borderRadius: radius.button, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  ghost: { minHeight: size.primaryButton, borderRadius: radius.button, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 24 },
  quiet: { minHeight: size.tap, alignItems: "center", justifyContent: "center" },
});

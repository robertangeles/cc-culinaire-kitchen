import { Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { fontFamily, fontSize, radius, size } from "../theme";
import { Text } from "./Text";
import { useColors } from "./theme";

interface Props {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** "primary" is the copper gradient; "quiet" is a text-only action. */
  kind?: "primary" | "quiet";
}

export function Button({ label, onPress, disabled, kind = "primary" }: Props) {
  const c = useColors();
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
  quiet: { minHeight: size.tap, alignItems: "center", justifyContent: "center" },
});

import { useState, type ReactNode } from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { fontFamily, fontSize, radius, size, space } from "../theme";
import { Text } from "./Text";
import { useColors } from "./theme";

/**
 * A labelled field in the first app's style: small copper capitals over a sunk paper field whose border turns copper on focus,
 * with an optional control at the right (the SHOW toggle). At least 56dp tall. The label is also what a screen reader announces.
 */
export function TextField({ label, trailing, ...input }: TextInputProps & { label: string; trailing?: ReactNode }) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: c.accentText }]}>{label}</Text>
      <View style={[styles.row, { backgroundColor: c.field, borderColor: focused ? c.buttonFrom : c.border }]}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor="#A8A39A"
          {...input}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={[styles.input, { color: c.text }]}
        />
        {trailing}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  label: { fontFamily: fontFamily.uiStrong, fontSize: 12, letterSpacing: 1.8, textTransform: "uppercase" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: size.tap, borderWidth: 1, borderRadius: radius.banner, paddingHorizontal: space.lg },
  input: { flex: 1, minHeight: size.tap, fontFamily: fontFamily.ui, fontSize: fontSize.body, paddingVertical: 0 },
});

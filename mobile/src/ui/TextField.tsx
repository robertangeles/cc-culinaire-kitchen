import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { fontFamily, fontSize, radius, size, space } from "../theme";
import { Text } from "./Text";
import { useColors } from "./theme";

/** A labelled field at least 56dp tall. The label is visible and also what a screen reader announces. */
export function TextField({ label, ...input }: TextInputProps & { label: string }) {
  const c = useColors();
  return (
    <View style={styles.wrap}>
      <Text variant="muted">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.textMuted}
        {...input}
        style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  input: { minHeight: size.tap, borderWidth: 1, borderRadius: radius.banner, paddingHorizontal: space.lg, fontFamily: fontFamily.ui, fontSize: fontSize.body },
});

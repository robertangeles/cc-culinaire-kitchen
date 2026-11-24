import { Pressable, StyleSheet, View } from "react-native";
import { fontFamily, space } from "../theme";
import { Text } from "./Text";
import { useColors } from "./theme";

/**
 * A labelled row of choices that wraps (unit, reason, shift). The chosen one is solid ink, as in the two-way pill. With `clearable`
 * tapping the chosen one again clears it (an optional field); without it, one is always chosen.
 */
export function ChoiceChips<T extends string>({ label, options, value, onChange, clearable }: { label: string; options: readonly T[]; value: T | null; onChange: (next: T | null) => void; clearable?: boolean }) {
  const c = useColors();
  return (
    <View style={styles.wrap}>
      <Text variant="label">{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.row}>
        {options.map((o) => {
          const selected = o === value;
          return (
            <Pressable
              key={o}
              accessibilityRole="radio"
              accessibilityLabel={o}
              aria-checked={selected}
              hitSlop={4}
              onPress={() => onChange(selected && clearable ? null : o)}
              style={[styles.chip, { backgroundColor: selected ? c.text : c.field, borderColor: selected ? c.text : c.border }]}
            >
              <Text style={{ fontFamily: fontFamily.uiStrong, color: selected ? c.bg : c.text }}>{o}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { minHeight: 48, borderRadius: 999, borderWidth: 1, paddingHorizontal: space.lg, alignItems: "center", justifyContent: "center" },
});

import { Pressable, StyleSheet, View } from "react-native";
import { fontFamily, space } from "../theme";
import { Text } from "./Text";
import { SectionLabel } from "./SectionLabel";
import { useColors } from "./theme";

export interface Option {
  value: string;
  label: string;
}

/**
 * A labelled set of choices that wraps, where what is stored differs from what is shown (kitchen profile lists). `multiple` makes each a
 * tick box (up to `max`); without it one is chosen, and tapping it again clears it. The chosen ones are solid ink, as in `ChoiceChips`.
 */
export function OptionChips({ label, options, selected, onChange, multiple, max }: { label: string; options: readonly Option[]; selected: readonly string[]; onChange: (next: string[]) => void; multiple?: boolean; max?: number }) {
  const c = useColors();
  // An admin-managed list nobody has filled yet: no heading over nothing.
  if (options.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <SectionLabel>{max ? `${label} (up to ${max})` : label}</SectionLabel>
      <View accessibilityRole={multiple ? undefined : "radiogroup"} accessibilityLabel={label} style={styles.row}>
        {options.map((o) => {
          const on = selected.includes(o.value);
          const full = multiple && !on && max !== undefined && selected.length >= max;
          return (
            <Pressable
              key={o.value}
              accessibilityRole={multiple ? "checkbox" : "radio"}
              accessibilityLabel={o.label}
              aria-checked={on}
              disabled={full}
              hitSlop={4}
              onPress={() => onChange(multiple ? (on ? selected.filter((v) => v !== o.value) : [...selected, o.value]) : on ? [] : [o.value])}
              style={[styles.chip, { backgroundColor: on ? c.text : c.field, borderColor: on ? c.text : c.border, opacity: full ? 0.5 : 1 }]}
            >
              <Text style={{ fontFamily: fontFamily.uiStrong, color: on ? c.bg : c.text }}>{o.label}</Text>
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

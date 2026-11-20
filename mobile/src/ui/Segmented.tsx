import { Pressable, StyleSheet, View } from "react-native";
import { fontFamily, space } from "../theme";
import { Text } from "./Text";
import { useColors } from "./theme";

/** The first app's two-way pill (Sign in | Register): the chosen side is solid ink. Each side is a tab for a screen reader. */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (next: T) => void }) {
  const c = useColors();
  return (
    <View accessibilityRole="tablist" style={[styles.pill, { backgroundColor: c.field, borderColor: c.border }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityLabel={o.label} accessibilityState={{ selected }} onPress={() => onChange(o.value)} style={[styles.item, selected && { backgroundColor: c.text }]}>
            <Text style={{ fontFamily: fontFamily.uiStrong, fontSize: 14, color: selected ? c.bg : c.text }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignSelf: "center", borderWidth: 1, borderRadius: 999, padding: 3, gap: 2 },
  item: { minHeight: 44, paddingHorizontal: space.xl, borderRadius: 999, alignItems: "center", justifyContent: "center" },
});

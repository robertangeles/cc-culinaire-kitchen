import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { fontFamily, fontSize, space } from "../theme";
import { Text } from "./Text";
import { useColors } from "./theme";

/** The first app's grouped list: rows sit on one rounded sunk-paper surface, divided by hairlines. */
export function Surface({ children }: { children: ReactNode }) {
  const c = useColors();
  return <View style={[styles.surface, { backgroundColor: c.field, borderColor: c.border }]}>{children}</View>;
}

/** A row's divider style: a hairline above every row but the first. */
export function rowDivider(index: number, border: string) {
  return index === 0 ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border };
}

/** The first app's small pill (progress, status). Words, not colour alone. */
export function Chip({ label }: { label: string }) {
  const c = useColors();
  return (
    <View style={[styles.chip, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Text style={{ fontFamily: fontFamily.uiStrong, fontSize: fontSize.body, color: c.textMuted }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  chip: { borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, paddingVertical: space.xs },
});

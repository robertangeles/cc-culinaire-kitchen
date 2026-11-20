import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { fontFamily, fontSize, radius, size } from "../theme";
import { zeroKey, type Key } from "../count/keypad";
import { Text } from "./Text";
import { useColors } from "./theme";

interface Props {
  entry: string;
  onKey: (key: Key) => void;
}

const ROWS: Array<Array<{ key: Key | "zero-or-0"; label: string; hint?: string; a11y: string }>> = [
  [1, 2, 3].map((n) => ({ key: String(n) as Key, label: String(n), a11y: String(n) })),
  [4, 5, 6].map((n) => ({ key: String(n) as Key, label: String(n), a11y: String(n) })),
  [7, 8, 9].map((n) => ({ key: String(n) as Key, label: String(n), a11y: String(n) })),
  [
    { key: ".", label: ".", a11y: "Decimal point" },
    { key: "zero-or-0", label: "0", hint: "none here", a11y: "Zero, none here" },
    { key: "back", label: "⌫", a11y: "Delete" },
  ],
];

/** Three columns of 72dp keys with 8dp gaps. Each tap gives a light haptic. */
export function Keypad({ entry, onKey }: Props) {
  const c = useColors();
  return (
    <View accessibilityLabel="Number keypad" style={styles.pad}>
      {ROWS.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((k) => (
            <Pressable
              key={k.label}
              accessibilityRole="button"
              accessibilityLabel={k.a11y}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onKey(k.key === "zero-or-0" ? zeroKey(entry) : k.key);
              }}
              style={({ pressed }) => [styles.key, { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={{ fontFamily: fontFamily.uiStrong, fontSize: fontSize.item }}>{k.label}</Text>
              {k.hint ? <Text variant="meta" style={{ fontSize: fontSize.body }}>{k.hint}</Text> : null}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { gap: size.keyGap },
  row: { flexDirection: "row", gap: size.keyGap },
  key: { flex: 1, minHeight: size.key, borderRadius: radius.key, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});

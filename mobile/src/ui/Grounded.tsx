import { useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "./Text";
import { fontFamily, space } from "../theme";
import { useColors } from "./theme";

/** The web's "Grounded in your Brain" chip: the answer or recipe drew on the kitchen's own notes. Tap to see which. */
export function Grounded({ titles }: { titles: (string | null)[] }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Grounded in your Brain"
        onPress={() => setOpen(!open)}
        style={{ alignSelf: "flex-start", minHeight: 40, flexDirection: "row", alignItems: "center", gap: space.xs, borderRadius: 999, borderWidth: 1, borderColor: c.accentText, paddingHorizontal: space.md }}
      >
        <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText }}>{`Grounded in your Brain ${open ? "▴" : "▾"}`}</Text>
      </Pressable>
      {open ? titles.map((t, i) => <Text key={i} variant="meta">{`• ${t ?? "A note from your kitchen"}`}</Text>) : null}
    </View>
  );
}

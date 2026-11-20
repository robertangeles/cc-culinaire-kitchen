import { View } from "react-native";
import { radius, space } from "../theme";
import { Text } from "./Text";
import { useColors } from "./theme";

/** The one offline banner: saffron fill, ink text, words not colour alone. */
export function OfflineBanner({ text }: { text: string }) {
  const c = useColors();
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: c.warningFill, borderRadius: radius.banner, padding: space.md }}>
      <Text style={{ color: c.onWarning }}>{text}</Text>
    </View>
  );
}

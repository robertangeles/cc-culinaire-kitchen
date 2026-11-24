import { Image, View } from "react-native";
import { fontFamily } from "../theme";
import { Text } from "./Text";
import { useColors } from "./theme";

/** The profile picture in a circle, or the name's first letter on copper-edged paper when there is none. */
export function Avatar({ photoPath, name, size = 72 }: { photoPath?: string | null; name: string; size?: number }) {
  const c = useColors();
  const ring = { width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: c.buttonFrom, overflow: "hidden" as const };
  if (photoPath) return <Image accessibilityLabel="Profile picture" source={{ uri: photoPath }} style={ring} />;
  return (
    <View accessibilityLabel="No profile picture" style={[ring, { backgroundColor: c.field, alignItems: "center", justifyContent: "center" }]}>
      <Text style={{ fontFamily: fontFamily.title, fontSize: size * 0.42, color: c.accentText }}>{name.trim().charAt(0).toUpperCase() || "?"}</Text>
    </View>
  );
}

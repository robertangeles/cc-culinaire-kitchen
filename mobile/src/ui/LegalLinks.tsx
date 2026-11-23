import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { fontFamily, size, space } from "../theme";
import { Text } from "./Text";
import { useColors } from "./theme";

const links = [
  { slug: "terms", label: "Terms of Service" },
  { slug: "privacy", label: "Privacy Policy" },
] as const;

/** The two links every store listing and review asks for, on the sign-in and account screens. They open the pages the owner publishes. */
export function LegalLinks() {
  const router = useRouter();
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", justifyContent: "center", flexWrap: "wrap", columnGap: space.xl }}>
      {links.map((l) => (
        <Pressable key={l.slug} accessibilityRole="link" accessibilityLabel={l.label} onPress={() => router.push({ pathname: "/legal", params: { slug: l.slug } })} style={{ minHeight: size.tap, justifyContent: "center" }}>
          <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText }}>{l.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

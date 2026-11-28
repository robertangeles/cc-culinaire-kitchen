import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { contactEmail } from "../config";
import { fontFamily, size, space } from "../theme";
import { Button } from "./Button";
import { Text } from "./Text";
import { useColors } from "./theme";

const links = [
  { slug: "terms", label: "Terms of Service" },
  { slug: "privacy", label: "Privacy Policy" },
] as const;

/** The links every store listing and review asks for, on the sign-in and account screens: the two pages the owner publishes, and a way to write to the team. */
export function LegalLinks() {
  const router = useRouter();
  const c = useColors();
  const [noMailApp, setNoMailApp] = useState(false);
  const [copied, setCopied] = useState(false);
  const linkStyle = { minHeight: size.tap, justifyContent: "center" as const };
  return (
    <View style={{ alignItems: "center" }}>
      <View style={{ flexDirection: "row", justifyContent: "center", flexWrap: "wrap", columnGap: space.xl }}>
        {links.map((l) => (
          <Pressable key={l.slug} accessibilityRole="link" accessibilityLabel={l.label} onPress={() => router.push({ pathname: "/legal", params: { slug: l.slug } })} style={linkStyle}>
            <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText }}>{l.label}</Text>
          </Pressable>
        ))}
        <Pressable accessibilityRole="link" accessibilityLabel="Contact us" onPress={() => void Linking.openURL(`mailto:${contactEmail}`).catch(() => setNoMailApp(true))} style={linkStyle}>
          <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText }}>Contact us</Text>
        </Pressable>
      </View>
      {noMailApp ? (
        <View style={{ alignItems: "center" }}>
          <Text variant="muted">No mail app is set up on this device. Write to us at:</Text>
          <Text selectable style={{ fontFamily: fontFamily.uiStrong }}>{contactEmail}</Text>
          <Button kind="ghost" label={copied ? "Copied" : "Copy"} onPress={() => void Clipboard.setStringAsync(contactEmail).then(() => setCopied(true))} />
        </View>
      ) : null}
    </View>
  );
}

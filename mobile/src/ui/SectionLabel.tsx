import { fontFamily } from "../theme";
import { Text } from "./Text";
import { useColors } from "./theme";

/** The first app's small copper capitals: a section's name, or a notification's kind. */
export function SectionLabel({ children }: { children: string }) {
  const c = useColors();
  return <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText, fontSize: 12, letterSpacing: 1.8, textTransform: "uppercase" }}>{children}</Text>;
}

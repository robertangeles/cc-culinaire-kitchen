import { Text as RNText, type TextProps } from "react-native";
import { fontFamily, fontSize } from "../theme";
import { useColors } from "./theme";

type Variant = "title" | "body" | "muted" | "error";

/** Fraunces for titles, Inter for everything else. Never below 16pt; scales with the phone's text size. */
export function Text({ variant = "body", style, ...rest }: TextProps & { variant?: Variant }) {
  const c = useColors();
  const look =
    variant === "title"
      ? { fontFamily: fontFamily.title, fontSize: fontSize.title, color: c.text }
      : variant === "muted"
        ? { fontFamily: fontFamily.ui, fontSize: fontSize.body, color: c.textMuted }
        : variant === "error"
          ? { fontFamily: fontFamily.uiStrong, fontSize: fontSize.body, color: c.danger }
          : { fontFamily: fontFamily.ui, fontSize: fontSize.body, color: c.text };
  return <RNText accessibilityRole={variant === "title" ? "header" : undefined} {...rest} style={[look, style]} />;
}

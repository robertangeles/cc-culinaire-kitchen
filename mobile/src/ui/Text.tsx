import { Text as RNText, type TextProps } from "react-native";
import { fontFamily, fontSize } from "../theme";
import { useColors } from "./theme";

type Variant = "title" | "heading" | "label" | "body" | "muted" | "meta" | "error";

/**
 * Fraunces for titles, headings and sentences, Inter for short facts ("meta"). "heading" names a card or a row's item; "label" is the first
 * app's copper capitals over a section or field, the one size below 16pt. Scales with the phone's text size.
 */
export function Text({ variant = "body", style, ...rest }: TextProps & { variant?: Variant }) {
  const c = useColors();
  const look =
    variant === "title"
      ? { fontFamily: fontFamily.title, fontSize: fontSize.title, color: c.text }
      : variant === "heading"
        ? { fontFamily: fontFamily.title, fontSize: fontSize.heading, color: c.text }
        : variant === "label"
          ? { fontFamily: fontFamily.uiStrong, fontSize: fontSize.label, letterSpacing: 1.8, textTransform: "uppercase" as const, color: c.accentText }
          : variant === "muted"
            ? { fontFamily: fontFamily.body, fontSize: fontSize.body, color: c.textMuted }
            : variant === "meta"
              ? { fontFamily: fontFamily.ui, fontSize: fontSize.body, color: c.textMuted }
              : variant === "error"
                ? { fontFamily: fontFamily.title, fontSize: fontSize.body, color: c.danger }
                : { fontFamily: fontFamily.body, fontSize: fontSize.body, color: c.text };
  return <RNText accessibilityRole={variant === "title" ? "header" : undefined} {...rest} style={[look, style]} />;
}

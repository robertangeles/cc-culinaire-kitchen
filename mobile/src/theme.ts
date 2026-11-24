/**
 * Design tokens for the phone app. Rationale and numbers: brain page `designs/mobile-app-design-system`.
 *
 * Colours start from the approved palette. Five were nudged just far enough to reach 4.5:1 text
 * contrast, which the design's own accessibility rule requires (measured, see theme.test.ts):
 * light muted text #6B6F76 -> #696D74, light ember #C24A28 -> #BA4726, copper used as TEXT
 * #B87840 -> #956134, primary button gradient start #B87840 ->
 * #A26A38 (white text), dark herb/ember/muted lightened. Saffron is only ever a fill; text on it is ink.
 */

export interface Palette {
  /** Screen background. */
  bg: string;
  /** Cards, keypad, sheets. */
  surface: string;
  /** Text field background (the old app's paperDeep). */
  field: string;
  border: string;
  text: string;
  textMuted: string;
  /** Copper as text or link. */
  accentText: string;
  /** Primary button gradient and its text. */
  buttonFrom: string;
  buttonTo: string;
  buttonText: string;
  /** Done / accepted. */
  success: string;
  /** Offline or short: a fill, with `onWarning` text on top. */
  warningFill: string;
  onWarning: string;
  /** Needs attention and errors. */
  danger: string;
}

export const palettes: Record<"light" | "dark", Palette> = {
  light: {
    bg: "#F3EFE4",
    surface: "#F8F4EA",
    field: "#E8E2D6",
    border: "#C9C2B3",
    text: "#101418",
    textMuted: "#696D74",
    accentText: "#956134",
    buttonFrom: "#A26A38",
    buttonTo: "#8A5530",
    buttonText: "#FFFFFF",
    success: "#3F5B3A",
    warningFill: "#D9A441",
    onWarning: "#101418",
    danger: "#BA4726",
  },
  dark: {
    bg: "#101418",
    surface: "#1B2027",
    field: "#1B2027",
    border: "#2A2F36",
    text: "#EDE6D7",
    textMuted: "#84878D",
    accentText: "#D89868",
    buttonFrom: "#D89868",
    buttonTo: "#B87840",
    buttonText: "#101418",
    success: "#798C75",
    warningFill: "#D9A441",
    onWarning: "#101418",
    danger: "#CD6B4F",
  },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Rows are dividers, not cards, so they have no radius. */
export const radius = { key: 16, button: 14, banner: 12 } as const;

/**
 * dp. Taps are at least 56; keypad keys 72 with 8 gaps; the primary button 64. The tab bar is 64 above the system navigation bar's inset:
 * a tab is 5 + the 28 pill (a 22 icon) + 2 + a 16 label line + 5, and the bar's own padding is 4 above and below. The whole tab is the tap target.
 */
export const size = { tap: 56, key: 72, keyGap: 8, primaryButton: 64, tabBar: 64, tabIcon: 22, tabPill: 56 } as const;

/** pt. Nothing below 16 but the copper capitals label (and the tab bar's labels); everything must scale to 200% without clipping the typed number. */
export const fontSize = { title: 32, item: 28, heading: 20, number: 72, body: 16, label: 12 } as const;

/** Loaded in app/_layout.tsx. Fraunces for titles, item names and sentences (as in the first app), Inter for buttons, labels, short facts and tabular numerals. */
export const fontFamily = {
  title: "Fraunces_600SemiBold",
  body: "Fraunces_400Regular",
  ui: "Inter_400Regular",
  uiStrong: "Inter_600SemiBold",
} as const;

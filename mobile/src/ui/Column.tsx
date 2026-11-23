import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";

/** The widest a reading column gets, in dp: a phone fills the screen, an iPad or tablet gets this column in the middle (long lines and far-apart controls are hard to use). */
export const COLUMN_MAX_WIDTH = 640;

/** Centres its children in a column of at most `COLUMN_MAX_WIDTH`. Every screen's content goes inside one. */
export function Column({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ width: "100%", maxWidth: COLUMN_MAX_WIDTH, alignSelf: "center" }, style]}>{children}</View>;
}

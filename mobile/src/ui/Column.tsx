import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { COLUMN_WIDTH } from "./Screen";

/** Centres its children in the app's one column width (`COLUMN_WIDTH`, as `Screen` does), for screens that lay themselves out: a phone fills the screen, an iPad gets the column in the middle. */
export function Column({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ width: "100%", maxWidth: COLUMN_WIDTH, alignSelf: "center" }, style]}>{children}</View>;
}

import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";

/** Simple line icons for the tab bar, 24 dp grid, drawn with the tab's own colour. */
const paths = {
  count: "M8 5H6.5A1.5 1.5 0 0 0 5 6.5v13A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 17.5 5H16M9 3.5h6a1 1 0 0 1 1 1V6a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1zM9 13.5l2 2 4-4.5",
  waste: "M4 7h16M10.5 11v6M13.5 11v6M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7",
  account: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0",
} as const;

export type TabIconName = keyof typeof paths;

export function TabIcon({ name, color, size = 24 }: { name: TabIconName; color: ColorValue; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d={paths[name]} stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

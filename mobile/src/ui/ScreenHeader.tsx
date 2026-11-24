import { View } from "react-native";
import { space } from "../theme";
import { Text } from "./Text";

/**
 * The top of every tab, in one place and one shape: a copper capitals label (the location the person works at, or what the tab is part of)
 * held close over the Fraunces title, as the first app heads its pages.
 */
export function ScreenHeader({ label, title }: { label: string; title: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="label">{label}</Text>
      <Text variant="title">{title}</Text>
    </View>
  );
}

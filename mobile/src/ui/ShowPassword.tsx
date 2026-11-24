import { Pressable } from "react-native";
import { size, space } from "../theme";
import { Text } from "./Text";
import { useColors } from "./theme";

/** The Show / Hide toggle at the right of a password field (`TextField`'s `trailing`). As tall as the field, so the whole end of it is the tap target. */
export function ShowPassword({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={shown ? "Hide password" : "Show password"} hitSlop={{ left: space.lg, right: space.lg }} onPress={onToggle} style={{ minHeight: size.tap, justifyContent: "center" }}>
      <Text variant="label" style={{ color: c.textMuted }} accessibilityElementsHidden>
        {shown ? "Hide" : "Show"}
      </Text>
    </Pressable>
  );
}

import type { ReactNode } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { space } from "../theme";
import { useColors } from "./theme";

/**
 * A themed, safe-area screen that scrolls when the text is scaled up and lifts above the keyboard. "padding" on Android too: with
 * edge-to-edge the window no longer resizes for the keyboard, so without it the lower fields sit behind the keyboard.
 */
export function Screen({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, padding: space.xl, justifyContent: "center", gap: space.lg },
});

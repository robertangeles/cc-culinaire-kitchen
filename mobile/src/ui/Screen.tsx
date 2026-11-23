import type { ReactNode } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { space } from "../theme";
import { useColors } from "./theme";

/** The widest a form or a page of text gets. On a tablet the column stays this wide, centred, instead of stretching across the screen. */
export const COLUMN_WIDTH = 560;

/**
 * A themed, safe-area screen that scrolls when the text is scaled up and lifts above the keyboard. "padding" on Android too: with
 * edge-to-edge the window no longer resizes for the keyboard, so without it the lower fields sit behind the keyboard.
 * Content sits in one column no wider than `COLUMN_WIDTH`, so the same screen reads well on an iPad.
 */
export function Screen({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.column}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, padding: space.xl, justifyContent: "center", alignItems: "center" },
  column: { width: "100%", maxWidth: COLUMN_WIDTH, gap: space.lg },
});

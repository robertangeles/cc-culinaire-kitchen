import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { space } from "../theme";
import { useColors } from "./theme";

/** A themed, safe-area screen that scrolls when the text is scaled up and lifts above the keyboard. */
export function Screen({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
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

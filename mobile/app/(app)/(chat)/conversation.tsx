import { useRef, useState, type ComponentRef } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../../src/runtime/appContext";
import { useConversation } from "../../../src/chat/ChatProvider";
import type { ChatMessage } from "../../../src/chat/chatStore";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Grounded } from "../../../src/ui/Grounded";
import { Markdown } from "../../../src/ui/Markdown";
import { Text } from "../../../src/ui/Text";
import { caret } from "../../../src/ui/TextField";
import { fontFamily, fontSize, radius, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** The web's suggested first questions (`WelcomeScreen.tsx`). */
const SUGGESTIONS = [
  "My hollandaise split. How do I fix it?",
  "What's the proper technique for searing scallops?",
  "Explain the five mother sauces and their derivatives",
  "How do I temper chocolate without a marble slab?",
];

function Bubble({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  const c = useColors();
  if (message.role === "user") {
    return (
      <View style={{ alignSelf: "flex-end", maxWidth: "88%", backgroundColor: c.field, borderRadius: radius.key, padding: space.lg }}>
        <Text>{message.text}</Text>
      </View>
    );
  }
  return (
    <View style={{ alignSelf: "stretch", gap: space.sm, backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.key, padding: space.lg }}>
      <Text variant="label">Antoine</Text>
      {message.grounded?.length ? <Grounded titles={message.grounded} /> : null}
      {message.text ? <Markdown text={message.text} /> : <Text variant="muted" accessibilityLiveRegion="polite">{streaming ? "Antoine is thinking…" : ""}</Text>}
    </View>
  );
}

/** One conversation: the whole history is sent with each question and the answer streams in. Saved after each answer, as on the web. */
export default function Conversation() {
  const router = useRouter();
  const c = useColors();
  const { state } = useSession();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { store, snap } = useConversation(id || null);
  const [draft, setDraft] = useState("");
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const streaming = snap.phase === "streaming";
  const firstName = state.phase === "ready" ? state.user.userName.split(" ")[0] : "";
  const fresh = snap.messages.length === 0 && snap.phase === "idle";

  function send(text: string) {
    if (!text.trim() || streaming) return;
    setDraft("");
    void store.send(text);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={{ paddingHorizontal: space.xl, paddingTop: space.sm }}>
          <Column>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to conversations" hitSlop={8} onPress={() => router.back()} style={{ minHeight: size.tap, justifyContent: "center", alignSelf: "flex-start" }}>
              <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText }}>‹ Conversations</Text>
            </Pressable>
          </Column>
        </View>
        {/* Also when the keyboard takes the lower half (onLayout): the latest message stays in view, which matters most on a tablet on its side. */}
        <ScrollView ref={scroll} contentContainerStyle={{ padding: space.xl, paddingTop: space.sm }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })} onLayout={() => !fresh && scroll.current?.scrollToEnd({ animated: true })} keyboardShouldPersistTaps="handled">
          <Column style={{ gap: space.lg }}>
            {snap.title ? <Text variant="title" style={{ fontSize: 26 }}>{snap.title}</Text> : null}
            {snap.phase === "loading" ? <Text variant="muted">Loading the conversation…</Text> : null}
            {snap.phase === "error" ? (
              <>
                <Text variant="error">{snap.failure?.message}</Text>
                {snap.failure?.canRetry && id ? <Button kind="ghost" label="Try again" onPress={() => void store.open(id)} /> : null}
              </>
            ) : null}

            {fresh && !snap.failure ? (
              <View style={{ gap: space.md }}>
                <Text variant="title">{firstName ? `Hello, ${firstName}` : "Ask Antoine"}</Text>
                <Text variant="muted">Your AI culinary knowledge engine. Try one of these, or ask your own.</Text>
                {SUGGESTIONS.map((s) => (
                  <Pressable
                    key={s}
                    accessibilityRole="button"
                    onPress={() => send(s)}
                    style={({ pressed }) => ({ minHeight: size.tap, justifyContent: "center", borderRadius: radius.banner, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, paddingHorizontal: space.lg, paddingVertical: space.md, opacity: pressed ? 0.7 : 1 })}
                  >
                    <Text>{s}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {snap.messages.map((m, i) => (
              <Bubble key={m.id} message={m} streaming={streaming && i === snap.messages.length - 1} />
            ))}
            {snap.stopped ? <Text variant="meta">Stopped.</Text> : null}
            {snap.phase === "idle" && snap.failure ? (
              <View style={{ gap: space.sm }} accessibilityLiveRegion="polite">
                <Text variant="error">{snap.failure.message}</Text>
                {snap.failure.canRetry ? <Button kind="ghost" label="Try again" onPress={() => void store.retry()} /> : null}
              </View>
            ) : null}
            {snap.unsaved && !streaming ? (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
                <Text variant="meta" style={{ flexShrink: 1 }}>Not saved yet: it won't show in your conversations.</Text>
                <Button kind="quiet" label="Save again" onPress={() => void store.saveNow()} />
              </View>
            ) : null}
          </Column>
        </ScrollView>

        {snap.phase !== "loading" && snap.phase !== "error" ? (
          <View style={{ borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface, paddingVertical: space.md, paddingHorizontal: space.xl }}>
            <Column style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}>
              <TextInput
                {...caret(c)}
                accessibilityLabel="Your question"
                placeholder="Ask about techniques, troubleshooting, ingredients…"
                placeholderTextColor={c.textMuted}
                value={draft}
                onChangeText={setDraft}
                multiline
                maxLength={4000}
                editable={!streaming}
                style={{ flex: 1, minHeight: size.tap, maxHeight: 160, borderRadius: radius.banner, borderWidth: 1, borderColor: c.border, backgroundColor: c.field, color: c.text, fontFamily: fontFamily.ui, fontSize: fontSize.body, paddingHorizontal: space.lg, paddingTop: 16, paddingBottom: 16 }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={streaming ? "Stop" : "Send"}
                accessibilityState={{ disabled: !streaming && !draft.trim() }}
                disabled={!streaming && !draft.trim()}
                onPress={() => (streaming ? store.stop() : send(draft))}
                style={({ pressed }) => ({ minWidth: 72, minHeight: size.tap, borderRadius: radius.button, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md, backgroundColor: streaming ? c.danger : c.buttonFrom, opacity: !streaming && !draft.trim() ? 0.5 : pressed ? 0.8 : 1 })}
              >
                <Text style={{ fontFamily: fontFamily.uiStrong, color: c.buttonText }}>{streaming ? "Stop" : "Send"}</Text>
              </Pressable>
            </Column>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

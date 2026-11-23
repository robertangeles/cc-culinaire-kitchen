import { useCallback, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useConversations } from "../../../src/chat/ChatProvider";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { fontFamily, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

const dayOf = (iso: string) => (iso ? new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" }) : "");

/** Ask Antoine: start a conversation, or go back to a saved one (newest first, as the web's sidebar). */
export default function Conversations() {
  const router = useRouter();
  const c = useColors();
  const { list, refresh, remove } = useConversations();
  const [refreshing, setRefreshing] = useState(false);
  useFocusEffect(useCallback(() => void refresh(), [refresh]));
  const caps = { fontFamily: fontFamily.uiStrong, fontSize: 12, letterSpacing: 1.8, textTransform: "uppercase", color: c.accentText } as const;

  function confirmDelete(id: string, title: string) {
    Alert.alert(`Delete “${title}”?`, "The conversation is deleted for good, on the web too.", [
      { text: "Keep it", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void remove(id) },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }} />}
      >
        <Column style={{ gap: space.lg }}>
          <Text style={caps}>Kitchen AI</Text>
          <Text variant="title">Ask Antoine</Text>
          <Text variant="muted">Techniques, troubleshooting, ingredients: ask the way you would ask your sous chef.</Text>
          <Button label="New conversation" onPress={() => router.push("/conversation")} />

          {list.failure ? (
            <>
              <Text variant="error">{list.failure.message}</Text>
              {list.phase === "error" && list.failure.canRetry ? <Button kind="ghost" label="Try again" onPress={() => void refresh()} /> : null}
            </>
          ) : null}
          {list.phase === "loading" ? <Text variant="muted">Loading your conversations…</Text> : null}

          {list.phase === "ready" ? (
            <View style={{ gap: space.xs }}>
              <Text style={caps}>Your conversations</Text>
              {list.items.length === 0 ? (
                <Text variant="muted">No saved conversations yet. They appear here, and on the web, after the first answer.</Text>
              ) : (
                <Surface>
                  {list.items.map((item, index) => (
                    <View key={item.conversationId} style={[{ flexDirection: "row", alignItems: "center" }, rowDivider(index, c.border)]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${item.conversationTitle}, ${dayOf(item.updatedDttm)}`}
                        onPress={() => router.push({ pathname: "/conversation", params: { id: item.conversationId } })}
                        style={({ pressed }) => ({ flex: 1, minHeight: size.tap + 8, justifyContent: "center", paddingVertical: space.md, paddingLeft: space.lg, gap: 2, opacity: pressed ? 0.6 : 1 })}
                      >
                        <Text numberOfLines={2} style={{ fontFamily: fontFamily.title, fontSize: 18 }}>{item.conversationTitle}</Text>
                        <Text variant="meta">{dayOf(item.updatedDttm)}</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${item.conversationTitle}`}
                        hitSlop={4}
                        onPress={() => confirmDelete(item.conversationId, item.conversationTitle)}
                        style={{ minWidth: size.tap, minHeight: size.tap, alignItems: "center", justifyContent: "center" }}
                      >
                        <Text style={{ fontFamily: fontFamily.uiStrong, color: c.textMuted }}>Delete</Text>
                      </Pressable>
                    </View>
                  ))}
                </Surface>
              )}
            </View>
          ) : null}
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

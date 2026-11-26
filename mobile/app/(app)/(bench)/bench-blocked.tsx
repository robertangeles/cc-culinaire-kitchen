import { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type { BenchPerson } from "@culinaire/shared/schemas/bench";
import { useBench } from "../../../src/bench/BenchProvider";
import { benchFailure } from "../../../src/bench/benchStore";
import { Avatar } from "../../../src/ui/Avatar";
import { Column } from "../../../src/ui/Column";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { Text } from "../../../src/ui/Text";
import { fontFamily, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** The people this person blocked on the Bench, each with Unblock. */
export default function BenchBlocked() {
  const { api, store } = useBench();
  const router = useRouter();
  const c = useColors();
  const [people, setPeople] = useState<BenchPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setPeople(await api.blocked());
      setError(null);
    } catch (err) {
      setError(benchFailure(err));
    }
  }, [api]);
  useFocusEffect(useCallback(() => void load(), [load]));

  async function unblock(p: BenchPerson) {
    const failed = await store.unblock(p.userId);
    if (failed) setError(failed);
    else setPeople((all) => all?.filter((x) => x.userId !== p.userId) ?? null);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ padding: space.xl }}>
        <Column style={{ gap: space.lg }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to the Bench" hitSlop={8} onPress={() => router.back()} style={{ minHeight: size.tap, justifyContent: "center", alignSelf: "flex-start" }}>
            <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText }}>‹ The Bench</Text>
          </Pressable>
          <ScreenHeader label="The Bench" title="Blocked people" />
          <Text variant="muted">You don't see their messages, reactions or when they're here, and neither of you can message the other. They aren't told.</Text>
          {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
          {people === null && !error ? <Text variant="muted">Loading…</Text> : null}
          {people ? (
            <Surface>
              {people.length === 0 ? (
                <View style={{ padding: space.lg, gap: space.xs }}>
                  <Text variant="heading">Nobody is blocked</Text>
                  <Text variant="muted">Tap a message or a person on the Bench to block them.</Text>
                </View>
              ) : null}
              {people.map((p, i) => (
                <View key={p.userId} style={[{ minHeight: size.tap + 8, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm }, rowDivider(i, c.border)]}>
                  <Avatar photoPath={p.userPhotoPath} name={p.userName} size={40} />
                  <Text variant="heading" numberOfLines={1} style={{ flex: 1 }}>{p.userName}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Unblock ${p.userName}`} onPress={() => void unblock(p)} style={{ minHeight: size.tap, justifyContent: "center" }}>
                    <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText }}>Unblock</Text>
                  </Pressable>
                </View>
              ))}
            </Surface>
          ) : null}
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../../src/runtime/appContext";
import { useCount } from "../../../src/count/CountProvider";
import { summarizeArea } from "../../../src/count/countFlow";
import { OfflineBanner } from "../../../src/ui/Banner";
import { Text } from "../../../src/ui/Text";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { Button } from "../../../src/ui/Button";
import { Chip, Surface, rowDivider } from "../../../src/ui/Surface";
import { size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";
import { Column } from "../../../src/ui/Column";

const sheetIndex = (sheets: Array<{ categoryName: string }>, name: string) => {
  const i = sheets.findIndex((s) => s.categoryName === name);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
};

/** The areas list of the open stock take: progress per area, what needs attention, who holds what. */
export default function Areas() {
  const { state } = useSession();
  const { store, snap } = useCount();
  const router = useRouter();
  const c = useColors();
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  if (state.phase !== "ready") return null;

  const attention = snap.stuck.length;
  const attentionText = `${attention} ${attention === 1 ? "count needs" : "counts need"} attention`;
  const waiting = Object.values(snap.entries).flat().filter((e) => e.status === "SAVED_LOCAL" || e.status === "SENDING").length;

  async function open(name: string) {
    setNotice(null);
    try {
      const result = await store.openArea(name);
      if (result.status === "claimed") router.push({ pathname: "/area/[name]", params: { name } });
      else if (result.status === "held") setNotice("Another chef is counting that area.");
      else if (result.status === "submitted") setNotice("That area was already sent for review.");
      else setNotice("Connect to start counting this area.");
    } catch {
      setNotice("Something went wrong. Try again.");
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await store.refresh(); setRefreshing(false); }} />}
      >
        <Column style={{ gap: space.lg }}>
          <ScreenHeader label={state.location.locationName} title="Count" />
          {snap.offline ? <OfflineBanner text="You're offline. Counts are saved on this phone and sent when you're back." /> : null}
          {attention > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel={attentionText} onPress={() => router.push("/attention")} style={{ minHeight: size.tap, justifyContent: "center" }}>
              <Text variant="error">⚠ {attentionText}</Text>
            </Pressable>
          ) : null}
          {waiting > 0 ? <Text variant="muted">{waiting} waiting to send</Text> : null}
          {snap.otherAccountPending > 0 ? (
            <Text variant="muted">
              {snap.otherAccountPending} {snap.otherAccountPending === 1 ? "count" : "counts"} from another account {snap.otherAccountPending === 1 ? "is" : "are"} waiting on this phone. They are sent when that account signs in.
            </Text>
          ) : null}
          {notice ? <Text variant="error" accessibilityLiveRegion="polite">{notice}</Text> : null}

          {snap.phase === "loading" || snap.phase === "none" || snap.phase === "categoryMode" ? (
            // The same card as Waste's "Today": a copper label over one sentence, so an empty tab is not a bare line of text.
            <Surface>
              <View style={{ padding: space.lg, gap: space.xs }}>
                <Text variant="label">Stock take</Text>
                <Text variant="muted">
                  {snap.phase === "loading"
                    ? "Loading the stock take…"
                    : snap.phase === "none"
                      ? "No stock take is open. Ask your manager to open one on the web."
                      : "This stock take counts by category. Count it on the web."}
                </Text>
              </View>
            </Surface>
          ) : null}
          {snap.phase === "error" ? (
            <>
              <Text variant="error">{snap.error}</Text>
              <Button label="Try again" onPress={() => void store.refresh()} />
            </>
          ) : null}

          {snap.phase === "ready" && snap.session ? (
            <Surface>
              {[...snap.session.categories]
                // Shelf order (the order of the count sheets), not the server's row order, which changes as rows are updated.
                .sort((a, b) => sheetIndex(snap.sheets, a.categoryName) - sheetIndex(snap.sheets, b.categoryName))
                .map((category, index) => {
                const sheet = snap.sheets.find((s) => s.categoryName === category.categoryName);
                const area = summarizeArea({ items: sheet?.items ?? [], category, answers: store.answers(category.categoryName), currentUserId: state.user.userId });
                const done = area.status === "SUBMITTED" || area.status === "APPROVED";
                return (
                  <Pressable
                    key={category.categoryId}
                    accessibilityRole="button"
                    accessibilityLabel={`${area.name}, ${area.counted} of ${area.total} counted${area.heldBy ? `, held by ${area.heldBy}` : ""}${done ? ", sent for review" : ""}`}
                    onPress={() => void open(area.name)}
                    style={[{ minHeight: size.tap + 14, justifyContent: "center", paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.xs }, rowDivider(index, c.border)]}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                      <Text variant="heading" style={{ flexShrink: 1 }}>{area.name}</Text>
                      <Chip label={done ? "Sent for review" : `${area.counted} of ${area.total}`} />
                    </View>
                    {area.sharesWith.length > 0 ? <Text variant="meta">Shares items with {area.sharesWith.join(", ")}</Text> : null}
                    {area.heldBy ? <Text variant="meta">{area.heldBy} is counting this</Text> : null}
                    {area.needsAttention > 0 ? <Text variant="error">⚠ {area.needsAttention} need attention</Text> : null}
                  </Pressable>
                );
              })}
            </Surface>
          ) : null}
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

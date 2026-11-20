import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { session, useSession } from "../src/runtime/appContext";
import { useCount } from "../src/runtime/countContext";
import { summarizeArea } from "../src/count/countFlow";
import { OfflineBanner } from "../src/ui/Banner";
import { Text } from "../src/ui/Text";
import { Button } from "../src/ui/Button";
import { Chip, Surface, rowDivider } from "../src/ui/Surface";
import { fontFamily, size, space } from "../src/theme";
import { useColors } from "../src/ui/theme";

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
        contentContainerStyle={{ padding: space.xl, gap: space.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await store.refresh(); setRefreshing(false); }} />}
      >
        <Text variant="title">{state.location.locationName}</Text>
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

        {snap.phase === "loading" ? <Text variant="muted">Loading the stock take…</Text> : null}
        {snap.phase === "none" ? <Text>No stock take is open. Ask your manager to open one on the web.</Text> : null}
        {snap.phase === "categoryMode" ? <Text>This stock take counts by category. Count it on the web.</Text> : null}
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
                    <Text style={{ fontFamily: fontFamily.title, fontSize: 20, flexShrink: 1 }}>{area.name}</Text>
                    <Chip label={done ? "Sent for review" : `${area.counted} of ${area.total}`} />
                  </View>
                  {area.sharesWith.length > 0 ? <Text variant="muted">Shares items with {area.sharesWith.join(", ")}</Text> : null}
                  {area.heldBy ? <Text variant="muted">{area.heldBy} is counting this</Text> : null}
                  {area.needsAttention > 0 ? <Text variant="error">⚠ {area.needsAttention} need attention</Text> : null}
                </Pressable>
              );
            })}
          </Surface>
        ) : null}

        {state.locations.length > 1 ? <Button kind="quiet" label="Change location" onPress={() => session.changeLocation()} /> : null}
        <Button kind="quiet" label="Sign out" onPress={() => void session.signOut()} />
      </ScrollView>
    </SafeAreaView>
  );
}

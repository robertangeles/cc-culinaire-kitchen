import { useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../../src/runtime/appContext";
import { usePrep } from "../../../src/prep/PrepProvider";
import { attentionSentence } from "../../../src/outbox/QueueStatus";
import { dishesOf, groupByTier, quantityText, stockText, type PrepRow } from "../../../src/prep/prepView";
import { OfflineBanner } from "../../../src/ui/Banner";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { Chip, Surface, rowDivider } from "../../../src/ui/Surface";
import { fontFamily, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Today's prep at this location: progress, then the tasks from "start with these" to "can wait", each one a tap to tick. */
export default function Prep() {
  const { state } = useSession();
  const { store, canPlan, snap } = usePrep();
  const router = useRouter();
  const c = useColors();
  const [refreshing, setRefreshing] = useState(false);
  if (state.phase !== "ready") return null;
  const { list } = snap;
  const { session, progress } = list;

  function discard(row: PrepRow) {
    Alert.alert(`Discard the change to ${row.ingredientName}?`, "It won't be sent. A record of it is kept on this phone.", [
      { text: "Keep it", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => void store.discard(row.entryId!) },
    ]);
  }

  const who = (row: PrepRow) => (row.completedBy === state.user.userId ? "you" : "a colleague");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await store.refresh(); setRefreshing(false); }} />}
      >
        <Column style={{ gap: space.lg }}>
          <ScreenHeader label={state.location.locationName} title="Prep" />
          {snap.offline ? <OfflineBanner text="You're offline. Ticks are saved on this phone and sent when you're back." /> : null}
          {snap.waiting > 0 ? <Text variant="muted" accessibilityLiveRegion="polite">{snap.waiting} waiting to send</Text> : null}
          {snap.attention > 0 ? <Text variant="error">⚠ {snap.attention} {snap.attention === 1 ? "task needs" : "tasks need"} attention</Text> : null}
          {snap.phase === "error" ? (
            <>
              <Text variant="error">{snap.error}</Text>
              <Button label="Try again" onPress={() => void store.refresh()} />
            </>
          ) : null}

          {snap.phase === "ready" && list.plan ? (
            <Surface>
              <View style={{ padding: space.lg, gap: space.sm }}>
                <Text>Today's prep list is waiting to be made.</Text>
                {list.plan.sync === "attention" && list.plan.entryId ? (
                  <>
                    <Text variant="error">⚠ {attentionSentence("rejected", list.plan.message)}</Text>
                    <Button label="Try again" onPress={() => void store.retry(list.plan!.entryId!)} />
                    <Button kind="quiet" label="Discard" onPress={() => Alert.alert("Discard today's prep list?", "It won't be made. A record of it is kept on this phone.", [{ text: "Keep it", style: "cancel" }, { text: "Discard", style: "destructive", onPress: () => void store.discard(list.plan!.entryId!) }])} />
                  </>
                ) : (
                  <Text variant="meta">It will be made as soon as the phone can reach the server.</Text>
                )}
              </View>
            </Surface>
          ) : null}

          {snap.phase === "ready" && !list.plan && progress.total === 0 ? (
            <Surface>
              <View style={{ padding: space.lg, gap: space.sm }}>
                <Text variant="label">Today</Text>
                <Text>Nothing planned for today yet.</Text>
                {canPlan ? <Button label="Plan today's prep" onPress={() => router.push("/plan")} /> : <Text variant="muted">Ask a manager to plan today's prep.</Text>}
              </View>
            </Surface>
          ) : null}

          {progress.total > 0 ? (
            <Surface>
              <View style={{ padding: space.lg, gap: space.sm }}>
                <Text variant="label">Today</Text>
                <Text style={{ fontFamily: fontFamily.title, fontSize: 24 }}>{progress.done} of {progress.total} done</Text>
                <View accessibilityRole="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} style={{ height: 8, borderRadius: 4, backgroundColor: c.border, overflow: "hidden" }}>
                  <View style={{ height: 8, width: `${Math.round((progress.done / progress.total) * 100)}%`, backgroundColor: c.success }} />
                </View>
                <Text variant="meta">{[progress.skipped > 0 ? `${progress.skipped} skipped` : null, session?.expectedCovers ? `${session.expectedCovers} covers expected` : null].filter(Boolean).join(" · ")}</Text>
              </View>
            </Surface>
          ) : null}

          {groupByTier(list.rows).map((group) => (
            <View key={group.title} style={{ gap: space.xs }}>
              <Text variant="label">{group.title} · {group.done}/{group.rows.length}</Text>
              <Surface>
                {group.rows.map((row, index) => {
                  const done = row.status === "completed";
                  const skipped = row.status === "skipped";
                  const stock = stockText(row);
                  const dishes = dishesOf(row);
                  const facts = [row.station, row.prepTimeMinutes ? `${row.prepTimeMinutes} min` : null].filter(Boolean).join(" · ");
                  return (
                    <View key={row.prepTaskId} style={[{ paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.xs, opacity: done || skipped ? 0.7 : 1 }, rowDivider(index, c.border)]}>
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityLabel={`${row.ingredientName}, ${quantityText(row.quantityNeeded, row.unit)}`}
                        aria-checked={done}
                        disabled={skipped}
                        onPress={() => void store.setStatus(row.prepTaskId, done ? "pending" : "completed")}
                        style={{ minHeight: size.tap, flexDirection: "row", alignItems: "center", gap: space.md }}
                      >
                        <View style={{ width: 32, height: 32, borderRadius: 8, borderWidth: 2, borderColor: done ? c.success : c.border, backgroundColor: done ? c.success : c.surface, alignItems: "center", justifyContent: "center" }}>
                          {done ? <Text style={{ color: c.buttonText, fontFamily: fontFamily.uiStrong }}>✓</Text> : null}
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                            <Text variant="heading" style={{ flexShrink: 1, textDecorationLine: done ? "line-through" : "none" }}>{row.ingredientName}</Text>
                            <Text style={{ fontFamily: fontFamily.uiStrong }}>{quantityText(row.quantityNeeded, row.unit)}</Text>
                          </View>
                          {stock ? <Text variant="meta">{stock}</Text> : null}
                        </View>
                      </Pressable>
                      {facts ? <Text variant="meta">{facts}</Text> : null}
                      {dishes ? <Text variant="meta">For {dishes}</Text> : null}
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                        <Text variant="meta" style={{ flexShrink: 1 }}>
                          {done ? `Done by ${who(row)}${row.completedAt ? ` · ${timeOf(row.completedAt)}` : ""}` : skipped ? "Skipped" : ""}
                        </Text>
                        {row.sync === "waiting" ? <Chip label="Waiting to send" /> : null}
                      </View>
                      {!done ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={skipped ? `Undo skip ${row.ingredientName}` : `Skip ${row.ingredientName}`}
                          onPress={() => void store.setStatus(row.prepTaskId, skipped ? "pending" : "skipped")}
                          style={{ minHeight: size.tap, justifyContent: "center", alignSelf: "flex-start" }}
                        >
                          <Text style={{ color: c.accentText, fontFamily: fontFamily.uiStrong }}>{skipped ? "Undo skip" : "Skip"}</Text>
                        </Pressable>
                      ) : null}
                      {row.sync === "attention" && row.entryId ? (
                        <>
                          <Text variant="error">⚠ {attentionSentence("rejected", row.attentionMessage)}</Text>
                          <Button label="Try again" onPress={() => void store.retry(row.entryId!)} />
                          <Button kind="quiet" label="Discard" onPress={() => discard(row)} />
                        </>
                      ) : null}
                    </View>
                  );
                })}
              </Surface>
            </View>
          ))}
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

import { useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../../src/runtime/appContext";
import { useMovements } from "../../../src/movements/MovementProvider";
import { attentionSentence } from "../../../src/outbox/QueueStatus";
import type { MovementRow } from "../../../src/movements/movementView";
import { OfflineBanner } from "../../../src/ui/Banner";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { Chip, Surface, rowDivider } from "../../../src/ui/Surface";
import { fontFamily, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** What moved between areas at this location, newest first, with whether each move has been sent. A move changes no stock. */
export default function Moves() {
  const { state } = useSession();
  const { store, snap } = useMovements();
  const router = useRouter();
  const c = useColors();
  const [refreshing, setRefreshing] = useState(false);
  if (state.phase !== "ready") return null;
  const caps = { fontFamily: fontFamily.uiStrong, fontSize: 12, letterSpacing: 1.8, textTransform: "uppercase", color: c.accentText } as const;
  const canMove = snap.areas.length >= 2;

  function discard(row: MovementRow) {
    Alert.alert(`Discard the move of ${row.ingredientName}?`, "It won't be sent. A record of it is kept on this phone.", [
      { text: "Keep it", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => void store.discard(row.entryId!) },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await store.refresh(); setRefreshing(false); }} />}
      >
        <Column style={{ gap: space.lg }}>
          <Text variant="title">Move between areas</Text>
          <Text variant="meta">{state.location.locationName}</Text>
          {snap.offline ? <OfflineBanner text="You're offline. Moves are saved on this phone and sent when you're back." /> : null}
          {snap.waiting > 0 ? <Text variant="muted" accessibilityLiveRegion="polite">{snap.waiting} waiting to send</Text> : null}
          {snap.attention > 0 ? <Text variant="error">⚠ {snap.attention} {snap.attention === 1 ? "move needs" : "moves need"} attention</Text> : null}
          {snap.phase === "error" ? (
            <>
              <Text variant="error">{snap.error}</Text>
              <Button label="Try again" onPress={() => void store.refresh()} />
            </>
          ) : null}

          {snap.phase === "ready" && !canMove ? (
            <Surface>
              <View style={{ padding: space.lg, gap: space.xs }}>
                <Text style={{ fontFamily: fontFamily.title, fontSize: 20 }}>{snap.areas.length === 0 ? "No areas yet" : "You need a second area"}</Text>
                <Text variant="muted">
                  {snap.offline
                    ? "The areas have not been downloaded to this phone yet. Open this tab once with a signal."
                    : snap.areas.length === 0
                      ? "Set up the places stock is kept (Dry Storage, Cool Room, Back Bar) on the web, then you can record what moves between them."
                      : "A move needs somewhere to come from and somewhere to go. Add another area on the web."}
                </Text>
              </View>
            </Surface>
          ) : (
            <Button label="Record a move" onPress={() => router.push("/move-entry")} disabled={!canMove} />
          )}
          <Text variant="meta">A move doesn't change your stock: the item stays on site until it's sold or wasted.</Text>

          {canMove && snap.recents.length > 0 ? (
            <View style={{ gap: space.xs }}>
              <Text style={caps}>Move again</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                {snap.recents.map((r) => (
                  <Pressable
                    key={r.name}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${r.name} again`}
                    hitSlop={4}
                    onPress={() => router.push({ pathname: "/move-entry", params: { name: r.name, ingredientId: r.ingredientId ?? "", unit: r.unit ?? "", quantity: r.quantity === undefined ? "" : String(r.quantity), from: r.fromStorageAreaId ?? "", to: r.toStorageAreaId ?? "" } })}
                    style={{ minHeight: 48, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.field, paddingHorizontal: space.lg, alignItems: "center", justifyContent: "center" }}
                  >
                    <Text style={{ fontFamily: fontFamily.uiStrong }}>{r.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {snap.phase === "ready" ? (
            <View style={{ gap: space.xs }}>
              <Text style={caps}>Recent moves</Text>
              {snap.rows.length === 0 ? (
                <Text variant="muted">Nothing moved yet.</Text>
              ) : (
                <Surface>
                  {snap.rows.map((row, index) => (
                    <View key={row.stockMovementId} style={[{ paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.xs }, rowDivider(index, c.border)]}>
                      <View accessible accessibilityLabel={`${row.ingredientName}, ${row.quantity} ${row.unit}, ${row.fromAreaName} to ${row.toAreaName}, ${row.sync === "synced" ? "sent" : row.sync === "waiting" ? "waiting to send" : "needs attention"}`} style={{ minHeight: size.tap, justifyContent: "center", gap: space.xs }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                          <Text style={{ fontFamily: fontFamily.title, fontSize: 20, flexShrink: 1 }}>{row.ingredientName}</Text>
                          <Text style={{ fontFamily: fontFamily.uiStrong }}>{row.quantity} {row.unit}</Text>
                        </View>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                          <Text variant="meta" style={{ flexShrink: 1 }}>{`${row.fromAreaName} → ${row.toAreaName} · ${timeOf(row.movedAt)}`}</Text>
                          {row.sync === "waiting" ? <Chip label="Waiting to send" /> : null}
                        </View>
                      </View>
                      {row.sync === "attention" && row.entryId ? (
                        <>
                          <Text variant="error">⚠ {attentionSentence("rejected", row.attentionMessage)}</Text>
                          <Button label="Try again" onPress={() => void store.retry(row.entryId!)} />
                          <Button kind="quiet" label="Discard" onPress={() => discard(row)} />
                        </>
                      ) : null}
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

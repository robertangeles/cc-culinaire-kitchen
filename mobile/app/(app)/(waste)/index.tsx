import { useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../../src/runtime/appContext";
import { useWaste } from "../../../src/waste/WasteProvider";
import { attentionSentence } from "../../../src/outbox/QueueStatus";
import type { WasteRow } from "../../../src/waste/wasteView";
import { OfflineBanner } from "../../../src/ui/Banner";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { Chip, Surface, rowDivider } from "../../../src/ui/Surface";
import { fontFamily, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Today's waste at this location: the totals, quick buttons for the latest items, and every entry with whether it has been sent. */
export default function Waste() {
  const { state } = useSession();
  const { store, snap } = useWaste();
  const router = useRouter();
  const c = useColors();
  const [refreshing, setRefreshing] = useState(false);
  if (state.phase !== "ready") return null;

  function discard(row: WasteRow) {
    Alert.alert(`Discard the change to ${row.ingredientName}?`, "It won't be sent. A record of it is kept on this phone.", [
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
          <ScreenHeader label={state.location.locationName} title="Waste" />
          {snap.offline ? <OfflineBanner text="You're offline. Waste is saved on this phone and sent when you're back." /> : null}
          {snap.waiting > 0 ? <Text variant="muted" accessibilityLiveRegion="polite">{snap.waiting} waiting to send</Text> : null}
          {snap.attention > 0 ? <Text variant="error">⚠ {snap.attention} {snap.attention === 1 ? "entry needs" : "entries need"} attention</Text> : null}
          {snap.phase === "error" ? (
            <>
              <Text variant="error">{snap.error}</Text>
              <Button label="Try again" onPress={() => void store.refresh()} />
            </>
          ) : null}

          <Button label="Log waste" onPress={() => router.push("/waste-entry")} />

          {snap.recents.length > 0 ? (
            <View style={{ gap: space.xs }}>
              <Text variant="label">Log again</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                {snap.recents.map((r) => (
                  <Pressable
                    key={r.name}
                    accessibilityRole="button"
                    accessibilityLabel={`Log ${r.name} again`}
                    hitSlop={4}
                    onPress={() => router.push({ pathname: "/waste-entry", params: { name: r.name, unit: r.unit ?? "", quantity: r.quantity === undefined ? "" : String(r.quantity) } })}
                    style={{ minHeight: 48, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.field, paddingHorizontal: space.lg, paddingVertical: space.sm, alignItems: "center", justifyContent: "center" }}
                  >
                    <Text style={{ fontFamily: fontFamily.uiStrong }}>{r.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {snap.phase === "ready" ? (
            <Surface>
              <View style={{ padding: space.lg, gap: space.xs }} accessibilityLabel="Today's waste">
                <Text variant="label">Today</Text>
                {snap.totals.entries === 0 ? (
                  <Text variant="muted">Nothing logged today.</Text>
                ) : (
                  <>
                    <Text style={{ fontFamily: fontFamily.title, fontSize: 24 }}>{snap.totals.byUnit.map((u) => `${u.quantity} ${u.unit}`).join(" · ")}</Text>
                    <Text variant="meta">
                      {snap.totals.entries} {snap.totals.entries === 1 ? "entry" : "entries"}
                      {snap.totals.cost > 0 ? ` · $${money(snap.totals.cost)}` : ""}
                    </Text>
                  </>
                )}
              </View>
            </Surface>
          ) : null}

          {snap.rows.length > 0 ? (
            <Surface>
              {snap.rows.map((row, index) => (
                <View key={row.wasteLogId} style={[{ paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.xs }, rowDivider(index, c.border)]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${row.ingredientName}, ${row.quantity} ${row.unit}, ${row.sync === "synced" ? "sent" : row.sync === "waiting" ? "waiting to send" : "needs attention"}. Edit`}
                    onPress={() => router.push({ pathname: "/waste-entry", params: { id: row.wasteLogId } })}
                    style={{ minHeight: size.tap, justifyContent: "center", gap: space.xs }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                      <Text variant="heading" style={{ flexShrink: 1 }}>{row.ingredientName}</Text>
                      <Text style={{ fontFamily: fontFamily.uiStrong }}>{row.quantity} {row.unit}</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                      <Text variant="meta" style={{ flexShrink: 1 }}>{[timeOf(row.loggedAt), row.reason, row.shift].filter(Boolean).join(" · ")}</Text>
                      {row.sync === "waiting" ? <Chip label="Waiting to send" /> : null}
                    </View>
                  </Pressable>
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
          ) : null}
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

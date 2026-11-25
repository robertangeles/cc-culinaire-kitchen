import { useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { CONSUMPTION_REASONS, CONSUMPTION_SHIFTS } from "@culinaire/shared/schemas/consumption";
import { useSession } from "../../../src/runtime/appContext";
import { useConsumption } from "../../../src/consumption/ConsumptionProvider";
import { attentionSentence } from "../../../src/outbox/QueueStatus";
import type { ConsumptionRow, UnitTotal } from "../../../src/consumption/consumptionView";
import { OfflineBanner } from "../../../src/ui/Banner";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { Chip, Surface, rowDivider } from "../../../src/ui/Surface";
import { fontFamily, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const labelOf = (list: readonly { key: string; label: string }[], key: string | null) => list.find((o) => o.key === key)?.label ?? key;
const units = (list: UnitTotal[]) => list.map((u) => `${u.quantity} ${u.unit}`).join(" · ");

/** Today's usage at this location: the totals, quick buttons for the latest items, and every entry with whether it has been sent. */
export default function Usage() {
  const { state } = useSession();
  const { store, snap } = useConsumption();
  const router = useRouter();
  const c = useColors();
  const [refreshing, setRefreshing] = useState(false);
  if (state.phase !== "ready") return null;

  function discard(row: ConsumptionRow) {
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
          <ScreenHeader label={state.location.locationName} title="Internal usage" />
          {snap.offline ? <OfflineBanner text="You're offline. Usage is saved on this phone and sent when you're back." /> : null}
          {snap.waiting > 0 ? <Text variant="muted" accessibilityLiveRegion="polite">{snap.waiting} waiting to send</Text> : null}
          {snap.attention > 0 ? <Text variant="error">⚠ {snap.attention} {snap.attention === 1 ? "entry needs" : "entries need"} attention</Text> : null}
          {snap.phase === "error" ? (
            <>
              <Text variant="error">{snap.error}</Text>
              <Button label="Try again" onPress={() => void store.refresh()} />
            </>
          ) : null}

          <Button label="Log usage" onPress={() => router.push("/usage-entry")} />

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
                    onPress={() => router.push({ pathname: "/usage-entry", params: { name: r.name, ingredientId: r.ingredientId ?? "", itemType: r.itemType ?? "", unit: r.unit ?? "", quantity: r.quantity === undefined ? "" : String(r.quantity), reason: r.reason ?? "" } })}
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
              <View style={{ padding: space.lg, gap: space.xs }} accessibilityLabel="Today's usage">
                <Text variant="label">Today</Text>
                {snap.totals.entries === 0 ? (
                  <Text variant="muted">Nothing logged today.</Text>
                ) : (
                  <>
                    <Text style={{ fontFamily: fontFamily.title, fontSize: 24 }}>{snap.totals.used.length > 0 ? units(snap.totals.used) : "Nothing used"}</Text>
                    <Text variant="meta">
                      {snap.totals.entries} {snap.totals.entries === 1 ? "entry" : "entries"}
                      {snap.totals.returned.length > 0 ? ` · returned ${units(snap.totals.returned)}` : ""}
                    </Text>
                  </>
                )}
              </View>
            </Surface>
          ) : null}

          {snap.rows.length > 0 ? (
            <Surface>
              {snap.rows.map((row, index) => {
                const mine = store.canChange(row);
                const status = row.sync === "synced" ? "sent" : row.sync === "waiting" ? "waiting to send" : "needs attention";
                const body = (
                  <>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                      <Text variant="heading" style={{ flexShrink: 1 }}>{row.ingredientName}</Text>
                      <Text style={{ fontFamily: fontFamily.uiStrong }}>{row.quantity} {row.unit}</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                      <Text variant="meta" style={{ flexShrink: 1 }}>{[timeOf(row.loggedAt), labelOf(CONSUMPTION_REASONS, row.reason), labelOf(CONSUMPTION_SHIFTS, row.shift), mine ? null : row.userName].filter(Boolean).join(" · ")}</Text>
                      {row.sync === "waiting" ? <Chip label="Waiting to send" /> : null}
                    </View>
                  </>
                );
                return (
                  <View key={row.consumptionLogId} style={[{ paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.xs }, rowDivider(index, c.border)]}>
                    {mine ? (
                      <Pressable accessibilityRole="button" accessibilityLabel={`${row.ingredientName}, ${row.quantity} ${row.unit}, ${status}. Edit`} onPress={() => router.push({ pathname: "/usage-entry", params: { id: row.consumptionLogId } })} style={{ minHeight: size.tap, justifyContent: "center", gap: space.xs }}>
                        {body}
                      </Pressable>
                    ) : (
                      <View accessible accessibilityLabel={`${row.ingredientName}, ${row.quantity} ${row.unit}, logged by ${row.userName ?? "someone else"}`} style={{ minHeight: size.tap, justifyContent: "center", gap: space.xs }}>
                        {body}
                      </View>
                    )}
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
          ) : null}
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

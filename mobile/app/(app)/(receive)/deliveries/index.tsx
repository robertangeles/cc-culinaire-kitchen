import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../../../src/runtime/appContext";
import { receivingApi } from "../../../../src/runtime/receiving";
import { expectedLabel, failureMessage, type QueueItem } from "../../../../src/receiving/receivingFlow";
import { OfflineBanner } from "../../../../src/ui/Banner";
import { Button } from "../../../../src/ui/Button";
import { Column } from "../../../../src/ui/Column";
import { Chip, Surface, rowDivider } from "../../../../src/ui/Surface";
import { Text } from "../../../../src/ui/Text";
import { fontFamily, size, space } from "../../../../src/theme";
import { useColors } from "../../../../src/ui/theme";

/** Deliveries waiting at this location, soonest expected first. Tap one to receive it. */
export default function ReceiveQueue() {
  const { state } = useSession();
  const router = useRouter();
  const c = useColors();
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const locationId = state.phase === "ready" ? state.location.storeLocationId : null;
  const userId = state.phase === "ready" ? state.user.userId : null;

  const load = useCallback(async () => {
    if (!locationId) return;
    try {
      setItems(await receivingApi.queue(locationId));
      setError(null);
    } catch (err) {
      setError(failureMessage(err));
    }
  }, [locationId]);

  // On focus, not only on mount: backing out of a delivery returns to this still-mounted screen.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (state.phase !== "ready") return null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <Column style={{ gap: space.lg }}>
        <View style={{ gap: space.xs }}>
          <Text variant="title">Deliveries</Text>
          <Text variant="meta">{state.location.locationName}</Text>
        </View>

        {error ? (
          <>
            <OfflineBanner text={error} />
            <Button label="Try again" onPress={() => void load()} />
          </>
        ) : null}
        {items === null && !error ? <Text variant="muted">Loading deliveries…</Text> : null}
        {items?.length === 0 ? (
          <View style={{ gap: space.sm }}>
            <Text style={{ fontFamily: fontFamily.title, fontSize: 20 }}>No deliveries waiting</Text>
            <Text variant="muted">Purchase orders that have been sent to a supplier appear here until they are received.</Text>
          </View>
        ) : null}

        {items && items.length > 0 ? (
          <Surface>
            {items.map((item, index) => {
              const when = expectedLabel(item.expectedDeliveryDate);
              const other = item.beingReceivedBy && item.beingReceivedBy.userId !== userId ? item.beingReceivedBy.userName : null;
              const mine = item.status === "RECEIVING" && !other;
              return (
                <Pressable
                  key={item.poId}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.supplierName ?? "Supplier"}, order ${item.poNumber}, ${item.lineCount} ${item.lineCount === 1 ? "item" : "items"}${when ? `, ${when}` : ""}${other ? `, ${other} is receiving this` : ""}`}
                  onPress={() => router.push({ pathname: "/deliveries/[poId]", params: { poId: item.poId } })}
                  style={[{ minHeight: size.tap + 14, justifyContent: "center", paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.xs }, rowDivider(index, c.border)]}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                    <Text style={{ fontFamily: fontFamily.title, fontSize: 20, flexShrink: 1 }}>{item.supplierName ?? "Supplier"}</Text>
                    {mine ? <Chip label="In progress" /> : null}
                  </View>
                  <Text variant="meta">
                    {item.poNumber} · {item.lineCount} {item.lineCount === 1 ? "item" : "items"}
                  </Text>
                  {when ? <Text variant={when === "Overdue" ? "error" : "meta"}>{when}</Text> : null}
                  {other ? <Text variant="meta">{other} is receiving this</Text> : null}
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

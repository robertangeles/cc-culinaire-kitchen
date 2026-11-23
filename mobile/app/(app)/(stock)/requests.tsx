import { useCallback } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useStock } from "../../../src/stock/StockProvider";
import type { RequestRow } from "../../../src/stock/stockStore";
import { categoryLabel, qtyText } from "../../../src/stock/stockView";
import { dayAndTime } from "../../../src/transfers/transferView";
import { attentionSentence } from "../../../src/outbox/QueueStatus";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { Chip, Surface, rowDivider } from "../../../src/ui/Surface";
import { fontFamily, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

const STATE: Record<RequestRow["state"], string> = { waiting: "Waiting to send", attention: "Needs attention", sent: "Sent for review", discarded: "Discarded", approved: "Added to the catalogue", rejected: "Not added" };

/**
 * The new items this person asked for, newest first: what HQ decided (the server's list, read each time the screen comes into view) and,
 * laid over it, the requests still on this phone with whether they were sent.
 */
export default function Requests() {
  const { store, snap } = useStock();
  const router = useRouter();
  const c = useColors();
  useFocusEffect(useCallback(() => void store.refreshRequests(), [store]));

  function discard(row: RequestRow) {
    Alert.alert(`Discard the request for ${row.itemName}?`, "It won't be sent. A record of it is kept on this phone.", [
      { text: "Keep it", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => void store.discard(row.entryId!) },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.xl }}>
        <Column style={{ gap: space.lg }}>
          <Text variant="title">My requests</Text>
          <Button label="Ask for a new item" onPress={() => router.push("/request-new")} />
          {snap.requests.length === 0 ? (
            <Text variant="muted">You haven't asked for a new item from this phone.</Text>
          ) : (
            <Surface>
              {snap.requests.map((r, index) => (
                <View key={r.requestId} style={[{ padding: space.lg, gap: space.xs }, rowDivider(index, c.border)]}>
                  <View accessible accessibilityLabel={`${r.itemName}, ${STATE[r.state]}`} style={{ gap: space.xs }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                      <Text style={{ fontFamily: fontFamily.title, fontSize: 20, flexShrink: 1 }}>{r.itemName}</Text>
                      <Chip label={STATE[r.state]} />
                    </View>
                    <Text variant="meta">{[r.category ? categoryLabel(r.category) : null, r.countedQty !== null ? `${qtyText(r.countedQty, r.baseUnit ?? "")} on hand` : null, dayAndTime(r.requestedAt)].filter(Boolean).join(" · ")}</Text>
                  </View>
                  {r.state === "rejected" && r.reviewNotes ? <Text variant="muted">HQ: {r.reviewNotes}</Text> : null}
                  {r.state === "attention" && r.entryId ? (
                    <>
                      <Text variant="error">⚠ {attentionSentence("rejected", r.attentionMessage)}</Text>
                      <Button label="Try again" onPress={() => void store.retry(r.entryId!)} />
                      <Button kind="quiet" label="Discard" onPress={() => discard(r)} />
                    </>
                  ) : null}
                </View>
              ))}
            </Surface>
          )}
          <Text variant="meta">HQ approves or rejects requests on the web. An approved item appears in the catalogue, under the name HQ gave it.</Text>
          <Button kind="quiet" label="Back" onPress={() => router.back()} />
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

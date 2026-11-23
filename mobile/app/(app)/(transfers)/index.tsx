import { useCallback, useRef, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../../src/runtime/appContext";
import { hasAnyPermission } from "../../../src/shell/tabs";
import { useTransfers } from "../../../src/transfers/TransferProvider";
import { dayAndTime, groupTransfers, statusWords, type TransferRow } from "../../../src/transfers/transferView";
import { attentionSentence } from "../../../src/outbox/QueueStatus";
import { OfflineBanner } from "../../../src/ui/Banner";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { Chip, Surface, rowDivider } from "../../../src/ui/Surface";
import { fontFamily, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/**
 * Transfers to and from this location: first what is on its way here and waits to be received, then what was sent from here, then what
 * arrived. Each row opens the transfer. Making one is for `inventory:manage` holders, as on the server.
 */
export default function Transfers() {
  const { state } = useSession();
  const { store, snap } = useTransfers();
  const router = useRouter();
  const c = useColors();
  const [refreshing, setRefreshing] = useState(false);
  // Back from a transfer (or a colleague sent one): read the server again. The provider already read it on the first visit.
  const seen = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (seen.current) void store.refresh();
      seen.current = true;
    }, [store]),
  );
  if (state.phase !== "ready") return null;
  const caps = { fontFamily: fontFamily.uiStrong, fontSize: 12, letterSpacing: 1.8, textTransform: "uppercase", color: c.accentText } as const;
  const canManage = hasAnyPermission(state.user, ["inventory:manage"]);
  const groups = groupTransfers(snap.rows, state.location.storeLocationId);

  function discard(row: TransferRow) {
    Alert.alert("Discard this change?", "It won't be sent. A record of it is kept on this phone.", [
      { text: "Keep it", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => void store.discard(row.entryId!) },
    ]);
  }

  const section = (title: string, rows: TransferRow[], empty: string) => (
    <View style={{ gap: space.xs }}>
      <Text style={caps}>{title}</Text>
      {rows.length === 0 ? (
        <Text variant="muted">{empty}</Text>
      ) : (
        <Surface>
          {rows.map((row, index) => {
            const incoming = row.toLocationId === state.location.storeLocationId;
            const other = (incoming ? row.fromLocationName : row.toLocationName) ?? "Another location";
            const items = `${row.lineCount} ${row.lineCount === 1 ? "item" : "items"}`;
            return (
              <View key={row.transferId} style={[{ paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.xs }, rowDivider(index, c.border)]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${incoming ? "From" : "To"} ${other}, ${items}, ${statusWords(row.status)}${row.sync === "waiting" ? ", waiting to send" : row.sync === "attention" ? ", needs attention" : ""}`}
                  onPress={() => router.push({ pathname: "/transfer/[transferId]", params: { transferId: row.transferId } })}
                  style={{ minHeight: size.tap, justifyContent: "center", gap: space.xs }}
                >
                  <Text style={{ fontFamily: fontFamily.title, fontSize: 20 }}>{incoming ? `From ${other}` : `To ${other}`}</Text>
                  <Text variant="meta">{`${items} · ${dayAndTime(row.createdDttm)}${row.initiatorName ? ` · ${row.initiatorName}` : ""}`}</Text>
                  {/* The status on its own line: a long one beside the name squeezed the name onto three lines. */}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                    <Chip label={statusWords(row.status)} />
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
            );
          })}
        </Surface>
      )}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await store.refresh(); setRefreshing(false); }} />}
      >
        <Column style={{ gap: space.lg }}>
          <Text variant="title">Transfers</Text>
          <Text variant="meta">{state.location.locationName}</Text>
          {snap.offline ? <OfflineBanner text="You're offline. This is the list as last downloaded; changes are saved on this phone and sent when you're back." /> : null}
          {snap.waiting > 0 ? <Text variant="muted" accessibilityLiveRegion="polite">{snap.waiting} waiting to send</Text> : null}
          {snap.attention > 0 ? <Text variant="error">⚠ {snap.attention} {snap.attention === 1 ? "change needs" : "changes need"} attention</Text> : null}
          {snap.phase === "error" ? (
            <>
              <Text variant="error">{snap.error}</Text>
              <Button label="Try again" onPress={() => void store.refresh()} />
            </>
          ) : null}
          {canManage ? <Button label="New transfer" onPress={() => router.push("/transfer-new")} /> : null}
          {snap.phase === "ready" ? (
            <>
              {groups.toReceive.length > 0 ? section("To receive", groups.toReceive, "") : null}
              {section("Sent from here", groups.outgoing, "No transfers sent from here yet.")}
              {section("Received here", groups.incoming, "Nothing received from another location yet.")}
            </>
          ) : null}
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

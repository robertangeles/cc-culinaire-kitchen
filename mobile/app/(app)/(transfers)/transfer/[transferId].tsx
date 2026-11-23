import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type { TransferDetail } from "@culinaire/shared/schemas/transfer";
import { ApiError } from "../../../../src/api/client";
import { useSession } from "../../../../src/runtime/appContext";
import { hasAnyPermission } from "../../../../src/shell/tabs";
import { useTransfers } from "../../../../src/transfers/TransferProvider";
import { checkReceipt, dayAndTime, statusWords } from "../../../../src/transfers/transferView";
import { attentionSentence } from "../../../../src/outbox/QueueStatus";
import { qtyText } from "../../../../src/stock/stockView";
import { OfflineBanner } from "../../../../src/ui/Banner";
import { Button } from "../../../../src/ui/Button";
import { Column } from "../../../../src/ui/Column";
import { Text } from "../../../../src/ui/Text";
import { TextField } from "../../../../src/ui/TextField";
import { Chip, Surface, rowDivider } from "../../../../src/ui/Surface";
import { fontFamily, space } from "../../../../src/theme";
import { useColors } from "../../../../src/ui/theme";

type Lines = { lineId: string; ingredientName: string; sentQty: number; sentUnit: string; receivedQty: number | null }[];

const signed = (n: number, unit: string) => `${n > 0 ? "Over by" : "Short by"} ${qtyText(Math.abs(n), unit)}`;

/**
 * One transfer. From the location it leaves: send it or cancel it (`inventory:manage`). At the location it is going to, once sent: say what
 * arrived, line by line (each starts at what was sent; 0 for a line that never came), and confirm. Every action is saved on the phone at once.
 */
export default function TransferScreen() {
  const { state } = useSession();
  const { store, snap } = useTransfers();
  const router = useRouter();
  const c = useColors();
  const { transferId } = useLocalSearchParams<{ transferId: string }>();
  const id = Array.isArray(transferId) ? transferId[0] : (transferId ?? "");
  const [detail, setDetail] = useState<TransferDetail | null>(null);
  const [lines, setLines] = useState<Lines | null>(null);
  const [offline, setOffline] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [error, setError] = useState<{ lineId?: string; message: string } | null>(null);
  const row = snap.rows.find((r) => r.transferId === id);
  const madeHere = row?.pending === "create" && row.sync !== "synced";

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const local = madeHere ? await store.localLines(id) : null;
        if (local) return live && setLines(local.map((l, i) => ({ lineId: String(i), ingredientName: l.ingredientName, sentQty: l.sentQty, sentUnit: l.sentUnit, receivedQty: null })));
        const got = await store.detail(id);
        if (!live) return;
        setOffline(got.offline);
        setDetail(got.detail);
        setLines(got.detail?.lines ?? null);
        setTyped(Object.fromEntries((got.detail?.lines ?? []).map((l) => [l.lineId, String(l.sentQty)])));
      } catch (err) {
        if (live) setLoadError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      }
    })();
    return () => void (live = false);
    // Read again once the queue has sent what was waiting (the row's status changes).
  }, [id, madeHere, row?.status, row?.sync, store]);

  if (state.phase !== "ready") return null;
  const here = state.location.storeLocationId;
  const canManage = hasAnyPermission(state.user, ["inventory:manage"]);
  const caps = { fontFamily: fontFamily.uiStrong, fontSize: 12, letterSpacing: 1.8, textTransform: "uppercase", color: c.accentText } as const;
  const status = row?.status ?? detail?.status ?? "";
  const from = row?.fromLocationName ?? detail?.fromLocationName ?? "Another location";
  const to = row?.toLocationName ?? detail?.toLocationName ?? "Another location";
  const settled = !row?.pending || row.sync === "synced";
  // A transfer saved on this phone and not sent yet can be sent or cancelled too: the queue sends them in order (a cancel drops it unsent).
  const canSendOrCancel = canManage && (settled || (row?.pending === "create" && row.sync === "waiting")) && status === "INITIATED" && (row?.fromLocationId ?? detail?.fromLocationId) === here;
  const canReceive = settled && status === "SENT" && (row?.toLocationId ?? detail?.toLocationId) === here && detail !== null;
  const check = detail && canReceive ? checkReceipt(detail.lines, typed) : null;
  const differs = new Map(check?.ok ? check.differences.map((d) => [d.lineId, d.difference]) : []);

  function confirmCancel() {
    Alert.alert("Cancel this transfer?", `Nothing leaves ${from}. It can't be sent after this.`, [
      { text: "Keep it", style: "cancel" },
      { text: "Cancel transfer", style: "destructive", onPress: () => void store.cancel(id).then(() => router.back()) },
    ]);
  }

  async function receive() {
    if (!detail) return;
    const result = await store.receive(detail, typed);
    if (!result.ok) return setError({ lineId: result.lineId, message: result.message });
    router.back();
  }

  function discard() {
    Alert.alert("Discard this change?", "It won't be sent. A record of it is kept on this phone.", [
      { text: "Keep it", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => void store.discard(row!.entryId!) },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
          <Column style={{ gap: space.lg }}>
            <Text variant="title">{`${from} to ${to}`}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, alignItems: "center" }}>
              {status ? <Chip label={statusWords(status)} /> : null}
              {row?.sync === "waiting" ? <Chip label="Waiting to send" /> : null}
            </View>
            {row ? <Text variant="meta">{`Made ${dayAndTime(row.createdDttm)}${row.initiatorName ? ` by ${row.initiatorName}` : ""}`}</Text> : null}
            {offline ? <OfflineBanner text="You're offline. This is the transfer as last opened on this phone." /> : null}
            {row?.sync === "attention" && row.entryId ? (
              <>
                <Text variant="error">⚠ {attentionSentence("rejected", row.attentionMessage)}</Text>
                <Button label="Try again" onPress={() => void store.retry(row.entryId!)} />
                <Button kind="quiet" label="Discard" onPress={discard} />
              </>
            ) : null}
            {loadError ? <Text variant="error">{loadError}</Text> : null}
            {(row?.notes ?? detail?.notes) ? <Text variant="muted">Note: {row?.notes ?? detail?.notes}</Text> : null}

            {lines === null && !loadError ? (
              <Text variant="muted">{offline ? "This transfer has not been opened on this phone before. Open it once with a signal." : "Loading…"}</Text>
            ) : null}
            {lines ? (
              <View style={{ gap: space.xs }}>
                <Text style={caps}>{canReceive ? "What arrived" : "Items"}</Text>
                <Surface>
                  {lines.map((line, index) => {
                    const diff = differs.get(line.lineId);
                    return (
                      <View key={line.lineId} style={[{ padding: space.lg, gap: space.sm }, rowDivider(index, c.border)]}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                          <Text style={{ fontFamily: fontFamily.title, fontSize: 20, flexShrink: 1 }}>{line.ingredientName || "An item no longer in the catalogue"}</Text>
                          <Text style={{ fontFamily: fontFamily.uiStrong }}>Sent {qtyText(line.sentQty, line.sentUnit)}</Text>
                        </View>
                        {canReceive ? (
                          <>
                            <TextField label={`${line.ingredientName || "Item"} received, in ${line.sentUnit}`} value={typed[line.lineId] ?? ""} onChangeText={(t) => { setError(null); setTyped((m) => ({ ...m, [line.lineId]: t })); }} keyboardType="decimal-pad" returnKeyType="done" />
                            {diff !== undefined ? <Text variant="error">{signed(diff, line.sentUnit)}</Text> : null}
                            {error?.lineId === line.lineId ? <Text variant="error" accessibilityLiveRegion="polite">{error.message}</Text> : null}
                          </>
                        ) : line.receivedQty !== null ? (
                          <Text variant={Math.abs(line.receivedQty - line.sentQty) > 0.001 ? "error" : "meta"}>Received {qtyText(line.receivedQty, line.sentUnit)}</Text>
                        ) : null}
                      </View>
                    );
                  })}
                </Surface>
              </View>
            ) : null}

            {canReceive ? (
              <>
                {differs.size > 0 ? <Text variant="muted">{differs.size === 1 ? "One item differs" : `${differs.size} items differ`} from what was sent. The transfer will be marked as received with differences.</Text> : null}
                {error && !error.lineId ? <Text variant="error">{error.message}</Text> : null}
                <Button label="Confirm received" onPress={() => void receive()} />
              </>
            ) : null}
            {canSendOrCancel ? (
              <>
                <Button label="Send now" onPress={() => void store.send(id).then(() => router.back())} />
                <Button kind="danger" label="Cancel transfer" onPress={confirmCancel} />
              </>
            ) : null}
            {!canManage && status === "INITIATED" && (row?.fromLocationId ?? detail?.fromLocationId) === here ? <Text variant="muted">A manager sends or cancels this transfer.</Text> : null}
            <Button kind="quiet" label="Back to transfers" onPress={() => router.back()} />
          </Column>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

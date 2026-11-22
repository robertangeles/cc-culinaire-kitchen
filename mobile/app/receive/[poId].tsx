import { useState } from "react";
import { Alert, Linking, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../src/runtime/appContext";
import { receivingApi } from "../../src/runtime/receiving";
import { useReceivingSession } from "../../src/receiving/useReceivingSession";
import { LineCard } from "../../src/receiving/LineCard";
import { confirmedMessage, issueCount } from "../../src/receiving/receivingFlow";
import { OfflineBanner } from "../../src/ui/Banner";
import { Button } from "../../src/ui/Button";
import { Surface, rowDivider } from "../../src/ui/Surface";
import { Text } from "../../src/ui/Text";
import { space } from "../../src/theme";
import { useColors } from "../../src/ui/theme";

/**
 * Receive one delivery. Every line starts as "received in full", so a perfect delivery is: open, confirm.
 * Backing out leaves the delivery open (it shows "In progress" in the queue); Cancel receiving discards it.
 */
export default function ReceiveDelivery() {
  const { poId } = useLocalSearchParams<{ poId: string }>();
  const { state } = useSession();
  const router = useRouter();
  const c = useColors();
  const [openId, setOpenId] = useState<string | null>(null);
  const userId = state.phase === "ready" ? state.user.userId : -1;
  const r = useReceivingSession(receivingApi, poId, userId);

  const toQueue = () => router.replace("/receive");

  if (r.phase.kind === "loading") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, padding: space.xl }}>
        <Text variant="muted">Opening the delivery…</Text>
      </SafeAreaView>
    );
  }
  if (r.phase.kind === "error" || r.phase.kind === "gone") {
    const gone = r.phase.kind === "gone";
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, padding: space.xl, gap: space.lg }}>
        <Text variant="title">{gone ? "Already done" : "Couldn't open this delivery"}</Text>
        <Text>{r.phase.message}</Text>
        {gone ? null : <Button label="Try again" onPress={() => void r.reload()} />}
        <Button kind={gone ? "primary" : "quiet"} label="Back to deliveries" onPress={toQueue} />
      </SafeAreaView>
    );
  }
  if (r.phase.kind === "done") {
    const done = confirmedMessage(r.phase.result);
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, padding: space.xl, gap: space.lg, justifyContent: "center" }}>
        <Text variant="title" accessibilityLiveRegion="polite">{done.title}</Text>
        <Text>{r.po?.supplierName ? `${r.po.supplierName}, ` : ""}order {r.po?.poNumber}</Text>
        <Text variant="muted">{done.detail}</Text>
        <Button label="Back to deliveries" onPress={toQueue} />
      </SafeAreaView>
    );
  }

  const issues = issueCount(r.lines);
  const phone = r.po?.supplierPhone;
  const cancel = () =>
    Alert.alert("Cancel receiving?", "Nothing will be added to stock and the order goes back to the list.", [
      { text: "Keep receiving", style: "cancel" },
      { text: "Cancel receiving", style: "destructive", onPress: () => void r.cancel().then((ok) => ok && toQueue()) },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: space.xs }}>
          <Text variant="title">{r.po?.supplierName ?? "Delivery"}</Text>
          <Text variant="meta">Order {r.po?.poNumber} · {r.lines.length} {r.lines.length === 1 ? "item" : "items"}</Text>
        </View>
        {r.otherStarter ? <OfflineBanner text={`${r.otherStarter} started this delivery on another phone. Anything you change is saved to the same delivery.`} /> : null}
        {phone ? <Button kind="quiet" label={`Call ${r.po?.supplierName ?? "supplier"}`} onPress={() => void Linking.openURL(`tel:${phone}`)} /> : null}

        <Surface>
          {r.lines.map((line, i) => (
            <View key={line.receivingLineId} style={rowDivider(i, c.border)}>
              <LineCard
                line={line}
                open={openId === line.receivingLineId}
                saving={r.saving.has(line.receivingLineId)}
                error={r.lineErrors[line.receivingLineId]}
                onToggle={() => setOpenId(openId === line.receivingLineId ? null : line.receivingLineId)}
                onSubmit={(input) => r.act(line.receivingLineId, input)}
              />
            </View>
          ))}
        </Surface>

        {r.confirmError ? <Text variant="error" accessibilityLiveRegion="polite">{r.confirmError}</Text> : null}
        <Button
          label={r.confirming ? "Confirming…" : issues > 0 ? `Confirm delivery · ${issues} ${issues === 1 ? "issue" : "issues"}` : "Confirm delivery"}
          disabled={r.confirming || r.saving.size > 0}
          onPress={() => void r.confirm()}
        />
        <Button kind="quiet" label="Back to deliveries" onPress={() => router.back()} />
        <Button kind="quiet" label="Cancel receiving" onPress={cancel} />
      </ScrollView>
    </SafeAreaView>
  );
}

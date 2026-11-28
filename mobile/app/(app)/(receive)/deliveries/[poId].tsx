import { useState } from "react";
import { Alert, Linking, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { RECEIVING_TEXT_MAX, receivingText, receivingTextProblem } from "@culinaire/shared";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../../../src/runtime/appContext";
import { receivingApi } from "../../../../src/runtime/receiving";
import { useReceivingSession } from "../../../../src/receiving/useReceivingSession";
import { LineCard } from "../../../../src/receiving/LineCard";
import { canOpen, moduleTabs } from "../../../../src/shell/tabs";
import { confirmedMessage, issueCount } from "../../../../src/receiving/receivingFlow";
import { OfflineBanner } from "../../../../src/ui/Banner";
import { Button } from "../../../../src/ui/Button";
import { Column } from "../../../../src/ui/Column";
import { Surface, rowDivider } from "../../../../src/ui/Surface";
import { Text } from "../../../../src/ui/Text";
import { TextField } from "../../../../src/ui/TextField";
import { space } from "../../../../src/theme";
import { useColors } from "../../../../src/ui/theme";

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
  const [panelOpen, setPanelOpen] = useState(false);
  const [docket, setDocket] = useState("");
  const userId = state.phase === "ready" ? state.user.userId : -1;
  const r = useReceivingSession(receivingApi, poId, userId);

  const toQueue = () => router.replace("/deliveries");
  // The order this delivery is for, where its discrepancies are credited: for the people who have the Orders tab.
  const ordersTab = moduleTabs.find((t) => t.route === "(orders)")!;
  const seeOrder =
    state.phase === "ready" && canOpen(state.user, ordersTab) ? <Button kind="quiet" label="See the order" onPress={() => router.push({ pathname: "/order", params: { poId, from: "link" } })} /> : null;

  if (r.phase.kind === "loading") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, padding: space.xl }}>
        <Column>
          <Text variant="muted">Opening the delivery…</Text>
        </Column>
      </SafeAreaView>
    );
  }
  if (r.phase.kind === "error" || r.phase.kind === "gone") {
    const gone = r.phase.kind === "gone";
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, padding: space.xl }}>
        <Column style={{ gap: space.lg }}>
          <Text variant="title">{r.phase.kind === "gone" ? r.phase.title : "Couldn't open this delivery"}</Text>
          <Text>{r.phase.message}</Text>
          {gone ? null : <Button label="Try again" onPress={() => void r.reload()} />}
          <Button kind={gone ? "primary" : "quiet"} label="Back to deliveries" onPress={toQueue} />
        </Column>
      </SafeAreaView>
    );
  }
  if (r.phase.kind === "done") {
    const done = confirmedMessage(r.phase.result);
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, padding: space.xl }}>
        <Column style={{ gap: space.lg }}>
          <Text variant="title" accessibilityLiveRegion="polite">{done.title}</Text>
          <Text>{r.po?.supplierName ? `${r.po.supplierName}, ` : ""}order {r.po?.poNumber}</Text>
          <Text variant="muted">{done.detail}</Text>
          <Button label="Back to deliveries" onPress={toQueue} />
          {seeOrder}
        </Column>
      </SafeAreaView>
    );
  }

  const issues = issueCount(r.lines);
  const docketProblem = receivingTextProblem("docket", docket);
  const phone = r.po?.supplierPhone;
  const cancel = () =>
    Alert.alert("Cancel receiving?", "Nothing will be added to stock and the order goes back to the list.", [
      { text: "Keep receiving", style: "cancel" },
      { text: "Cancel receiving", style: "destructive", onPress: () => void r.cancel().then((ok) => ok && toQueue()) },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
        <Column style={{ gap: space.lg }}>
        {panelOpen ? null : (
          <>
        <View style={{ gap: space.xs }}>
          <Text variant="title">{r.po?.supplierName ?? "Delivery"}</Text>
          <Text variant="meta">Order {r.po?.poNumber} · {r.lines.length} {r.lines.length === 1 ? "item" : "items"}</Text>
        </View>
        {r.otherStarter ? <OfflineBanner text={`${r.otherStarter} started this delivery on another phone. Anything you change is saved to the same delivery.`} /> : null}
        {phone ? <Button kind="quiet" label={`Call ${r.po?.supplierName ?? "supplier"}`} onPress={() => void Linking.openURL(`tel:${phone}`)} /> : null}
          </>
        )}

        <Surface>
          {r.lines.map((line, i) => (
            // While a keypad or reject panel is open only that line shows, so the panel is not pushed below the fold.
            <View key={line.receivingLineId} style={[rowDivider(i, c.border), panelOpen && openId !== line.receivingLineId ? { display: "none" } : null]}>
              <LineCard
                line={line}
                orderUnitCost={r.po?.lines.find((l) => l.lineId === line.poLineId)?.unitCost ?? null}
                open={openId === line.receivingLineId}
                saving={r.saving.has(line.receivingLineId)}
                receivedAt={r.session?.startedAt ?? new Date().toISOString()}
                error={r.lineErrors[line.receivingLineId]}
                onToggle={() => setOpenId(openId === line.receivingLineId ? null : line.receivingLineId)}
                onPanel={setPanelOpen}
                onSubmit={(input) => r.act(line.receivingLineId, input)}
              />
            </View>
          ))}
        </Surface>

        {panelOpen ? null : (
          <>
            <View style={{ gap: space.xs }}>
              <TextField label="Supplier docket number" value={docket} onChangeText={setDocket} maxLength={RECEIVING_TEXT_MAX} autoCapitalize="characters" autoCorrect={false} placeholder="Optional" />
              {docketProblem ? <Text variant="error">{docketProblem.message}</Text> : null}
            </View>
            {seeOrder}
            <Button kind="quiet" label="Back to deliveries" onPress={() => router.back()} />
            <Button kind="quiet" label="Cancel receiving" onPress={cancel} />
          </>
        )}
        </Column>
      </ScrollView>
      {/* Pinned, as on the web: Confirm is always under the thumb, however long the delivery. Hidden while a
          keypad or reject panel is open, so a stray tap cannot confirm a delivery that is half way through a line. */}
      {panelOpen ? null : (
      <View style={{ paddingVertical: space.lg, paddingHorizontal: space.xl, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.bg }}>
        <Column style={{ gap: space.sm }}>
        {r.confirmError ? <Text variant="error" accessibilityLiveRegion="polite">{r.confirmError}</Text> : null}
        <Button
          label={r.confirming ? "Confirming…" : issues > 0 ? `Confirm delivery · ${issues} ${issues === 1 ? "issue" : "issues"}` : "Confirm delivery"}
          disabled={r.confirming || r.saving.size > 0 || docketProblem !== null}
          onPress={() => void r.confirm(receivingText(docket))}
        />
        </Column>
      </View>
      )}
    </SafeAreaView>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Linking, RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { reorderCheckLine } from "@culinaire/shared";
import type { Discrepancy } from "@culinaire/shared/schemas/purchasing";
import { useAppLock } from "../../../src/lock/LockProvider";
import { useSession } from "../../../src/runtime/appContext";
import { DiscrepancyRows } from "../../../src/orders/DiscrepancyRows";
import { WaitBadge } from "../../../src/orders/OrderRow";
import { useOrders } from "../../../src/orders/OrdersProvider";
import { APPROVE_BLOCKED, calendarDay, dayLabel, itemCount, lineFacts, money, orderActions, receipt, statusLabel } from "../../../src/orders/orderView";
import { useOrder } from "../../../src/orders/useOrder";
import { OfflineBanner } from "../../../src/ui/Banner";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { Chip, Surface, rowDivider } from "../../../src/ui/Surface";
import { Text } from "../../../src/ui/Text";
import { TextField } from "../../../src/ui/TextField";
import { fontFamily, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

const asText = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** A label over a short fact, in the two-column grid under the title. */
function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={{ minWidth: 140, gap: 2 }}>
      <Text variant="label">{label}</Text>
      <Text style={{ fontFamily: fontFamily.ui }}>{value}</Text>
    </View>
  );
}

/** One purchase order: what was ordered, what it costs where the server says, and what this person may do with it now. */
export default function Order() {
  const params = useLocalSearchParams<{ poId?: string; notice?: string; info?: string; from?: string }>();
  const poId = asText(params.poId);
  const { state } = useSession();
  const { api, rights, known } = useOrders();
  const { confirm: confirmPerson } = useAppLock();
  const router = useRouter();
  const c = useColors();
  const { order, lines, detail, error, busy, notice, setNotice, load, act } = useOrder(api, poId, known(poId));
  const [refreshing, setRefreshing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [toCredit, setToCredit] = useState<Discrepancy[]>([]);

  // What the screen was opened to say: what went wrong (a draft saved but not submitted), or what to know (items a reorder left out).
  const bad = asText(params.notice);
  const said = bad || asText(params.info);
  useEffect(() => {
    if (said) setNotice({ text: said, bad: bad !== "" });
  }, [said, bad, setNotice]);

  const supplierId = detail?.supplierId;
  const received = detail?.status === "RECEIVED" || detail?.status === "PARTIAL_RECEIVED";
  const loadCredits = useCallback(async () => {
    if (!rights.credit || !received || !supplierId) return setToCredit([]);
    // The server filters by supplier; one supplier's first page covers an order being credited now.
    const open = await api.discrepancies(0, supplierId).catch(() => []);
    setToCredit(open.filter((d) => d.poId === poId));
  }, [api, rights.credit, received, supplierId, poId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useFocusEffect(
    useCallback(() => {
      void loadCredits();
    }, [loadCredits]),
  );

  if (state.phase !== "ready") return null;

  if (!order) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <Column style={{ padding: space.xl, gap: space.lg }}>
          {error ? (
            <>
              <Text variant="title">Couldn&apos;t open this order</Text>
              <Text>{error}</Text>
              <Button label="Try again" onPress={() => void load()} />
              <Button kind="quiet" label="Back to orders" onPress={() => router.dismissTo("/(app)/(orders)")} />
            </>
          ) : (
            <Text variant="muted">Opening the order…</Text>
          )}
        </Column>
      </SafeAreaView>
    );
  }

  const now = Date.now();
  // With only the list's row there is no certain status to act on: the buttons wait for the order itself.
  const can = detail ? orderActions(order, rights, now) : null;
  const supplier = order.supplierName ?? "Unknown supplier";
  const signed = detail ? receipt(detail) : null;
  const total = money(order.totalValue);
  const otherChef = order.beingReceivedBy && order.beingReceivedBy.userId !== state.user.userId ? order.beingReceivedBy.userName : null;

  const submit = () => act("submit", "Submitting an order", async () => ((await api.submit(poId)).status === "PENDING_APPROVAL" ? "This order needs approval first. The approvers have been told." : "Order submitted. It is now marked as sent."));
  const email = () =>
    act("email", "Emailing the supplier", async () => {
      const reply = await api.email(poId);
      return reply.emailed ? `Emailed to ${reply.to ?? supplier}.` : { text: reply.message ?? "The order was not emailed.", bad: true };
    });
  const confirmThen = (title: string, text: string, yes: string, run: () => unknown, destructive = false) =>
    Alert.alert(title, text, [
      { text: "Go back", style: "cancel" },
      { text: yes, style: destructive ? "destructive" : "default", onPress: () => void run() },
    ]);
  const approve = () =>
    confirmThen(`Approve ${order.poNumber}?`, `${supplier}${total ? `, ${total}` : ""}. It is marked as sent.`, "Approve", async () => {
      if (!(await confirmPerson(`Approve ${order.poNumber}`))) return;
      await act("approve", "Approving an order", async () => { await api.approve(poId); return "Order approved. It is now marked as sent."; });
    });
  const reject = async () => {
    if (!(await confirmPerson(`Reject ${order.poNumber}`))) return;
    const done = await act("reject", "Rejecting an order", async () => { await api.reject(poId, reason.trim()); return "Order rejected. It is back in draft with your reason."; });
    if (done) {
      setRejecting(false);
      setReason("");
    }
  };
  const cancel = () => confirmThen(`Cancel ${order.poNumber}?`, "The order is closed and can't be brought back.", "Cancel order", () => act("cancel", "Cancelling an order", async () => { await api.cancel(poId); return "Order cancelled."; }), true);
  const reorder = async () => {
    const copies: { poId: string; skippedItems: string[]; quantityWarnings: { ingredientName: string | null }[] }[] = [];
    if (!(await act("reorder", "Reordering", async () => void copies.push(await api.clone(poId, state.location.storeLocationId))))) return;
    const [copy] = copies;
    const left = copy.skippedItems.length;
    const info = [left > 0 ? `${itemCount(left)} left out: already at or above par.` : null, reorderCheckLine(copy.quantityWarnings)].filter(Boolean).join(" ");
    router.push({ pathname: "/order", params: { poId: copy.poId, ...(info ? { info } : {}) } });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          contentContainerStyle={{ padding: space.xl }}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await Promise.all([load(), loadCredits()]); setRefreshing(false); }} />}
        >
          <Column style={{ gap: space.lg }}>
            <ScreenHeader label={`Order ${order.poNumber}`} title={supplier} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
              <Chip label={statusLabel(order.status)} />
              {order.status === "PENDING_APPROVAL" ? <WaitBadge submittedAt={order.submittedAt} now={now} /> : null}
            </View>

            {notice ? notice.bad ? <Text variant="error" accessibilityLiveRegion="polite">{notice.text}</Text> : <Text accessibilityLiveRegion="polite" style={{ color: c.success }}>{notice.text}</Text> : null}
            {error ? (
              <>
                <OfflineBanner text={`${error} Changes need a connection.`} />
                <Button kind="ghost" label="Try again" onPress={() => void load()} />
              </>
            ) : null}
            {order.rejectedReason && order.status === "DRAFT" ? (
              <Surface>
                <View style={{ padding: space.lg, gap: space.xs }}>
                  <Text variant="label">Not approved</Text>
                  <Text>{order.rejectedReason}</Text>
                </View>
              </Surface>
            ) : null}

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lg }}>
              <Fact label="Location" value={order.locationName} />
              <Fact label="Total" value={total} />
              <Fact label="Raised by" value={[order.createdByUserName, dayLabel(order.createdDttm)].filter(Boolean).join(", ") || null} />
              <Fact label="Expected" value={calendarDay(order.expectedDeliveryDate)} />
              <Fact label="Emailed" value={dayLabel(order.supplierEmailedAt)} />
            </View>
            {signed ? <Text variant="meta">{signed}</Text> : null}
            {otherChef ? <Text variant="meta">{otherChef} is receiving this</Text> : null}

            {order.notes ? (
              <View style={{ gap: space.xs }}>
                <Text variant="label">Notes</Text>
                <Text>{order.notes}</Text>
              </View>
            ) : null}

            <View style={{ gap: space.xs }}>
              <Text variant="label">{lines ? itemCount(lines.length) : "Items"}</Text>
              {lines ? (
                <Surface>
                  {lines.map((line, i) => {
                    const f = lineFacts(line);
                    return (
                      <View key={line.lineId} style={[{ paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.xs }, rowDivider(i, c.border)]}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                          <Text variant="heading" style={{ flexShrink: 1 }}>{line.ingredientName ?? "Item"}</Text>
                          <Text style={{ fontFamily: fontFamily.uiStrong }}>{f.ordered}</Text>
                        </View>
                        {f.price || f.paid ? (
                          <Text variant="meta">
                            {f.price}
                            {f.paid ? <Text style={{ fontFamily: fontFamily.uiStrong, color: f.paid.up ? c.danger : c.success }}>{`${f.price ? ", " : ""}${f.paid.text}`}</Text> : null}
                          </Text>
                        ) : null}
                        {f.received || f.status ? <Text variant="meta">{[f.status === "Received" ? null : f.status, f.received].filter(Boolean).join(", ")}</Text> : null}
                      </View>
                    );
                  })}
                </Surface>
              ) : (
                <Text variant="muted">{error ? "The items need a connection." : "Loading the items…"}</Text>
              )}
            </View>

            {toCredit.length > 0 ? (
              <View style={{ gap: space.xs }}>
                <Text variant="label">To claim from the supplier</Text>
                <DiscrepancyRows items={toCredit} onPress={(d) => router.push({ pathname: "/credit-note-entry", params: { discrepancyId: d.discrepancyId, supplierId: d.supplierId } })} hideOrder />
              </View>
            ) : null}

            {rejecting ? (
              <View style={{ gap: space.md }}>
                <TextField label="Why is it not approved?" value={reason} onChangeText={setReason} maxLength={2000} multiline placeholder="The person who raised it sees this" />
                <Button kind="danger" label={busy === "reject" ? "Rejecting…" : "Reject order"} disabled={busy !== null || reason.trim() === ""} onPress={() => void reject()} />
                <Button kind="quiet" label="Go back" onPress={() => setRejecting(false)} />
              </View>
            ) : can ? (
              <View style={{ gap: space.md }}>
                {can.submit ? <Button label={busy === "submit" ? "Submitting…" : "Submit order"} disabled={busy !== null} onPress={() => void submit()} /> : null}
                {can.edit ? <Button kind="ghost" label="Change order" disabled={busy !== null} onPress={() => router.push({ pathname: "/order-edit", params: { poId } })} /> : null}
                {can.approve ? <Button label={busy === "approve" ? "Approving…" : "Approve"} disabled={busy !== null} onPress={approve} /> : null}
                {can.approveBlocked ? <Text variant="muted">{APPROVE_BLOCKED}</Text> : null}
                {can.reject ? <Button kind="ghost" label="Reject" disabled={busy !== null} onPress={() => setRejecting(true)} /> : null}
                {can.receive ? <Button label="Receive delivery" disabled={busy !== null} onPress={() => router.push({ pathname: "/deliveries/[poId]", params: { poId } })} /> : null}
                {can.email ? <Button kind="ghost" label={busy === "email" ? "Emailing…" : order.supplierEmailedAt ? "Email supplier again" : "Email to supplier"} disabled={busy !== null} onPress={() => void email()} /> : null}
                {can.reorder ? <Button kind="ghost" label={busy === "reorder" ? "Reordering…" : "Reorder"} disabled={busy !== null} onPress={() => void reorder()} /> : null}
                {order.supplierPhone && (order.status === "SENT" || order.status === "RECEIVING") ? <Button kind="quiet" label={`Call ${supplier}`} onPress={() => void Linking.openURL(`tel:${order.supplierPhone}`)} /> : null}
                {can.cancel ? <Button kind="danger" label="Cancel order" disabled={busy !== null} onPress={cancel} /> : null}
              </View>
            ) : null}
            {/* Opened from the inbox or a delivery, this tab may hold nothing but this order: its way out is the list. */}
            {rejecting ? null : asText(params.from) ? <Button kind="quiet" label="All orders" onPress={() => router.dismissTo("/(app)/(orders)")} /> : <Button kind="quiet" label="Back" onPress={() => router.back()} />}
          </Column>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

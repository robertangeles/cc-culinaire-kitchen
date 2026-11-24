import { Pressable, View } from "react-native";
import type { OrderSummary } from "@culinaire/shared/schemas/purchasing";
import { expectedLabel } from "../receiving/receivingFlow";
import { fontFamily, radius, size, space } from "../theme";
import { Chip, rowDivider } from "../ui/Surface";
import { Text } from "../ui/Text";
import { useColors } from "../ui/theme";
import { APPROVE_BLOCKED, dayLabel, itemCount, money, statusLabel, waiting } from "./orderView";

/** How long an order has waited for approval: saffron over a day, ember over two. The words say it too. */
export function WaitBadge({ submittedAt, now }: { submittedAt: string | null; now: number }) {
  const c = useColors();
  const wait = waiting(submittedAt, now);
  if (!wait) return null;
  if (wait.tone === "calm") return <Text variant="meta">{wait.label}</Text>;
  const [fill, ink] = wait.tone === "red" ? [c.danger, c.bg] : [c.warningFill, c.onWarning];
  return (
    <View style={{ alignSelf: "flex-start", backgroundColor: fill, borderRadius: radius.banner, paddingHorizontal: space.md, paddingVertical: space.xs }}>
      <Text style={{ fontFamily: fontFamily.uiStrong, color: ink }}>{wait.label}</Text>
    </View>
  );
}

/** One order in a list. `queue` is the approvals queue: every row is waiting, so it says who asked and for how long instead of the status. */
export function OrderRow({ order, index, now, queue, onPress }: { order: OrderSummary; index: number; now: number; queue?: boolean; onPress: () => void }) {
  const c = useColors();
  const total = money(order.totalValue);
  const supplier = order.supplierName ?? "Unknown supplier";
  const when = order.status === "SENT" || order.status === "RECEIVING" ? expectedLabel(order.expectedDeliveryDate) : null;
  const created = dayLabel(order.createdDttm);
  const wait = waiting(order.status === "PENDING_APPROVAL" ? order.submittedAt : null, now);
  const second = queue ? [order.createdByUserName && `By ${order.createdByUserName}`].filter(Boolean).join(" · ") : when ?? created;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[supplier, `order ${order.poNumber}`, queue ? null : statusLabel(order.status), itemCount(order.lineCount), total, wait?.label, second].filter(Boolean).join(", ")}
      onPress={onPress}
      style={({ pressed }) => [{ minHeight: size.tap + 14, justifyContent: "center", paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.xs, backgroundColor: pressed ? c.surface : undefined }, rowDivider(index, c.border)]}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
        <Text variant="heading" style={{ flexShrink: 1 }}>{supplier}</Text>
        {total ? <Text style={{ fontFamily: fontFamily.uiStrong }}>{total}</Text> : null}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: space.sm }}>
        <Text variant="meta" style={{ flexShrink: 1 }}>{order.poNumber} · {itemCount(order.lineCount)}</Text>
        {queue ? null : <Chip label={statusLabel(order.status)} />}
      </View>
      {second ? <Text variant={when === "Overdue" ? "error" : "meta"}>{second}</Text> : null}
      {wait ? <WaitBadge submittedAt={order.submittedAt} now={now} /> : null}
      {queue && order.canApprove === false ? <Text variant="muted">{APPROVE_BLOCKED}</Text> : null}
    </Pressable>
  );
}

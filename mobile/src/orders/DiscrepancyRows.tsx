import { Pressable, View } from "react-native";
import type { Discrepancy } from "@culinaire/shared/schemas/purchasing";
import { fontFamily, size, space } from "../theme";
import { Surface, rowDivider } from "../ui/Surface";
import { Text } from "../ui/Text";
import { useColors } from "../ui/theme";
import { dayLabel, discrepancyText, money } from "./orderView";

/** Delivery problems that can be claimed from the supplier. One with no price is listed but cannot be opened: the server has nothing to check a credit against. */
export function DiscrepancyRows({ items, onPress, hideOrder }: { items: Discrepancy[]; onPress: (d: Discrepancy) => void; hideOrder?: boolean }) {
  const c = useColors();
  return (
    <Surface>
      {items.map((d, i) => {
        const worth = money(d.maxCreditAmount);
        const name = d.ingredientName ?? "Item";
        const where = hideOrder ? null : [d.supplierName, d.poNumber, d.locationName, dayLabel(d.createdAt)].filter(Boolean).join(" · ");
        const body = (
          <>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
              <Text variant="heading" style={{ flexShrink: 1 }}>{name}</Text>
              {worth ? <Text style={{ fontFamily: fontFamily.uiStrong }}>{`up to ${worth}`}</Text> : null}
            </View>
            <Text variant="meta">{discrepancyText(d)}</Text>
            {where ? <Text variant="meta">{where}</Text> : null}
            {worth ? null : <Text variant="muted">No price on this line, so a credit can&apos;t be checked against it.</Text>}
          </>
        );
        const style = [{ minHeight: size.tap + 14, justifyContent: "center" as const, paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.xs }, rowDivider(i, c.border)];
        return worth ? (
          <Pressable key={d.discrepancyId} accessibilityRole="button" accessibilityLabel={`${name}, ${discrepancyText(d)}, worth up to ${worth}. Raise a credit note`} onPress={() => onPress(d)} style={style}>
            {body}
          </Pressable>
        ) : (
          <View key={d.discrepancyId} style={style}>{body}</View>
        );
      })}
    </Surface>
  );
}

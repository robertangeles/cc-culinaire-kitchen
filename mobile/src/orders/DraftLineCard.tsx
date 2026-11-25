import { Pressable, View } from "react-native";
import type { OrderGuideItem, OrderItem } from "@culinaire/shared/schemas/purchasing";
import { formatMoney, formatQty } from "../receiving/receivingFlow";
import { fontFamily, size, space } from "../theme";
import { Button } from "../ui/Button";
import { ChoiceChips } from "../ui/ChoiceChips";
import { Text } from "../ui/Text";
import { TextField } from "../ui/TextField";
import { lineTotal, toPar, typedNumber, unitsOf, withUnit, type DraftLine } from "./draft";

interface Props {
  line: DraftLine;
  item: OrderItem | undefined;
  guide: OrderGuideItem | undefined;
  open: boolean;
  onToggle: () => void;
  onChange: (line: DraftLine) => void;
  onRemove: () => void;
}

/** One line of the order being written: a row to read, opened to change its quantity, unit or price. A stock or par figure the server left out is not shown. */
export function DraftLineCard({ line, item, guide, open, onToggle, onChange, onRemove }: Props) {
  const qty = typedNumber(line.qty) ?? 0;
  const total = lineTotal(line);
  const base = guide?.baseUnit || item?.baseUnit || line.unit;
  const stock = guide ? guide.onHand : item?.currentQty ?? null;
  const par = guide?.parLevel ?? item?.parLevel ?? item?.orgParLevel ?? null;
  const min = guide?.supplierMinOrderQty ?? item?.supplierMinOrderQty ?? null;
  const belowPar = par !== null && stock !== null && par > 0 && stock < par;
  const facts = [
    stock === null ? null : `In stock ${formatQty(stock)} ${base}`,
    par === null || par <= 0 ? null : `${stock === null ? "Par" : "par"} ${formatQty(par)} ${base}`,
    belowPar ? "below par" : null,
  ].filter(Boolean).join(", ");
  const units = item ? unitsOf(item) : [line.unit];
  const ordered = qty > 0 ? `${formatQty(qty)} ${line.unit}` : "Not ordered";

  return (
    <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md }}>
      <Pressable accessibilityRole="button" aria-expanded={open} accessibilityLabel={[line.ingredientName, ordered, total === null || qty === 0 ? null : formatMoney(total)].filter(Boolean).join(", ")} onPress={onToggle} style={{ minHeight: size.tap, justifyContent: "center", gap: space.xs }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
          <Text variant="heading" style={{ flexShrink: 1 }}>{line.ingredientName}</Text>
          {qty > 0 ? <Text style={{ fontFamily: fontFamily.uiStrong }}>{ordered}</Text> : <Text variant="meta">{ordered}</Text>}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
          <Text variant="meta" style={{ flexShrink: 1 }}>{facts}</Text>
          {total !== null && qty > 0 ? <Text variant="meta">{formatMoney(total)}</Text> : null}
        </View>
      </Pressable>
      {open ? (
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", gap: space.md }}>
            <View style={{ flex: 1 }}>
              <TextField label="Order" value={line.qty} onChangeText={(t) => onChange({ ...line, qty: t })} keyboardType="decimal-pad" placeholder="0" returnKeyType="done" selectTextOnFocus />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label={`Price per ${line.unit || "unit"}`} value={line.cost} onChangeText={(t) => onChange({ ...line, cost: t })} keyboardType="decimal-pad" placeholder="None" returnKeyType="done" selectTextOnFocus />
            </View>
          </View>
          {min !== null && qty > 0 && qty < min ? <Text variant="error">The supplier&apos;s minimum is {formatQty(min)}.</Text> : null}
          {units.length > 1 ? (
            <ChoiceChips label="Unit" options={units} value={line.unit} onChange={(u) => u && onChange(withUnit(line, u, item))} />
          ) : null}
          {item?.purchaseUnit && item.packQty ? <Text variant="meta">One {item.purchaseUnit} is {formatQty(item.packQty)} {item.baseUnit}.</Text> : null}
          {guide ? <Button kind="quiet" label={`Order to par (${toPar(guide)} ${guide.purchaseUnit || guide.baseUnit})`} onPress={() => onChange({ ...withUnit(line, guide.purchaseUnit || guide.baseUnit, item), qty: toPar(guide) })} /> : null}
          <Button kind="quiet" label={`Remove ${line.ingredientName}`} onPress={onRemove} />
        </View>
      ) : null}
    </View>
  );
}

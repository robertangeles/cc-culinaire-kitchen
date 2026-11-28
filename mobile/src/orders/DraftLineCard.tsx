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
  /** A tablet: the fields always show, side by side in one row (the web's order, unit, cost and line total). */
  wide?: boolean;
}

/** One line of the order being written: a row to read, opened to change its quantity, unit or price. A stock or par figure the server left out is not shown. */
export function DraftLineCard({ line, item, guide, open, onToggle, onChange, onRemove, wide = false }: Props) {
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
  const qtyField = <TextField label="Order" value={line.qty} onChangeText={(t) => onChange({ ...line, qty: t })} keyboardType="decimal-pad" placeholder="0" returnKeyType="done" selectTextOnFocus />;
  const priceField = <TextField label={`Price per ${line.unit || "unit"}`} value={line.cost} onChangeText={(t) => onChange({ ...line, cost: t })} keyboardType="decimal-pad" placeholder="None" returnKeyType="done" selectTextOnFocus />;
  const unitChips = units.length > 1 ? <ChoiceChips label="Unit" options={units} value={line.unit} onChange={(u) => u && onChange(withUnit(line, u, item))} /> : null;
  const minNote = min !== null && qty > 0 && qty < min ? <Text variant="error">The supplier&apos;s minimum is {formatQty(min)}.</Text> : null;
  const packNote = item?.purchaseUnit && item.packQty ? <Text variant="meta">One {item.purchaseUnit} is {formatQty(item.packQty)} {item.baseUnit}.</Text> : null;
  const toParButton = guide ? <Button kind="quiet" label={`Order to par (${toPar(guide)} ${guide.purchaseUnit || guide.baseUnit})`} onPress={() => onChange({ ...withUnit(line, guide.purchaseUnit || guide.baseUnit, item), qty: toPar(guide) })} /> : null;
  const removeButton = <Button kind="quiet" label={`Remove ${line.ingredientName}`} onPress={onRemove} />;

  if (wide) {
    return (
      <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md }}>
        <View style={{ gap: space.xs }}>
          <Text variant="heading">{line.ingredientName}</Text>
          {facts ? <Text variant="meta">{facts}</Text> : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
          <View style={{ flex: 1, gap: space.xs }}>{qtyField}{minNote}</View>
          <View style={{ flex: 1, gap: space.xs }}>{unitChips ?? <><Text variant="label">Unit</Text><Text style={{ fontFamily: fontFamily.uiStrong }}>{line.unit}</Text></>}</View>
          <View style={{ flex: 1 }}>{priceField}</View>
          <View style={{ flex: 1, gap: space.xs }}>
            <Text variant="label">Line total</Text>
            <Text style={{ fontFamily: fontFamily.uiStrong }}>{total === null || qty === 0 ? "None" : formatMoney(total)}</Text>
          </View>
        </View>
        {packNote}
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space.md }}>
          {toParButton ?? <View />}
          {removeButton}
        </View>
      </View>
    );
  }

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
            <View style={{ flex: 1 }}>{qtyField}</View>
            <View style={{ flex: 1 }}>{priceField}</View>
          </View>
          {minNote}
          {unitChips}
          {packNote}
          {toParButton}
          {removeButton}
        </View>
      ) : null}
    </View>
  );
}

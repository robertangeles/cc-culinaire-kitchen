import { useState } from "react";
import { Pressable, View } from "react-native";
import type { CustomConversion } from "@culinaire/shared";
import type { IngredientSource, PickedIngredient } from "../ingredients/source";
import { fontFamily, size, space } from "../theme";
import { Button } from "../ui/Button";
import { ChoiceChips } from "../ui/ChoiceChips";
import { IngredientPicker } from "../ui/IngredientPicker";
import { Text } from "../ui/Text";
import { TextField } from "../ui/TextField";
import { useColors } from "../ui/theme";
import { linePreview, typeName, unitsFor, type DraftLine } from "./menuEditor";
import { money } from "./menuView";

interface Props {
  line: DraftLine;
  conversions: CustomConversion[];
  open: boolean;
  onToggle: () => void;
  onChange: (line: DraftLine) => void;
  onPick: (picked: PickedIngredient) => void;
  onRemove: () => void;
  source: IngredientSource;
  canSeeCost: boolean;
}

/** One recipe line in the item form: a row that opens to its fields. The cost fields are for `inventory:cost` holders. */
export function LineEditor({ line, conversions, open, onToggle, onChange, onPick, onRemove, source, canSeeCost }: Props) {
  const c = useColors();
  const [changing, setChanging] = useState(false);
  const { cost, mismatch } = linePreview(line, conversions);
  const name = line.ingredientName || "New ingredient";
  const costText = !canSeeCost ? null : cost === null ? "No cost yet" : money(cost);
  return (
    <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${name}, ${line.quantity || "no quantity"} ${line.unit}${costText ? `, ${costText}` : ""}`}
        onPress={onToggle}
        style={{ minHeight: size.tap, justifyContent: "center", gap: 2 }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.md }}>
          <Text variant="heading" style={{ flexShrink: 1 }}>{name}</Text>
          {costText ? <Text style={{ fontFamily: fontFamily.uiStrong }}>{costText}</Text> : null}
        </View>
        <Text variant="meta">{`${line.quantity || "How much?"} ${line.unit}${line.yieldPct !== "100" && line.yieldPct !== "" ? ` · ${line.yieldPct}% yield` : ""}${line.ingredientId ? "" : " · not linked to the catalogue"}`}</Text>
      </Pressable>
      {mismatch ? <Text variant="error">{`${line.unit} cannot become ${line.baseUnit}, the unit ${name} is kept in. Choose another unit.`}</Text> : null}
      {line.note ? <Text variant="muted">{line.note}</Text> : null}
      {open ? (
        <>
          {line.ingredientId && !changing ? (
            <Button kind="quiet" label={`Swap ${name}`} onPress={() => setChanging(true)} />
          ) : (
            <IngredientPicker
              label="Ingredient"
              value={line.ingredientName}
              placeholder="Search the catalogue"
              source={source}
              onChangeText={(t) => onChange(typeName(line, t))}
              onPick={(p) => {
                setChanging(false);
                onPick(p);
              }}
            />
          )}
          <TextField label={`How much ${name}`} value={line.quantity} onChangeText={(quantity) => onChange({ ...line, quantity })} keyboardType="decimal-pad" placeholder="0" returnKeyType="done" />
          <ChoiceChips label="Unit" options={unitsFor(line, conversions)} value={line.unit} onChange={(unit) => unit && onChange({ ...line, unit })} />
          {canSeeCost ? <TextField label={`Cost per ${line.baseUnit ?? line.unit}, in $`} value={line.unitCost} onChangeText={(unitCost) => onChange({ ...line, unitCost })} keyboardType="decimal-pad" placeholder={line.ingredientId ? "The catalogue's cost" : "0.00"} returnKeyType="done" /> : null}
          <TextField label="Yield, in %" value={line.yieldPct} onChangeText={(yieldPct) => onChange({ ...line, yieldPct })} keyboardType="decimal-pad" placeholder="100" returnKeyType="done" />
          <View style={{ borderTopWidth: 1, borderTopColor: c.border }}>
            <Button kind="quiet" label={`Remove ${name}`} onPress={onRemove} />
          </View>
        </>
      ) : null}
    </View>
  );
}

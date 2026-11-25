import { useState } from "react";
import { Alert, KeyboardAvoidingView, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { WASTE_REASONS, WASTE_SHIFTS, WASTE_UNITS } from "@culinaire/shared/schemas/waste";
import { useWaste } from "../../../src/waste/WasteProvider";
import type { WasteChanges } from "../../../src/waste/wasteCommands";
import { Button } from "../../../src/ui/Button";
import { ChoiceChips } from "../../../src/ui/ChoiceChips";
import { Column } from "../../../src/ui/Column";
import { IngredientPicker } from "../../../src/ui/IngredientPicker";
import { Text } from "../../../src/ui/Text";
import { TextField } from "../../../src/ui/TextField";
import { space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

const DEFAULT_UNIT = "kg";
const asText = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
/** A number as the person would type it; "" when there is none. */
const parseNumber = (text: string) => (text.trim() === "" ? null : Number(text.trim().replace(",", ".")));

/** Log waste, or change an entry (`?id=`). The quick buttons open it with an item filled in (`?name=&unit=&quantity=`). Saved on the phone at once. */
export default function WasteEntry() {
  const { store, source, snap } = useWaste();
  const router = useRouter();
  const c = useColors();
  const params = useLocalSearchParams<{ id?: string; name?: string; unit?: string; quantity?: string }>();
  const editing = snap.rows.find((r) => r.wasteLogId === asText(params.id));

  const [name, setName] = useState(editing?.ingredientName ?? asText(params.name));
  const [ingredientId, setIngredientId] = useState<string | undefined>();
  const [quantity, setQuantity] = useState(editing ? String(editing.quantity) : asText(params.quantity));
  const [unit, setUnit] = useState<string>(editing?.unit ?? (asText(params.unit) || DEFAULT_UNIT));
  const [reason, setReason] = useState<string | null>(editing?.reason ?? null);
  const [shift, setShift] = useState<string | null>(editing?.shift ?? null);
  const [cost, setCost] = useState(editing?.estimatedCost == null ? "" : String(editing.estimatedCost));
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const q = parseNumber(quantity);
  const costNumber = parseNumber(cost);

  async function save() {
    if (!name.trim()) return setError("Say what was thrown away.");
    if (q === null || !Number.isFinite(q) || q <= 0) return setError("Enter a quantity above zero.");
    if (costNumber !== null && (!Number.isFinite(costNumber) || costNumber < 0)) return setError("The cost can't be negative.");
    setError(null);
    setSaving(true);
    try {
      if (editing) {
        const changes: WasteChanges = {};
        if (name.trim() !== editing.ingredientName) changes.ingredientName = name.trim();
        if (q !== editing.quantity) changes.quantity = q;
        if (unit !== editing.unit) changes.unit = unit;
        if (reason !== editing.reason) changes.reason = reason;
        if (shift !== editing.shift) changes.shift = shift;
        if (costNumber !== editing.estimatedCost) changes.estimatedCost = costNumber;
        if ((notes.trim() || null) !== editing.notes) changes.notes = notes.trim() || null;
        if (Object.keys(changes).length > 0) await store.edit(editing.wasteLogId, changes);
      } else {
        await store.log({ ingredientName: name, ingredientId, quantity: q, unit, reason, shift, estimatedCost: costNumber, notes });
      }
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setSaving(false);
    }
  }

  function remove() {
    if (!editing) return;
    Alert.alert(`Delete ${editing.ingredientName}?`, "It is removed from today's waste.", [
      { text: "Keep it", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void store.remove(editing.wasteLogId).then(() => router.back()) },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
          <Column style={{ gap: space.lg }}>
            <Text variant="title">{editing ? "Change waste entry" : "Log waste"}</Text>
            <IngredientPicker
              label="What was thrown away"
              value={name}
              placeholder="Chicken trim, leftover risotto, wilted herbs"
              source={source}
              chosen={!!editing}
              onChangeText={(t) => {
                setName(t);
                setIngredientId(undefined);
              }}
              onPick={(p) => {
                setName(p.name);
                setIngredientId(p.ingredientId);
                if (p.unit && (WASTE_UNITS as readonly string[]).includes(p.unit)) setUnit(p.unit);
              }}
            />
            <TextField label="How much" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="0" returnKeyType="done" />
            <ChoiceChips label="Unit" options={WASTE_UNITS} value={unit} onChange={(u) => u && setUnit(u)} />
            <ChoiceChips label="Why was it wasted" options={WASTE_REASONS} value={reason} onChange={setReason} clearable />
            <ChoiceChips label="Shift" options={WASTE_SHIFTS} value={shift} onChange={setShift} clearable />
            <TextField label="Estimated cost (optional)" value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder="0.00" />
            <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
            {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
            <Button label={editing ? "Save changes" : "Log waste"} onPress={() => void save()} disabled={saving} />
            {editing ? <Button kind="danger" label="Delete this entry" onPress={remove} /> : null}
            <Button kind="quiet" label="Cancel" onPress={() => router.back()} />
          </Column>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

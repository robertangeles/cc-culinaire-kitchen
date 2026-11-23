import { useState } from "react";
import { Alert, KeyboardAvoidingView, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { CONSUMPTION_REASONS, CONSUMPTION_SHIFTS } from "@culinaire/shared/schemas/consumption";
import { useConsumption } from "../../../src/consumption/ConsumptionProvider";
import type { ConsumptionChanges } from "../../../src/consumption/consumptionCommands";
import { needsMoveWarning } from "../../../src/consumption/consumptionView";
import { Button } from "../../../src/ui/Button";
import { ChoiceChips } from "../../../src/ui/ChoiceChips";
import { Column } from "../../../src/ui/Column";
import { IngredientPicker } from "../../../src/ui/IngredientPicker";
import { Text } from "../../../src/ui/Text";
import { TextField } from "../../../src/ui/TextField";
import { space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

const asText = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
/** A number as the person would type it; "" when there is none. */
const parseNumber = (text: string) => (text.trim() === "" ? null : Number(text.trim().replace(",", ".")));
// The chips show the short words the web shows; the server stores the keys.
const REASON_LABELS = CONSUMPTION_REASONS.map((r) => r.label);
const SHIFT_LABELS = CONSUMPTION_SHIFTS.map((s) => s.label);
const keyOf = (list: readonly { key: string; label: string }[], label: string | null) => list.find((o) => o.label === label)?.key ?? null;
const labelOf = (list: readonly { key: string; label: string }[], key: string | null | undefined) => list.find((o) => o.key === key)?.label ?? null;

/**
 * Log usage, or change an entry (`?id=`). "Log again" opens it with an item filled in (`?name=&ingredientId=&unit=&quantity=&reason=`).
 * The server needs the item's id, so the item is picked from the list; the quantity is in the item's kitchen unit. Saved on the phone at once.
 */
export default function UsageEntry() {
  const { store, source, snap } = useConsumption();
  const router = useRouter();
  const c = useColors();
  const params = useLocalSearchParams<{ id?: string; name?: string; ingredientId?: string; itemType?: string; unit?: string; quantity?: string; reason?: string }>();
  const editing = snap.rows.find((r) => r.consumptionLogId === asText(params.id));

  const [name, setName] = useState(editing?.ingredientName ?? asText(params.name));
  const [ingredientId, setIngredientId] = useState(editing?.ingredientId ?? asText(params.ingredientId));
  const [itemType, setItemType] = useState(asText(params.itemType));
  const [unit, setUnit] = useState(editing?.unit ?? asText(params.unit));
  const [quantity, setQuantity] = useState(editing ? String(editing.quantity) : asText(params.quantity));
  const [reason, setReason] = useState<string | null>(labelOf(CONSUMPTION_REASONS, editing?.reason ?? asText(params.reason)));
  const [shift, setShift] = useState<string | null>(labelOf(CONSUMPTION_SHIFTS, editing?.shift));
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const q = parseNumber(quantity);
  const reasonKey = keyOf(CONSUMPTION_REASONS, reason);

  async function commit() {
    if (q === null || reasonKey === null) return;
    setSaving(true);
    try {
      if (editing) {
        const changes: ConsumptionChanges = {};
        if (q !== editing.quantity) changes.quantity = q;
        if (reasonKey !== editing.reason) changes.reason = reasonKey;
        if (keyOf(CONSUMPTION_SHIFTS, shift) !== editing.shift) changes.shift = keyOf(CONSUMPTION_SHIFTS, shift);
        if ((notes.trim() || null) !== editing.notes) changes.notes = notes.trim() || null;
        if (Object.keys(changes).length > 0) await store.edit(editing.consumptionLogId, changes);
      } else {
        await store.log({ ingredientId, ingredientName: name.trim(), itemType, unit, quantity: q, reason: reasonKey, shift: keyOf(CONSUMPTION_SHIFTS, shift), notes });
      }
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setSaving(false);
    }
  }

  function save() {
    if (!editing && !ingredientId) return setError("Pick the item from the list.");
    if (q === null || !Number.isFinite(q) || q <= 0) return setError("Enter a quantity above zero.");
    if (reasonKey === null) return setError("Say what it was used for.");
    setError(null);
    // Stock carried to the bar or floor is still sellable: logging it as used deducts it now and again when it sells.
    if (!editing && needsMoveWarning(reasonKey, itemType)) {
      Alert.alert("Taking stock to the bar or front of house?", `That's a move, not usage: ${name.trim()} stays at this site until it's sold or wasted. Logging it as FOH usage deducts it now and again when it sells.`, [
        { text: "Go back", style: "cancel" },
        { text: "Log as usage anyway", onPress: () => void commit() },
        { text: "Record as movement", onPress: () => router.replace({ pathname: "/move-entry", params: { name: name.trim(), ingredientId, itemType, unit, quantity } }) },
      ]);
      return;
    }
    void commit();
  }

  function remove() {
    if (!editing) return;
    Alert.alert(`Delete ${editing.ingredientName}?`, "It is removed from today's usage and the stock is put back.", [
      { text: "Keep it", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void store.remove(editing.consumptionLogId).then(() => router.back()) },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
          <Column style={{ gap: space.lg }}>
            <Text variant="title">{editing ? "Change usage entry" : "Log usage"}</Text>
            {editing ? (
              <Text style={{ fontSize: 20 }}>{editing.ingredientName}</Text>
            ) : (
              <IngredientPicker
                label="What was used"
                value={name}
                placeholder="Search the item"
                source={source}
                onChangeText={(t) => {
                  setName(t);
                  setIngredientId("");
                  setItemType("");
                  setUnit("");
                }}
                onPick={(p) => {
                  setName(p.name);
                  setIngredientId(p.ingredientId ?? "");
                  setItemType(p.itemType ?? "");
                  setUnit(p.unit ?? "");
                }}
              />
            )}
            <TextField label="How much" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="0" returnKeyType="done" />
            {unit ? <Text variant="meta">In {unit}, the unit this item is kept in.</Text> : null}
            <ChoiceChips label="What it was used for" options={REASON_LABELS} value={reason} onChange={setReason} />
            <ChoiceChips label="Shift (optional)" options={SHIFT_LABELS} value={shift} onChange={setShift} clearable />
            <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
            {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
            <Button label={editing ? "Save changes" : "Log usage"} onPress={save} disabled={saving} />
            {editing ? <Button kind="quiet" label="Delete this entry" onPress={remove} /> : null}
            <Button kind="quiet" label="Cancel" onPress={() => router.back()} />
          </Column>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

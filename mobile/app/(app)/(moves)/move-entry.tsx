import { useState } from "react";
import { KeyboardAvoidingView, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useMovements } from "../../../src/movements/MovementProvider";
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

/**
 * Record a move between two areas. "Move again" and the usage screen's "Record as movement" open it with an item filled in
 * (`?name=&ingredientId=&unit=&quantity=&from=&to=`). The server needs the item's id, so the item is picked from the list. Saved on the phone at once.
 */
export default function MoveEntry() {
  const { store, source, snap } = useMovements();
  const router = useRouter();
  const c = useColors();
  const params = useLocalSearchParams<{ name?: string; ingredientId?: string; unit?: string; quantity?: string; from?: string; to?: string }>();

  const [name, setName] = useState(asText(params.name));
  const [ingredientId, setIngredientId] = useState(asText(params.ingredientId));
  const [unit, setUnit] = useState(asText(params.unit));
  const [quantity, setQuantity] = useState(asText(params.quantity));
  // An area that is no longer there (it was remembered by "Move again") is simply not chosen.
  const known = (id: string) => (snap.areas.some((a) => a.storageAreaId === id) ? id : "");
  const [fromId, setFromId] = useState(known(asText(params.from)));
  const [toId, setToId] = useState(known(asText(params.to)));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nameOf = (id: string) => snap.areas.find((a) => a.storageAreaId === id)?.areaName ?? null;
  const idOf = (areaName: string | null) => snap.areas.find((a) => a.areaName === areaName)?.storageAreaId ?? "";

  async function save() {
    setSaving(true);
    try {
      await store.record({ ingredientId, ingredientName: name.trim(), unit, quantity: parseNumber(quantity) ?? Number.NaN, fromStorageAreaId: fromId, toStorageAreaId: toId, notes });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
          <Column style={{ gap: space.lg }}>
            <Text variant="title">Record a move</Text>
            <IngredientPicker
              label="What moved"
              value={name}
              placeholder="Search the item"
              source={source}
              onChangeText={(t) => {
                setName(t);
                setIngredientId("");
              }}
              onPick={(p) => {
                setName(p.name);
                setIngredientId(p.ingredientId ?? "");
                if (p.unit) setUnit(p.unit);
              }}
            />
            <TextField label="How much" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="0" returnKeyType="done" />
            {unit ? <Text variant="meta">In {unit}, the unit this item is kept in.</Text> : null}
            <ChoiceChips label="From" options={snap.areas.map((a) => a.areaName)} value={nameOf(fromId)} onChange={(n) => setFromId(idOf(n))} />
            <ChoiceChips label="To" options={snap.areas.filter((a) => a.storageAreaId !== fromId).map((a) => a.areaName)} value={nameOf(toId)} onChange={(n) => setToId(idOf(n))} />
            <TextField label="Note (optional)" value={notes} onChangeText={setNotes} maxLength={500} />
            <Text variant="meta">This doesn't change your stock: {name.trim() || "the item"} stays on site until it's sold or wasted.</Text>
            {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
            <Button label="Record move" onPress={() => void save()} disabled={saving} />
            <Button kind="quiet" label="Cancel" onPress={() => router.back()} />
          </Column>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

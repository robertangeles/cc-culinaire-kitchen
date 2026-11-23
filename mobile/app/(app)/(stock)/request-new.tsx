import { useState } from "react";
import { KeyboardAvoidingView, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ITEM_TYPES, ITEM_TYPE_KEYS, getCategoriesForType, type ItemTypeKey } from "@culinaire/shared/schemas/storeRoom";
import { useStock } from "../../../src/stock/StockProvider";
import { Button } from "../../../src/ui/Button";
import { ChoiceChips } from "../../../src/ui/ChoiceChips";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { TextField } from "../../../src/ui/TextField";
import { space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

const typeLabel = (k: ItemTypeKey) => ITEM_TYPES[k].label;

/**
 * Ask for an item the catalogue lacks. The name is all the server needs; type, category, unit and how many are on hand help HQ add it.
 * Saved on the phone at once and sent when it can be; HQ approves or rejects it on the web. `?name=` fills the name from a search.
 */
export default function RequestNew() {
  const { store } = useStock();
  const router = useRouter();
  const c = useColors();
  const params = useLocalSearchParams<{ name?: string }>();
  const [itemName, setItemName] = useState((Array.isArray(params.name) ? params.name[0] : params.name) ?? "");
  const [itemType, setItemType] = useState<ItemTypeKey | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [baseUnit, setBaseUnit] = useState("");
  const [countedQty, setCountedQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const categories = itemType ? getCategoriesForType(itemType) : [];

  async function save() {
    setSaving(true);
    try {
      await store.request({ itemName, itemType, category: categories.find((cat) => cat.label === category)?.key ?? null, baseUnit, countedQty });
      router.replace("/requests");
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
            <Text variant="title">Ask for a new item</Text>
            <Text variant="muted">For something you have that isn't in the catalogue. HQ reviews the request and adds the item.</Text>
            <TextField label="Item name" value={itemName} onChangeText={setItemName} maxLength={200} placeholder="Yuzu juice" />
            <ChoiceChips label="Type (optional)" options={ITEM_TYPE_KEYS.map(typeLabel)} value={itemType ? typeLabel(itemType) : null} clearable onChange={(label) => { setItemType(ITEM_TYPE_KEYS.find((k) => typeLabel(k) === label) ?? null); setCategory(null); }} />
            {itemType ? <ChoiceChips label="Category (optional)" options={categories.map((cat) => cat.label)} value={category} clearable onChange={setCategory} /> : null}
            <TextField label="Unit it's counted in (optional)" value={baseUnit} onChangeText={setBaseUnit} maxLength={20} placeholder="L, kg, each" autoCapitalize="none" />
            <TextField label="How many you have now (optional)" value={countedQty} onChangeText={setCountedQty} keyboardType="decimal-pad" placeholder="0" returnKeyType="done" />
            {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
            <Button label="Send request" onPress={() => void save()} disabled={saving} />
            <Button kind="quiet" label="Cancel" onPress={() => router.back()} />
          </Column>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

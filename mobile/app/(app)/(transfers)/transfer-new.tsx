import { useState } from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../../src/runtime/appContext";
import { hasAnyPermission } from "../../../src/shell/tabs";
import { useTransfers } from "../../../src/transfers/TransferProvider";
import type { TransferForm } from "../../../src/transfers/transferStore";
import { qtyText } from "../../../src/stock/stockView";
import { Button } from "../../../src/ui/Button";
import { ChoiceChips } from "../../../src/ui/ChoiceChips";
import { Column } from "../../../src/ui/Column";
import { IngredientPicker } from "../../../src/ui/IngredientPicker";
import { Text } from "../../../src/ui/Text";
import { TextField } from "../../../src/ui/TextField";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

type Line = TransferForm["lines"][number];

/**
 * A new transfer from this location: where it is going, the items (picked from the catalogue, as the server takes an item, not a name) and
 * how much of each. "You have" is the store-room figure here, a dash when it is hidden (blind count) or unknown; it never stops a line.
 * Saved on the phone at once: "Send now" also sends it, "Save, send later" keeps it to check before it leaves.
 */
export default function TransferNew() {
  const { state } = useSession();
  const { store, source, snap } = useTransfers();
  const router = useRouter();
  const c = useColors();
  const [toName, setToName] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (state.phase !== "ready") return null;

  const here = state.location;
  const destinations = state.locations.filter((l) => l.storeLocationId !== here.storeLocationId);
  if (!hasAnyPermission(state.user, ["inventory:manage"]) || destinations.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <ScrollView contentContainerStyle={{ padding: space.xl }}>
          <Column style={{ gap: space.lg }}>
            <Text variant="title">New transfer</Text>
            <Text variant="muted">
              {destinations.length === 0
                ? "There is no other location to send stock to. A transfer needs a second location you work at."
                : "Making a transfer needs the permission to manage inventory. Ask a manager to send it."}
            </Text>
            <Button kind="quiet" label="Back to transfers" onPress={() => router.back()} />
          </Column>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const to = destinations.find((l) => l.locationName === toName) ?? null;
  const setQty = (ingredientId: string, quantity: string) => setLines((ls) => ls.map((l) => (l.ingredientId === ingredientId ? { ...l, quantity } : l)));

  async function save(sendNow: boolean) {
    setSaving(true);
    setError(null);
    try {
      await store.create({ toLocationId: to?.storeLocationId ?? "", toLocationName: to?.locationName ?? "", lines, notes, sendNow });
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
            <Text variant="title">New transfer</Text>
            <Text variant="meta">From {here.locationName}</Text>
            <ChoiceChips label="Going to" options={destinations.map((l) => l.locationName)} value={toName} onChange={setToName} />
            <IngredientPicker
              label="Add an item"
              value={search}
              placeholder="Search the item"
              source={source}
              onChangeText={setSearch}
              onPick={(p) => {
                setSearch("");
                if (!p.ingredientId || !p.unit) return setError(`Pick ${p.name} from the list${p.ingredientId ? " again: its unit is not known" : ""}.`);
                if (lines.some((l) => l.ingredientId === p.ingredientId)) return setError(`${p.name} is already on this transfer.`);
                setError(null);
                void source.remember(p);
                setLines((ls) => [...ls, { ingredientId: p.ingredientId!, ingredientName: p.name, unit: p.unit!, quantity: "" }]);
              }}
            />
            {lines.length === 0 ? (
              <Text variant="muted">Add what is going: search above.</Text>
            ) : (
              <Surface>
                {lines.map((line, index) => (
                  <View key={line.ingredientId} style={[{ padding: space.lg, gap: space.sm }, rowDivider(index, c.border)]}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                      <Text variant="heading" style={{ flexShrink: 1 }}>{line.ingredientName}</Text>
                      <Text variant="meta">You have {qtyText(snap.onHand[line.ingredientId], line.unit)}</Text>
                    </View>
                    <TextField label={`How much ${line.ingredientName}, in ${line.unit}`} value={line.quantity} onChangeText={(t) => setQty(line.ingredientId, t)} keyboardType="decimal-pad" placeholder="0" returnKeyType="done" />
                    <Button kind="quiet" label={`Remove ${line.ingredientName}`} onPress={() => setLines((ls) => ls.filter((l) => l.ingredientId !== line.ingredientId))} />
                  </View>
                ))}
              </Surface>
            )}
            <TextField label="Note (optional)" value={notes} onChangeText={setNotes} />
            {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
            <Button label="Send now" onPress={() => void save(true)} disabled={saving} />
            <Button kind="ghost" label="Save, send later" onPress={() => void save(false)} disabled={saving} />
            <Text variant="meta">Stock leaves {here.locationName} when the transfer is sent, and reaches {to?.locationName ?? "the other location"} when they receive it.</Text>
            <Button kind="quiet" label="Cancel" onPress={() => router.back()} />
          </Column>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

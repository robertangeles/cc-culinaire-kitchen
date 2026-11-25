import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Discrepancy } from "@culinaire/shared/schemas/purchasing";
import { ApiError } from "../../../src/api/client";
import { useAppLock } from "../../../src/lock/LockProvider";
import { newUuid } from "../../../src/outbox/uuid";
import { useOrders } from "../../../src/orders/OrdersProvider";
import { creditAmount, discrepancyText, loadMessage, money, orderFailure } from "../../../src/orders/orderView";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { Surface } from "../../../src/ui/Surface";
import { Text } from "../../../src/ui/Text";
import { TextField } from "../../../src/ui/TextField";
import { space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

const asText = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Raise the credit note for one delivery problem. The server allows one per problem, for no more than it is worth. */
export default function CreditNoteEntry() {
  const params = useLocalSearchParams<{ discrepancyId?: string; supplierId?: string }>();
  const discrepancyId = asText(params.discrepancyId);
  const supplierId = asText(params.supplierId);
  const { api, discrepancies, rights } = useOrders();
  const { confirm: confirmPerson } = useAppLock();
  const router = useRouter();
  const c = useColors();
  const [item, setItem] = useState<Discrepancy | null>(() => discrepancies.getSnapshot().items.find((d) => d.discrepancyId === discrepancyId) ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState(() => (item?.maxCreditAmount == null ? "" : item.maxCreditAmount.toFixed(2)));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ title: string; text: string } | null>(null);
  // One id for this form: a second tap after a lost reply answers the note the first one made.
  const noteId = useRef(newUuid());

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const found = (await api.discrepancies(0, supplierId || undefined)).find((d) => d.discrepancyId === discrepancyId);
      if (!found) return setLoadError("This was not found. It may already have a credit note.");
      setItem(found);
      if (found.maxCreditAmount !== null) setAmount(found.maxCreditAmount.toFixed(2));
    } catch (err) {
      setLoadError(loadMessage(err));
    }
  }, [api, supplierId, discrepancyId]);
  useEffect(() => {
    if (!item) void load();
  }, [item, load]);

  async function save() {
    if (!item || item.maxCreditAmount === null || saving) return;
    const checked = creditAmount(amount, item.maxCreditAmount);
    if (!checked.ok) return setError(checked.message);
    setError(null);
    setSaving(true);
    try {
      if (!(await confirmPerson("Raise a credit note"))) return;
      const note = await api.credit({
        creditNoteId: noteId.current,
        discrepancyId,
        creditAmount: checked.value,
        ...(reference.trim() ? { creditReference: reference.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setDone({ title: "Credit note raised", text: `${money(note.creditAmount)} from ${item.supplierName ?? "the supplier"}.` });
    } catch (err) {
      if (err instanceof ApiError && err.hasCode("ALREADY_CREDITED")) setDone({ title: "Already credited", text: "Someone has already raised a credit note for this." });
      else {
        const f = orderFailure(err, "Raising a credit note");
        // The form's id makes a repeat safe here, unlike an order.
        setError(f.unsure ? `${f.message.replace(" Check the order before trying again.", "")} It is safe to try again: it can't be raised twice.` : f.message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
          <Column style={{ gap: space.lg }}>
            {done ? (
              <>
                <Text variant="title" accessibilityLiveRegion="polite">{done.title}</Text>
                <Text>{done.text}</Text>
                <Button label="Done" onPress={() => router.back()} />
              </>
            ) : !rights.credit ? (
              <Text variant="muted">You don&apos;t have permission to raise credit notes.</Text>
            ) : !item ? (
              loadError ? (
                <>
                  <Text variant="title">Couldn&apos;t open this</Text>
                  <Text>{loadError}</Text>
                  <Button label="Try again" onPress={() => void load()} />
                  <Button kind="quiet" label="Back" onPress={() => router.back()} />
                </>
              ) : (
                <Text variant="muted">Opening…</Text>
              )
            ) : (
              <>
                <ScreenHeader label={[item.supplierName, item.poNumber].filter(Boolean).join(" · ")} title="Raise a credit note" />
                <Surface>
                  <View style={{ padding: space.lg, gap: space.xs }}>
                    <Text variant="heading">{item.ingredientName ?? "Item"}</Text>
                    <Text variant="meta">{discrepancyText(item)}</Text>
                    {item.maxCreditAmount === null ? <Text variant="muted">No price on this line, so a credit can&apos;t be checked against it.</Text> : <Text variant="meta">Worth up to {money(item.maxCreditAmount)}</Text>}
                  </View>
                </Surface>
                {item.maxCreditAmount === null ? null : (
                  <>
                    <TextField label="Amount credited" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" returnKeyType="done" />
                    <TextField label="Supplier's reference (optional)" value={reference} onChangeText={setReference} maxLength={100} autoCapitalize="characters" autoCorrect={false} />
                    <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} maxLength={2000} multiline />
                    {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
                    <Button label={saving ? "Saving…" : "Raise credit note"} disabled={saving} onPress={() => void save()} />
                  </>
                )}
                {rights.list ? <Button kind="quiet" label={`See order ${item.poNumber}`} onPress={() => router.push({ pathname: "/order", params: { poId: item.poId } })} /> : null}
                <Button kind="quiet" label="Cancel" onPress={() => router.back()} />
              </>
            )}
          </Column>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

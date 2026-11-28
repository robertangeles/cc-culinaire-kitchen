import { useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type { SaleResult } from "@culinaire/shared/schemas/menu";
import { rankIngredients } from "../../../src/ingredients/source";
import { ApiError } from "../../../src/api/client";
import { useSession } from "../../../src/runtime/appContext";
import { useMenu } from "../../../src/menu/MenuProvider";
import type { SaleTarget } from "../../../src/menu/menuApi";
import { mayHaveLanded } from "../../../src/menu/menuEditor";
import { isOffline } from "../../../src/menu/menuStore";
import { amount } from "../../../src/menu/menuView";
import { OfflineBanner } from "../../../src/ui/Banner";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { TextField } from "../../../src/ui/TextField";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

const SHOWN = 8;

/**
 * Record a sale at this location: a dish (its recipe comes off stock) or a front-of-house item sold as it is. Needs a connection. The sale
 * carries its own key, so when no answer comes back the same sale can be sent again and is never recorded twice.
 */
export default function MenuSale() {
  const { state } = useSession();
  const { store, snap } = useMenu();
  const router = useRouter();
  const c = useColors();
  const params = useLocalSearchParams<{ menuItemId?: string }>();
  const asked = Array.isArray(params.menuItemId) ? params.menuItemId[0] : params.menuItemId;
  const preset = snap.items.find((i) => i.menuItemId === asked);
  const [target, setTarget] = useState<SaleTarget | null>(preset ? { kind: "dish", id: preset.menuItemId, name: preset.name } : null);
  const [query, setQuery] = useState("");
  const [qty, setQty] = useState("1");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sale: SaleResult; name: string; qty: number } | null>(null);
  if (state.phase !== "ready") return null;

  const dishes: SaleTarget[] = snap.items.map((i) => ({ kind: "dish", id: i.menuItemId, name: i.name }));
  const consumables: SaleTarget[] = snap.consumables.map((i) => ({ kind: "consumable", id: i.ingredientId, name: i.ingredientName }));
  const found = (list: SaleTarget[]) => (query.trim() ? rankIngredients(query, list, SHOWN) : [...list].sort((a, b) => a.name.localeCompare(b.name)).slice(0, SHOWN));

  async function run(send: () => Promise<SaleResult>, name: string, sold: number) {
    setSending(true);
    setError(null);
    try {
      setResult({ sale: await send(), name, qty: sold });
    } catch (err) {
      // No answer (the server, or the way to it) is told apart from the server's own words and the form's check.
      if (err instanceof ApiError && mayHaveLanded(err)) setError(isOffline(err) ? "The server can't be reached." : "The server had a problem.");
      else setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
    setSending(false);
  }

  const group = (title: string, list: SaleTarget[]) =>
    list.length > 0 ? (
      <View style={{ gap: space.xs }}>
        <Text variant="label">{title}</Text>
        <Surface>
          {list.map((t, index) => (
            <Pressable key={t.id} accessibilityRole="button" accessibilityLabel={`Sell ${t.name}`} onPress={() => { setTarget(t); setError(null); }} style={[{ minHeight: size.tap, paddingHorizontal: space.lg, paddingVertical: space.md, justifyContent: "center" }, rowDivider(index, c.border)]}>
              <Text>{t.name}</Text>
            </Pressable>
          ))}
        </Surface>
      </View>
    ) : null;

  const pending = snap.pendingSale;
  const body = () => {
    if (result) {
      const { sale } = result;
      return (
        <>
          <Surface>
            <View style={{ padding: space.lg, gap: space.sm }}>
              <Text variant="heading">{sale.voided ? "This sale was recorded, and voided since" : "Sale recorded"}</Text>
              <Text>{`${amount(result.qty)} × ${result.name}`}</Text>
              {sale.alreadyExists ? <Text variant="muted">It had reached the server the first time. It was not recorded twice.</Text> : <Text variant="muted">{`${sale.depleted.length} ${sale.depleted.length === 1 ? "ingredient" : "ingredients"} taken off stock.`}</Text>}
              {sale.depleted.map((d) => (
                <Text key={d.ingredientId} variant="meta">{`${d.ingredientName}: −${amount(d.baseQty)} ${d.baseUnit}${typeof d.fohOnHand === "number" ? ` (on hand ${amount(d.fohOnHand)})` : ""}`}</Text>
              ))}
              {sale.oversold.length > 0 ? <Text variant="error">{`More sold than on the books: ${sale.oversold.join(", ")}. Put it right with a count.`}</Text> : null}
              {sale.skipped.length > 0 ? <Text variant="muted">{`Not taken off stock, not linked to the catalogue: ${sale.skipped.map((s) => s.ingredientName).join(", ")}`}</Text> : null}
            </View>
          </Surface>
          <Button label="Record another" onPress={() => { setResult(null); setTarget(null); setQuery(""); setQty("1"); }} />
        </>
      );
    }
    if (pending && !sending) {
      return (
        <>
          <Surface>
            <View style={{ padding: space.lg, gap: space.sm }}>
              <Text variant="heading">This sale is not confirmed</Text>
              <Text>{`${amount(pending.qty)} × ${pending.target.name}`}</Text>
              <Text variant="muted">{`${error ? `${error} ` : ""}It may or may not be recorded. Send it again: the same sale is never recorded twice.`}</Text>
            </View>
          </Surface>
          <Button label="Send it again" onPress={() => void run(() => store.retrySale(), pending.target.name, pending.qty)} />
          <Button kind="ghost" label="See recent sales" onPress={() => router.push("/menu-sales")} />
          <Button kind="quiet" label="Forget it" onPress={() => { setError(null); void store.forgetSale(); }} />
        </>
      );
    }
    return (
      <>
        {target ? (
          <View style={{ gap: space.xs }}>
            <Text variant="label">Sold</Text>
            <Surface>
              <View style={{ padding: space.lg, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                <Text variant="heading" style={{ flexShrink: 1 }}>{target.name}</Text>
                <Button kind="quiet" label="Change" disabled={sending} onPress={() => setTarget(null)} />
              </View>
            </Surface>
          </View>
        ) : (
          <>
            <TextField label="What was sold" value={query} onChangeText={setQuery} placeholder="Search the menu" autoCorrect={false} returnKeyType="search" />
            {group("Menu items", found(dishes))}
            {group("Sold as it is, front of house", found(consumables))}
            {found(dishes).length === 0 && found(consumables).length === 0 ? <Text variant="muted">{query.trim() ? `Nothing on the menu matches "${query.trim()}".` : "There is nothing to sell yet: the menu is empty."}</Text> : null}
          </>
        )}
        <TextField label="How many" value={qty} onChangeText={setQty} keyboardType="decimal-pad" returnKeyType="done" />
        {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
        <Button
          label={sending ? "Recording…" : "Record the sale"}
          disabled={sending}
          onPress={() => {
            if (!target) return setError("Pick what was sold.");
            const sold = Number(qty.trim().replace(",", ".") || Number.NaN);
            void run(() => store.sell(target, sold), target.name, sold);
          }}
        />
        <Text variant="meta">{`Stock comes off at ${state.location.locationName}.`}</Text>
        <Button kind="quiet" label="Import sales from a CSV" disabled={sending} onPress={() => router.push({ pathname: "/menu-import", params: { kind: "sales" } })} />
      </>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
          <Column style={{ gap: space.lg }}>
            <Text variant="title">Record a sale</Text>
            {snap.offline && !result ? <OfflineBanner text="You're offline. Recording a sale needs a connection." /> : null}
            {body()}
            <Button kind="quiet" label="Back" disabled={sending} onPress={() => router.back()} />
          </Column>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

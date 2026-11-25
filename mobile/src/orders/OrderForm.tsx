import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type { OrderGuide, SupplierOption } from "@culinaire/shared/schemas/purchasing";
import { useSession } from "../runtime/appContext";
import { rankIngredients } from "../ingredients/source";
import { draftTotal, isEmpty, toPar, weekDays, withUnit } from "./draft";
import { DraftLineCard } from "./DraftLineCard";
import type { DraftStore } from "./draftStore";
import { useDraft, useOrders } from "./OrdersProvider";
import { calendarDay, itemCount, money } from "./orderView";
import { OfflineBanner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { ChoiceChips } from "../ui/ChoiceChips";
import { Column } from "../ui/Column";
import { IngredientPicker } from "../ui/IngredientPicker";
import { ScreenHeader } from "../ui/ScreenHeader";
import { Surface, rowDivider } from "../ui/Surface";
import { Text } from "../ui/Text";
import { TextField } from "../ui/TextField";
import { fontFamily, size, space } from "../theme";
import { useColors } from "../ui/theme";

/** More suppliers than this and the list is searched instead of shown whole. */
const SHOWN = 6;

/** Choose the supplier: the whole list when it is short, a search when it is not. */
function SupplierChoice({ suppliers, chosen, onChoose }: { suppliers: SupplierOption[]; chosen: string; onChoose: (s: SupplierOption) => void }) {
  const c = useColors();
  const [open, setOpen] = useState(chosen === "");
  const [query, setQuery] = useState("");
  // Chosen elsewhere (a guide names its supplier): close the list.
  useEffect(() => {
    if (chosen) setOpen(false);
    else setOpen(true);
  }, [chosen]);
  if (!open) {
    return (
      <View style={{ gap: space.xs }}>
        <Text variant="label">Supplier</Text>
        <Surface>
          <Pressable accessibilityRole="button" accessibilityLabel={`Supplier, ${chosen}. Change`} onPress={() => setOpen(true)} style={{ minHeight: size.tap, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingHorizontal: space.lg }}>
            <Text variant="heading" style={{ flexShrink: 1 }}>{chosen}</Text>
            <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText }}>Change</Text>
          </Pressable>
        </Surface>
      </View>
    );
  }
  const searched = suppliers.length > SHOWN;
  const shown = searched && query.trim() ? rankIngredients(query, suppliers.map((s) => ({ ...s, name: s.supplierName })), SHOWN) : suppliers.slice(0, SHOWN);
  return (
    <View style={{ gap: space.sm }}>
      {searched ? <TextField label="Supplier" value={query} onChangeText={setQuery} placeholder="Search suppliers" autoCorrect={false} /> : <Text variant="label">Supplier</Text>}
      {suppliers.length === 0 ? <Text variant="muted">No suppliers yet. Add them on the web, under Purchasing.</Text> : null}
      {shown.length > 0 ? (
        <Surface>
          {shown.map((s, i) => (
            <Pressable
              key={s.supplierId}
              accessibilityRole="button"
              accessibilityLabel={`Order from ${s.supplierName}`}
              onPress={() => {
                setOpen(false);
                setQuery("");
                onChoose(s);
              }}
              style={({ pressed }) => [{ minHeight: size.tap, justifyContent: "center", paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: pressed ? c.surface : undefined }, rowDivider(i, c.border)]}
            >
              <Text variant="heading">{s.supplierName}</Text>
            </Pressable>
          ))}
        </Surface>
      ) : searched && query.trim() ? (
        <Text variant="muted">No supplier matches.</Text>
      ) : null}
    </View>
  );
}

/**
 * The order form: a guide filled to par, or a supplier and its items one by one. A new order is kept on the phone until it is saved;
 * `editing` is a saved draft being changed.
 */
export function OrderForm({ store, title, editing }: { store: DraftStore; title: string; editing?: boolean }) {
  const { state } = useSession();
  const { rights } = useOrders();
  const snap = useDraft(store);
  const router = useRouter();
  const c = useColors();
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [week, setWeek] = useState(0);
  useEffect(() => {
    if (rights.create) void store.load();
  }, [store, rights.create]);
  if (state.phase !== "ready") return null;

  const { draft } = snap;
  const { total, unpriced } = draftTotal(draft);
  const days = weekDays(new Date(), week);
  const dayName = days.find((d) => d.value === draft.expectedDate)?.label ?? null;

  async function save(submit: boolean) {
    const saved = await store.save(submit);
    if (saved) {
      // Changing an order came from its page: go back to it, which reads it again. A new one opens in the form's place.
      if (editing && !saved.notSubmitted) router.back();
      else router.replace({ pathname: "/order", params: { poId: saved.poId, ...(saved.notSubmitted ? { notice: saved.notSubmitted } : {}) } });
    }
  }
  function applyGuide(guide: OrderGuide) {
    if (draft.lines.length === 0) return void store.applyGuide(guide);
    Alert.alert(`Use ${guide.name}?`, "It replaces the items on this order.", [
      { text: "Keep these items", style: "cancel" },
      { text: "Use the guide", onPress: () => void store.applyGuide(guide) },
    ]);
  }
  function discard() {
    Alert.alert("Discard this order?", "It has not been saved to the server.", [
      { text: "Keep it", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => { store.discard(); router.back(); } },
    ]);
  }
  const guideFor = (id: string) => snap.guideItems.find((g) => g.ingredientId === id);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
          <Column style={{ gap: space.lg }}>
            <ScreenHeader label={state.location.locationName} title={title} />
            {!rights.create ? <Text variant="muted">You don&apos;t have permission to raise orders.</Text> : null}
            {rights.create && snap.phase === "loading" ? <Text variant="muted">Loading suppliers and items…</Text> : null}
            {snap.phase === "error" ? (
              <>
                <OfflineBanner text={`${snap.error}${editing || isEmpty(draft) ? "" : " What you have so far is kept on this phone."}`} />
                <Button kind="ghost" label="Try again" onPress={() => void store.load()} />
              </>
            ) : null}

            {rights.create && snap.phase === "ready" ? (
              <>
                {snap.guides.length > 0 ? (
                  <View style={{ gap: space.xs }}>
                    <Text variant="label">Start from a guide</Text>
                    <Surface>
                      {snap.guides.map((g, i) => (
                        <Pressable
                          key={g.orderGuideId}
                          accessibilityRole="button"
                          accessibilityLabel={`Use the guide ${g.name}, ${itemCount(g.itemCount)}`}
                          aria-selected={g.orderGuideId === draft.guideId}
                          onPress={() => applyGuide(g)}
                          style={({ pressed }) => [{ minHeight: size.tap + 8, justifyContent: "center", paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.xs, backgroundColor: pressed ? c.surface : undefined }, rowDivider(i, c.border)]}
                        >
                          <Text variant="heading" style={g.orderGuideId === draft.guideId ? { color: c.accentText } : undefined}>{g.name}</Text>
                          <Text variant="meta">{[g.supplierName, itemCount(g.itemCount), g.orderGuideId === draft.guideId ? "in use" : null].filter(Boolean).join(" · ")}</Text>
                        </Pressable>
                      ))}
                    </Surface>
                  </View>
                ) : null}

                <SupplierChoice suppliers={snap.suppliers} chosen={draft.supplierName} onChoose={store.chooseSupplier} />

                <IngredientPicker
                  label="Add an item"
                  value={search}
                  placeholder="Search the item"
                  source={store.source}
                  onChangeText={setSearch}
                  onPick={(p) => {
                    setSearch("");
                    if (p.ingredientId) {
                      store.add(p.ingredientId);
                      setOpenId(p.ingredientId);
                    }
                  }}
                />

                {draft.lines.length > 0 ? (
                  <View style={{ gap: space.xs }}>
                    <Text variant="label">{itemCount(draft.lines.length)}</Text>
                    <Surface>
                      {draft.lines.map((line, i) => (
                        <View key={line.ingredientId} style={rowDivider(i, c.border)}>
                          <DraftLineCard
                            line={line}
                            item={snap.items.find((it) => it.ingredientId === line.ingredientId)}
                            guide={guideFor(line.ingredientId)}
                            open={openId === line.ingredientId}
                            onToggle={() => setOpenId(openId === line.ingredientId ? null : line.ingredientId)}
                            onChange={store.setLine}
                            onRemove={() => {
                              setOpenId(null);
                              store.removeLine(line.ingredientId);
                            }}
                          />
                        </View>
                      ))}
                    </Surface>
                    {draft.guideId && snap.guideItems.length > 0 ? (
                      <Button
                        kind="quiet"
                        label="Order everything to par"
                        onPress={() =>
                          store.update({
                            lines: draft.lines.map((l) => {
                              const g = guideFor(l.ingredientId);
                              return g ? { ...withUnit(l, g.purchaseUnit || g.baseUnit, snap.items.find((it) => it.ingredientId === l.ingredientId)), qty: toPar(g) } : l;
                            }),
                          })
                        }
                      />
                    ) : null}
                    <View style={{ paddingHorizontal: space.lg, gap: space.xs }}>
                      {total > 0 ? (
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                          <Text variant="label">Total</Text>
                          <Text style={{ fontFamily: fontFamily.uiStrong }}>{money(total)}</Text>
                        </View>
                      ) : null}
                      {unpriced > 0 ? <Text variant="meta">{itemCount(unpriced)} without a price{total > 0 ? ", not in the total" : ""}. The order may need approval because of it.</Text> : null}
                    </View>
                  </View>
                ) : null}

                <View style={{ gap: space.xs }}>
                  <ChoiceChips
                    label="Expected delivery (optional)"
                    options={days.map((d) => d.label)}
                    value={dayName}
                    clearable
                    onChange={(label) => store.update({ expectedDate: days.find((d) => d.label === label)?.value ?? null })}
                  />
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    {week > 0 ? <Button kind="quiet" label="Earlier days" onPress={() => setWeek(week - 1)} /> : <View />}
                    <Button kind="quiet" label="Later days" onPress={() => setWeek(week + 1)} />
                  </View>
                  {draft.expectedDate && !dayName ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
                      <Text>Expected {calendarDay(draft.expectedDate)}</Text>
                      <Button kind="quiet" label="Clear the date" onPress={() => store.update({ expectedDate: null })} />
                    </View>
                  ) : null}
                </View>
                <TextField label="Notes (optional)" value={draft.notes} onChangeText={(notes) => store.update({ notes })} maxLength={2000} multiline placeholder="Special instructions, delivery notes" />

                {snap.saveError ? <Text variant="error" accessibilityLiveRegion="polite">{snap.saveError}</Text> : null}
                {rights.submit ? <Button label={snap.saving ? "Saving…" : "Save and submit"} disabled={snap.saving} onPress={() => void save(true)} /> : null}
                <Button kind={rights.submit ? "ghost" : "primary"} label={snap.saving && !rights.submit ? "Saving…" : editing ? "Save changes" : "Save as draft"} disabled={snap.saving} onPress={() => void save(false)} />
                {editing || isEmpty(draft) ? null : <Button kind="quiet" label="Discard this order" disabled={snap.saving} onPress={discard} />}
              </>
            ) : null}
            <Button kind="quiet" label={editing ? "Back without saving" : "Back to orders"} onPress={() => router.back()} />
          </Column>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

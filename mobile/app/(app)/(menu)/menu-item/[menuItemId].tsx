import { useCallback, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { FOOD_COST_ALERT_PCT } from "@culinaire/shared";
import { useSession } from "../../../../src/runtime/appContext";
import { hasAnyPermission } from "../../../../src/shell/tabs";
import { useMenu } from "../../../../src/menu/MenuProvider";
import { isOffline } from "../../../../src/menu/menuStore";
import { allergensOf, amount, classInfo, costsOf, money, overTarget, pct } from "../../../../src/menu/menuView";
import { OfflineBanner } from "../../../../src/ui/Banner";
import { Button } from "../../../../src/ui/Button";
import { Column } from "../../../../src/ui/Column";
import { Text } from "../../../../src/ui/Text";
import { Chip, Surface, rowDivider } from "../../../../src/ui/Surface";
import { fontFamily, space } from "../../../../src/theme";
import { useColors } from "../../../../src/ui/theme";

/**
 * One menu item: its price, its class, what the server stored as its food cost, percentage and margin (`inventory:cost` holders only), its
 * allergens and its recipe lines. Change and delete are offered to who may manage this item, as the server says (`canManage`).
 */
export default function MenuItemScreen() {
  const { state } = useSession();
  const { store, snap } = useMenu();
  const router = useRouter();
  const c = useColors();
  const { menuItemId } = useLocalSearchParams<{ menuItemId: string }>();
  const id = Array.isArray(menuItemId) ? menuItemId[0] : (menuItemId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useFocusEffect(useCallback(() => void store.loadLines(id), [store, id]));
  if (state.phase !== "ready") return null;

  const item = snap.items.find((i) => i.menuItemId === id);
  if (!item) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <ScrollView contentContainerStyle={{ padding: space.xl }}>
          <Column style={{ gap: space.lg }}>
            <Text variant="title">{snap.phase === "loading" ? "Loading…" : "Item not found"}</Text>
            {snap.phase === "loading" ? null : <Text variant="muted">This item is not on the menu downloaded to this phone. Pull down on Menu to download it again.</Text>}
            <Button kind="quiet" label="Back to the menu" onPress={() => router.back()} />
          </Column>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const canManage = hasAnyPermission(state.user, ["menu:manage"]) && item.canManage !== false;
  const costs = costsOf(item);
  const over = overTarget(item, snap.targets);
  const info = classInfo(item.classification);
  const allergens = allergensOf(item);
  const lines = snap.lines[id];
  const fact = (label: string, value: string, tone?: string) => (
    <View key={label} accessible accessibilityLabel={`${label}, ${value}`} style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
      <Text variant="meta" style={{ flexShrink: 1 }}>{label}</Text>
      <Text style={{ fontFamily: fontFamily.uiStrong, color: tone ?? c.text }}>{value}</Text>
    </View>
  );

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(isOffline(err) ? "This needs a connection, and the server can't be reached. Try again when you're back online." : err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
    setBusy(false);
  }

  function remove() {
    Alert.alert(`Delete ${item!.name}?`, "It is removed from your organisation's menu. This cannot be undone.", [
      { text: "Keep it", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void run(async () => { await store.remove(id); router.back(); }) },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.xl }}>
        <Column style={{ gap: space.lg }}>
          <Text variant="title">{item.name}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            <Chip label={item.category} />
            <Chip label={info.label} />
          </View>
          <Text variant="muted">{info.sentence}</Text>
          {snap.offline ? <OfflineBanner text="You're offline. This is the item as last downloaded. Sales and changes need a connection." /> : null}

          <View style={{ gap: space.xs }}>
            <Text variant="label">{costs ? "Price and cost" : "Price"}</Text>
            <Surface>
              <View style={{ padding: space.lg, gap: space.sm }}>
                {fact("Selling price", money(item.sellingPrice))}
                {costs ? fact("Food cost per sale", money(costs.foodCost)) : null}
                {costs ? fact("Food cost", pct(costs.foodCostPct), costs.foodCostPct > FOOD_COST_ALERT_PCT ? c.danger : undefined) : null}
                {costs ? fact("Contribution margin", money(costs.margin), costs.margin < 0 ? c.danger : undefined) : null}
                {over !== null ? <Text variant="error">{`Over the ${over}% target for ${item.category}.`}</Text> : null}
              </View>
            </Surface>
          </View>

          <View style={{ gap: space.xs }}>
            <Text variant="label">Set-up</Text>
            <Surface>
              <View style={{ padding: space.lg, gap: space.sm }}>
                {fact("Price covers", `${item.servingsPerSale} ${item.servingsPerSale === 1 ? "serving" : "servings"}`)}
                {fact("Recipe makes", `${item.servings} ${item.servings === 1 ? "serving" : "servings"}`)}
                {fact("Q factor", `${amount(item.qFactorPct)}%`)}
                {fact("Units sold", String(item.unitsSold))}
              </View>
            </Surface>
          </View>

          {allergens.length > 0 ? (
            <View style={{ gap: space.xs }}>
              <Text variant="label">Allergens and diet</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>{allergens.map((a) => <Chip key={a} label={a} />)}</View>
            </View>
          ) : null}

          <View style={{ gap: space.xs }}>
            <Text variant="label">Ingredients</Text>
            {snap.linesError && !lines ? <Text variant="muted">{snap.linesError}</Text> : null}
            {!lines && !snap.linesError ? <Text variant="muted">Loading…</Text> : null}
            {lines && lines.length === 0 ? (
              <Surface>
                <View style={{ padding: space.lg, gap: space.xs }}>
                  <Text variant="heading">No ingredients yet</Text>
                  <Text variant="muted">{canManage ? "Change the item to build its recipe." : "Nobody has built this item's recipe yet."}</Text>
                </View>
              </Surface>
            ) : null}
            {lines && lines.length > 0 ? (
              <Surface>
                {lines.map((l, index) => (
                  <View key={l.id} style={[{ paddingVertical: space.md, paddingHorizontal: space.lg, gap: 2 }, rowDivider(index, c.border)]}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.md }}>
                      <Text variant="heading" style={{ flexShrink: 1 }}>{l.ingredientName}</Text>
                      {typeof l.lineCost === "number" ? <Text style={{ fontFamily: fontFamily.uiStrong }}>{money(l.lineCost)}</Text> : null}
                    </View>
                    <Text variant="meta">{`${amount(l.quantity)} ${l.unit}${l.yieldPct !== 100 ? ` · ${amount(l.yieldPct)}% yield` : ""}${typeof l.unitCost === "number" ? ` · ${money(l.unitCost)} per ${l.baseUnit ?? l.unit}` : ""}`}</Text>
                    {l.note ? <Text variant="muted">{l.note}</Text> : null}
                    {l.ingredientId ? null : <Text variant="meta">Not linked to the catalogue</Text>}
                    {l.costStaleInd ? (
                      <>
                        <Text variant="error">The catalogue's cost has changed since this line was priced.</Text>
                        {canManage ? <Button kind="quiet" label={`Refresh the cost of ${l.ingredientName}`} disabled={busy} onPress={() => void run(() => store.refreshCost(id, l.id))} /> : null}
                      </>
                    ) : null}
                  </View>
                ))}
              </Surface>
            ) : null}
          </View>

          {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
          <Button label="Record a sale" onPress={() => router.push({ pathname: "/menu-sale", params: { menuItemId: id } })} />
          {canManage ? <Button kind="ghost" label="Change the item" onPress={() => router.push({ pathname: "/menu-edit", params: { menuItemId: id } })} /> : null}
          {canManage ? <Button kind="danger" label="Delete the item" disabled={busy} onPress={remove} /> : null}
          <Button kind="quiet" label="Back to the menu" onPress={() => router.back()} />
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

import { useCallback, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { FOOD_COST_ALERT_PCT } from "@culinaire/shared";
import type { Recommendation } from "@culinaire/shared/schemas/menu";
import { useSession } from "../../../../src/runtime/appContext";
import { hasAnyPermission } from "../../../../src/shell/tabs";
import { useMenu } from "../../../../src/menu/MenuProvider";
import { isOffline } from "../../../../src/menu/menuStore";
import { actionLabel, allergensOf, amount, classInfo, costsOf, money, overTarget, pct, plateOf, varianceOf, wasteLabel } from "../../../../src/menu/menuView";
import { OfflineBanner } from "../../../../src/ui/Banner";
import { Button } from "../../../../src/ui/Button";
import { Column } from "../../../../src/ui/Column";
import { Text } from "../../../../src/ui/Text";
import { Chip, Surface, rowDivider } from "../../../../src/ui/Surface";
import { fontFamily, space } from "../../../../src/theme";
import { useColors } from "../../../../src/ui/theme";

/**
 * One menu item: its price, its class, what the server stored as its food cost, percentage and margin, its ingredients' waste, its plate
 * P&L and yield variance (those for `inventory:cost` holders only), its allergens and its recipe lines. Change and delete are offered to who
 * may manage this item, as the server says (`canManage`); the model's recommendations to `menu:manage` holders, the route's gate.
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
  const [advice, setAdvice] = useState<Recommendation | null>(null);
  const [asking, setAsking] = useState(false);
  const [adviceError, setAdviceError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => void Promise.all([store.loadLines(id), store.loadFigures(id)]), [store, id]));
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

  const mayManage = hasAnyPermission(state.user, ["menu:manage"]);
  const canManage = mayManage && item.canManage !== false;
  const waste = wasteLabel(item, snap.waste[id]);
  const figures = snap.figures[id];
  const plate = typeof figures?.plateCost === "number" ? plateOf(item, figures.plateCost) : null;
  const variance = figures?.variance ? varianceOf(figures.variance) : null;
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

  const failure = (err: unknown) => (isOffline(err) ? "This needs a connection, and the server can't be reached. Try again when you're back online." : err instanceof Error ? err.message : "Something went wrong. Try again.");

  async function ask() {
    setAsking(true);
    setAdviceError(null);
    try {
      setAdvice(await store.recommend(id));
    } catch (err) {
      setAdviceError(failure(err));
    }
    setAsking(false);
  }

  async function replace() {
    setAsking(true);
    setAdviceError(null);
    try {
      const request = await store.replacement(id);
      router.push({ pathname: "/recipe-lab", params: { request } });
    } catch (err) {
      setAdviceError(failure(err));
    }
    setAsking(false);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(failure(err));
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
                {waste ? fact("Ingredient waste, last 30 days", money(snap.waste[id]), c.danger) : null}
                {waste && item.classification === "dog" ? <Text variant="error">A Dog with waste: a strong candidate to replace.</Text> : null}
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

          {plate ? (
            <View style={{ gap: space.xs }}>
              <Text variant="label">Plate P&L</Text>
              <Surface>
                <View style={{ padding: space.lg, gap: space.sm }}>
                  {fact("Price per serving", money(plate.price))}
                  {fact("Food cost per serving", money(plate.foodCost))}
                  {plate.foodCostPct !== null ? fact("Food cost", pct(plate.foodCostPct), plate.foodCostPct > FOOD_COST_ALERT_PCT ? c.danger : undefined) : null}
                  {fact("Margin per serving", money(plate.margin), plate.margin < 0 ? c.danger : undefined)}
                  <Text variant="meta">At what the location paid on average for each ingredient, not the catalogue's cost today.</Text>
                </View>
              </Surface>
            </View>
          ) : null}

          {variance ? (
            <View style={{ gap: space.xs }}>
              <Text variant="label">Yield variance</Text>
              <Surface>
                <View style={{ padding: space.lg, gap: space.sm }}>
                  {variance.figures ? fact("The recipe says", money(variance.figures.theoretical)) : null}
                  {variance.figures ? fact("Logged as used", money(variance.figures.actual)) : null}
                  {variance.figures ? fact("Difference", `${money(variance.figures.variance)} (${pct(variance.figures.variancePct)})`, figures?.variance?.threshold === "alert" ? c.danger : undefined) : null}
                  <Text variant={figures?.variance?.threshold === "alert" ? "error" : "muted"}>{variance.sentence}</Text>
                  {variance.figures && figures?.variance?.periodStart && figures.variance.periodEnd ? <Text variant="meta">{`${figures.variance.unitsSold} sold, ${figures.variance.periodStart} to ${figures.variance.periodEnd}`}</Text> : null}
                </View>
              </Surface>
            </View>
          ) : null}
          {figures?.error ? <Text variant="muted">{figures.error}</Text> : null}

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

          {mayManage ? (
            <View style={{ gap: space.sm }}>
              <Text variant="label">Recommendations</Text>
              {advice ? (
                <Surface>
                  <View style={{ padding: space.lg, gap: space.md }}>
                    {advice.summary ? <Text>{advice.summary}</Text> : null}
                    {advice.actions.map((a, index) => (
                      <View key={index} style={[{ gap: 2, paddingTop: space.md }, rowDivider(index === 0 && !advice.summary ? 0 : 1, c.border)]}>
                        <Text variant="label">{actionLabel(a.type)}</Text>
                        <Text>{a.description}</Text>
                        {a.impact ? <Text variant="meta">{a.impact}</Text> : null}
                        {a.type === "generate_replacement" ? <Button kind="ghost" label="Write a replacement recipe" disabled={asking} onPress={() => void replace()} /> : null}
                      </View>
                    ))}
                    {advice.menuDescription ? (
                      <View style={{ gap: 2 }}>
                        <Text variant="label">Suggested menu description</Text>
                        <Text variant="muted">{`“${advice.menuDescription}”`}</Text>
                      </View>
                    ) : null}
                  </View>
                </Surface>
              ) : (
                <Text variant="muted">CulinAIre looks at this item's class, price, sales and recipe and suggests what to do with it.</Text>
              )}
              {asking ? <Text variant="muted" accessibilityLiveRegion="polite">Asking CulinAIre… this can take up to a minute.</Text> : null}
              {adviceError ? <Text variant="error" accessibilityLiveRegion="polite">{adviceError}</Text> : null}
              <Button kind="ghost" label={advice ? "Ask again" : "Get recommendations"} disabled={asking} onPress={() => void ask()} />
            </View>
          ) : null}

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

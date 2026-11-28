import { useCallback, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../../src/runtime/appContext";
import { hasAnyPermission } from "../../../src/shell/tabs";
import { useMenu } from "../../../src/menu/MenuProvider";
import { CLASS_FILTERS, categoriesOf, classInfo, costsOf, filterItems, money, overTarget, pct, wasteLabel } from "../../../src/menu/menuView";
import { dayAndTime } from "../../../src/transfers/transferView";
import { OfflineBanner } from "../../../src/ui/Banner";
import { Button } from "../../../src/ui/Button";
import { ChoiceChips } from "../../../src/ui/ChoiceChips";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { TextField } from "../../../src/ui/TextField";
import { Chip, Surface, rowDivider } from "../../../src/ui/Surface";
import { fontFamily, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

const CLASS_LABELS = CLASS_FILTERS.map((k) => classInfo(k).label);

/**
 * The organisation's menu, A to Z: price and class for everyone, the stored food cost, percentage and margin for `inventory:cost` holders.
 * A row opens the item. Adding one is for `menu:manage` holders, as on the server.
 */
export default function MenuHome() {
  const { state } = useSession();
  const { store, snap } = useMenu();
  const router = useRouter();
  const c = useColors();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [classLabel, setClassLabel] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Back from an item or a sale: read the menu again. The provider already read it on the first visit.
  const seen = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (seen.current) void store.refresh();
      seen.current = true;
    }, [store]),
  );
  if (state.phase !== "ready") return null;
  const canManage = hasAnyPermission(state.user, ["menu:manage"]);
  const canSeeCost = hasAnyPermission(state.user, ["inventory:cost"]);
  const categories = categoriesOf(snap.items);
  // A category whose last item is gone has no chip to switch it off with.
  const inCategory = category && categories.includes(category) ? category : null;
  const klass = CLASS_FILTERS.find((k) => classInfo(k).label === classLabel) ?? null;
  const shown = filterItems(snap.items, { query, category: inCategory, klass });
  const emptyCard = (heading: string, sentence: string) => (
    <Surface>
      <View style={{ padding: space.lg, gap: space.xs }}>
        <Text variant="heading">{heading}</Text>
        <Text variant="muted">{sentence}</Text>
      </View>
    </Surface>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await store.refresh(); setRefreshing(false); }} />}
      >
        <Column style={{ gap: space.lg }}>
          <ScreenHeader label="Menu & costing" title="Menu" />
          {snap.offline ? <OfflineBanner text={snap.savedAt ? `You're offline. This is the menu from ${dayAndTime(new Date(snap.savedAt).toISOString())}. Sales and changes need a connection.` : "You're offline, and the menu has not been downloaded to this phone yet. Open this tab once with a signal."} /> : null}
          {snap.phase === "error" ? (
            <>
              <Text variant="error">{snap.error}</Text>
              <Button label="Try again" onPress={() => void store.refresh()} />
            </>
          ) : null}
          {snap.pendingSale ? <Text variant="error">⚠ A sale of {snap.pendingSale.target.name} is not confirmed yet. Open Record a sale to send it again.</Text> : null}

          <Button label="Record a sale" onPress={() => router.push("/menu-sale")} />
          {canManage ? <Button kind="ghost" label="Add a menu item" onPress={() => router.push("/menu-edit")} /> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-around", columnGap: space.xl }}>
            <Button kind="quiet" label="Dashboard" onPress={() => router.push("/menu-dashboard")} />
            {canSeeCost ? <Button kind="quiet" label="Engineering matrix" onPress={() => router.push("/menu-matrix")} /> : null}
            <Button kind="quiet" label="Recent sales" onPress={() => router.push("/menu-sales")} />
            <Button kind="quiet" label="Category targets" onPress={() => router.push("/menu-categories")} />
          </View>

          {snap.phase === "loading" ? <Text variant="muted">Loading the menu…</Text> : null}
          {snap.phase === "ready" && snap.items.length === 0 && !(snap.offline && snap.savedAt === null)
            ? emptyCard("No menu items yet", canManage ? "Add the first one to see what it costs and what it earns." : "Items added to your organisation's menu show here.")
            : null}
          {snap.items.length > 0 ? (
            <>
              <TextField label="Search the menu" value={query} onChangeText={setQuery} placeholder="Item or category" autoCorrect={false} returnKeyType="search" />
              {categories.length > 1 ? <ChoiceChips label="Category" options={categories} value={inCategory} onChange={setCategory} clearable /> : null}
              <ChoiceChips label="Class" options={CLASS_LABELS} value={classLabel} onChange={setClassLabel} clearable />
              {shown.length === 0 ? (
                emptyCard("Nothing matches", "No item matches this search or filter.")
              ) : (
                <View style={{ gap: space.xs }}>
                  <Text variant="label">{`${shown.length} ${shown.length === 1 ? "item" : "items"}`}</Text>
                  <Surface>
                    {shown.map((item, index) => {
                      const costs = costsOf(item);
                      const over = overTarget(item, snap.targets);
                      const label = classInfo(item.classification).label;
                      const waste = wasteLabel(item, snap.waste[item.menuItemId]);
                      return (
                        <Pressable
                          key={item.menuItemId}
                          accessibilityRole="button"
                          accessibilityLabel={`${item.name}, ${item.category}, ${money(item.sellingPrice)}${costs ? `, food cost ${money(costs.foodCost)}, ${pct(costs.foodCostPct)}, margin ${money(costs.margin)}` : ""}${over !== null ? `, over the ${over}% target` : ""}, ${label}${waste ? `, ${waste}` : ""}`}
                          onPress={() => router.push({ pathname: "/menu-item/[menuItemId]", params: { menuItemId: item.menuItemId } })}
                          style={[{ minHeight: size.tap, paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.xs }, rowDivider(index, c.border)]}
                        >
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.md }}>
                            <Text variant="heading" style={{ flexShrink: 1 }}>{item.name}</Text>
                            <Text style={{ fontFamily: fontFamily.uiStrong }}>{money(item.sellingPrice)}</Text>
                          </View>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.md }}>
                            <Text variant="meta" style={{ flexShrink: 1 }}>{item.category}</Text>
                            {costs ? <Text variant="meta">{`Cost ${money(costs.foodCost)} · Margin ${money(costs.margin)}`}</Text> : null}
                          </View>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                            <Chip label={label} />
                            {costs ? <Text style={{ fontFamily: fontFamily.uiStrong, color: over !== null ? c.danger : c.text }}>{over !== null ? `${pct(costs.foodCostPct)}, over ${over}%` : pct(costs.foodCostPct)}</Text> : null}
                          </View>
                          {waste ? <Text variant="meta" style={{ color: c.danger }}>{waste}</Text> : null}
                        </Pressable>
                      );
                    })}
                  </Surface>
                </View>
              )}
            </>
          ) : null}
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

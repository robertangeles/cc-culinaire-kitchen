import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ITEM_TYPES, type StockAtLocation } from "@culinaire/shared/schemas/storeRoom";
import { ApiError } from "../../../../src/api/client";
import { useSession } from "../../../../src/runtime/appContext";
import { hasAnyPermission } from "../../../../src/shell/tabs";
import { useStock } from "../../../../src/stock/StockProvider";
import { areasOf, categoryLabel, qtyText } from "../../../../src/stock/stockView";
import { Button } from "../../../../src/ui/Button";
import { Column } from "../../../../src/ui/Column";
import { Text } from "../../../../src/ui/Text";
import { Chip, Surface, rowDivider } from "../../../../src/ui/Surface";
import { fontFamily, space } from "../../../../src/theme";
import { useColors } from "../../../../src/ui/theme";

/**
 * One catalogue item: its store-room stock here against par (a dash where the quantity is hidden or not counted), whether the server counts
 * it as low or critical, the areas it is kept in here, and, for managers, its stock at every location.
 */
export default function ItemScreen() {
  const { state } = useSession();
  const { store, snap } = useStock();
  const router = useRouter();
  const c = useColors();
  const { ingredientId } = useLocalSearchParams<{ ingredientId: string }>();
  const id = Array.isArray(ingredientId) ? ingredientId[0] : (ingredientId ?? "");
  const canManage = state.phase === "ready" && hasAnyPermission(state.user, ["inventory:manage"]);
  const [elsewhere, setElsewhere] = useState<StockAtLocation[] | null>(null);
  const [elsewhereError, setElsewhereError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    let live = true;
    store.elsewhere(id).then(
      (rows) => live && setElsewhere(rows),
      (err) => live && setElsewhereError(err instanceof ApiError && (err.code === "network" || err.code === "timeout") ? "Other locations show when you're back online." : err instanceof Error ? err.message : "Something went wrong."),
    );
    return () => void (live = false);
  }, [canManage, id, store]);

  if (state.phase !== "ready") return null;
  const item = snap.items.find((i) => i.ingredientId === id);
  const level = snap.dashboard?.stockLevels.find((l) => l.ingredientId === id);
  const name = item?.ingredientName ?? level?.ingredientName;
  const unit = item?.baseUnit ?? level?.baseUnit ?? "";
  const summary = snap.dashboard?.stockSummary;
  const flag = summary?.criticalIngredientIds.includes(id) ? "Critical, reorder now" : summary?.lowIngredientIds.includes(id) ? "Low stock" : null;
  const areas = areasOf(id, snap.assignments, snap.areas);
  const fact = (label: string, value: string) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
      <Text variant="meta">{label}</Text>
      <Text style={{ fontFamily: fontFamily.uiStrong }}>{value}</Text>
    </View>
  );

  if (!name) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <ScrollView contentContainerStyle={{ padding: space.xl }}>
          <Column style={{ gap: space.lg }}>
            <Text variant="title">Item not found</Text>
            <Text variant="muted">This item is not in the catalogue downloaded to this phone. Pull down on Stock to download it again.</Text>
            <Button kind="quiet" label="Back" onPress={() => router.back()} />
          </Column>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.xl }}>
        <Column style={{ gap: space.lg }}>
          <Text variant="title">{name}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            <Chip label={categoryLabel(item?.ingredientCategory ?? level?.ingredientCategory ?? "")} />
            {item?.itemType ? <Chip label={ITEM_TYPES[item.itemType as keyof typeof ITEM_TYPES]?.label ?? item.itemType} /> : null}
            {flag ? <Chip label={flag} /> : null}
          </View>

          <View style={{ gap: space.xs }}>
            <Text variant="label">{`Store room, ${state.location.locationName}`}</Text>
            <Surface>
              <View style={{ padding: space.lg, gap: space.sm }}>
                {fact("On hand", qtyText(item ? item.currentQty : level?.currentQty, unit))}
                {fact("Par", qtyText(item?.parLevel ?? level?.parLevel, unit))}
                {item?.lastCountedDttm ? fact("Last counted", new Date(item.lastCountedDttm).toLocaleDateString([], { day: "numeric", month: "short" })) : null}
                {item?.supplierName ? fact("Supplier", item.supplierName) : null}
                {item && !item.activeInd ? <Text variant="muted">Not used at this location.</Text> : null}
              </View>
            </Surface>
          </View>

          <View style={{ gap: space.xs }}>
            <Text variant="label">Kept in</Text>
            {areas.length > 0 ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>{areas.map((a) => <Chip key={a} label={a} />)}</View>
            ) : (
              <Text variant="muted">Not placed in an area at this location.</Text>
            )}
            <Text variant="meta">Stock is kept per location, not per area: the areas say where to find it.</Text>
          </View>

          {canManage ? (
            <View style={{ gap: space.xs }}>
              <Text variant="label">At every location</Text>
              {elsewhereError ? <Text variant="muted">{elsewhereError}</Text> : null}
              {elsewhere ? (
                <Surface>
                  {elsewhere.map((l, index) => (
                    <View key={l.storeLocationId} accessible accessibilityLabel={`${l.locationName}, on hand ${qtyText(l.currentQty, unit)}, par ${qtyText(l.parLevel, unit)}`} style={[{ paddingVertical: space.md, paddingHorizontal: space.lg, flexDirection: "row", justifyContent: "space-between", gap: space.md }, rowDivider(index, c.border)]}>
                      <Text style={{ flexShrink: 1 }}>{l.locationName}</Text>
                      <Text variant="meta">{`${qtyText(l.currentQty, unit)} / par ${qtyText(l.parLevel, unit)}`}</Text>
                    </View>
                  ))}
                </Surface>
              ) : !elsewhereError ? (
                <Text variant="muted">Loading…</Text>
              ) : null}
            </View>
          ) : null}
          <Button kind="quiet" label="Back" onPress={() => router.back()} />
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

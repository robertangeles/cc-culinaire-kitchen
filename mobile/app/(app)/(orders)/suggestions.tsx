import { useCallback, useState } from "react";
import { Linking, RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../../src/runtime/appContext";
import { ListState } from "../../../src/orders/ListState";
import { useList, useOrders } from "../../../src/orders/OrdersProvider";
import { dialable, itemCount, money, stockAgainstPar, suggestedOrder } from "../../../src/orders/orderView";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { Text } from "../../../src/ui/Text";
import { fontFamily, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/**
 * The web's reorder suggestions: every item at or below par at this location, grouped by its preferred supplier, with what to order to
 * bring it back to par. A list to read and call from, as on the web; nothing is ordered here.
 */
export default function Suggestions() {
  const { state } = useSession();
  const { suggestions, suppliers, rights } = useOrders();
  const snap = useList(suggestions);
  const known = useList(suppliers);
  const router = useRouter();
  const c = useColors();
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    await Promise.all([rights.suggestions ? suggestions.refresh() : null, rights.suggestions && rights.suppliers ? suppliers.refresh() : null]);
  }, [suggestions, suppliers, rights]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  if (state.phase !== "ready") return null;

  const lines = snap.items.reduce((n, b) => n + b.lines.length, 0);
  const total = snap.items.reduce((n, b) => n + (b.estimatedTotal ?? 0), 0);
  const phoneOf = (supplierId: string | null) => dialable(known.items.find((s) => s.supplierId === supplierId)?.contactPhone ?? null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <Column style={{ gap: space.lg }}>
          <ScreenHeader label={state.location.locationName} title="Reorder suggestions" />
          {rights.suggestions ? (
            <ListState list={suggestions} snap={snap} loading="Working out what is below par…" empty={{ title: "All stocked up", text: "Nothing is below par at this location right now." }}>
              <Text>
                {`${itemCount(lines)} below par`}
                {total > 0 ? `, about ${money(total)} to order` : ""}
              </Text>
              {snap.items.map((block) => {
                const phone = phoneOf(block.supplierId);
                return (
                  <View key={block.supplierId ?? "none"} style={{ gap: space.xs }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.md }}>
                      <Text variant="label" style={{ flexShrink: 1 }}>{`${block.supplierName} · ${itemCount(block.lines.length)}`}</Text>
                      {block.estimatedTotal ? <Text variant="meta">{`About ${money(block.estimatedTotal)}`}</Text> : null}
                    </View>
                    <Surface>
                      {block.lines.map((l, i) => {
                        const order = suggestedOrder(l);
                        return (
                          <View key={l.ingredientId} style={[{ paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.xs }, rowDivider(i, c.border)]}>
                            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                              <Text variant="heading" style={{ flexShrink: 1 }}>{l.ingredientName}</Text>
                              {order ? <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText }}>{order}</Text> : null}
                            </View>
                            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
                              <Text variant="meta" style={{ flexShrink: 1 }}>{stockAgainstPar(l)}</Text>
                              {l.estimatedCost !== null ? <Text variant="meta">{money(l.estimatedCost)}</Text> : null}
                            </View>
                          </View>
                        );
                      })}
                    </Surface>
                    {phone ? <Button kind="quiet" label={`Call ${block.supplierName}`} onPress={() => void Linking.openURL(`tel:${phone}`).catch(() => undefined)} /> : null}
                  </View>
                );
              })}
            </ListState>
          ) : (
            <Text variant="muted">You don&apos;t have permission to see reorder suggestions.</Text>
          )}
          <Button kind="quiet" label="Back to orders" onPress={() => router.back()} />
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

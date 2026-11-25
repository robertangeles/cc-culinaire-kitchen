import { useCallback, useState } from "react";
import { Alert, RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Sale } from "@culinaire/shared/schemas/menu";
import { useSession } from "../../../src/runtime/appContext";
import { hasAnyPermission } from "../../../src/shell/tabs";
import { useMenu } from "../../../src/menu/MenuProvider";
import { isOffline } from "../../../src/menu/menuStore";
import { amount } from "../../../src/menu/menuView";
import { dayAndTime } from "../../../src/transfers/transferView";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { Chip, Surface, rowDivider } from "../../../src/ui/Surface";
import { space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** The latest sales at this location. Voiding one puts its stock back; it is offered to its recorder and organisation admins who hold `menu:manage`. */
export default function MenuSales() {
  const { state } = useSession();
  const { store } = useMenu();
  const router = useRouter();
  const c = useColors();
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [voiding, setVoiding] = useState(false);

  const load = useCallback(async () => {
    try {
      setSales(await store.sales());
      setError(null);
    } catch (err) {
      setError(isOffline(err) ? "Recent sales show when you're back online." : err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  }, [store]);
  useFocusEffect(useCallback(() => void load(), [load]));
  if (state.phase !== "ready") return null;
  const mayVoid = hasAnyPermission(state.user, ["menu:manage"]);

  function confirmVoid(s: Sale) {
    Alert.alert(`Void ${amount(s.qtySold)} × ${s.menuItemName}?`, "The stock it used is put back. This cannot be undone.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Void",
        style: "destructive",
        onPress: async () => {
          setVoiding(true);
          try {
            await store.voidSale(s.saleId);
            await load();
          } catch (err) {
            setError(isOffline(err) ? "The server can't be reached, so the sale may not be voided. Pull down to check, then try again." : err instanceof Error ? err.message : "Something went wrong. Try again.");
          }
          setVoiding(false);
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.xl }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <Column style={{ gap: space.lg }}>
          <Text variant="title">Recent sales</Text>
          <Text variant="meta">{state.location.locationName}</Text>
          {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
          {error && !sales ? <Button label="Try again" onPress={() => void load()} /> : null}
          {!sales && !error ? <Text variant="muted">Loading…</Text> : null}
          {sales?.length === 0 ? (
            <Surface>
              <View style={{ padding: space.lg, gap: space.xs }}>
                <Text variant="heading">No sales yet</Text>
                <Text variant="muted">Sales recorded at this location show here.</Text>
              </View>
            </Surface>
          ) : null}
          {sales && sales.length > 0 ? (
            <Surface>
              {sales.map((s, index) => (
                <View key={s.saleId} style={[{ paddingVertical: space.md, paddingHorizontal: space.lg, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }, rowDivider(index, c.border)]}>
                  <View style={{ flexShrink: 1, gap: 2 }}>
                    <Text variant="heading">{`${amount(s.qtySold)} × ${s.menuItemName}`}</Text>
                    <Text variant="meta">{dayAndTime(s.soldAt)}</Text>
                  </View>
                  {s.voidedAt ? <Chip label="Voided" /> : mayVoid && s.canManage !== false ? <Button kind="quiet" label="Void" disabled={voiding} onPress={() => confirmVoid(s)} /> : null}
                </View>
              ))}
            </Surface>
          ) : null}
          <Button kind="quiet" label="Back" onPress={() => router.back()} />
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { DiscrepancyRows } from "../../../src/orders/DiscrepancyRows";
import { ListState } from "../../../src/orders/ListState";
import { useList, useOrders } from "../../../src/orders/OrdersProvider";
import { dayLabel, money } from "../../../src/orders/orderView";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { Segmented } from "../../../src/ui/Segmented";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { Text } from "../../../src/ui/Text";
import { fontFamily, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** Delivery problems still to claim from suppliers, and the credit notes already raised. The whole organisation's, as on the server. */
export default function CreditNotes() {
  const { discrepancies, credits, rights } = useOrders();
  const router = useRouter();
  const c = useColors();
  const [view, setView] = useState<"open" | "raised">("open");
  const open = useList(discrepancies);
  const raised = useList(credits);
  const [refreshing, setRefreshing] = useState(false);
  const list = view === "open" ? discrepancies : credits;
  useFocusEffect(
    useCallback(() => {
      if (rights.credit) void list.refresh();
    }, [list, rights.credit]),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await list.refresh(); setRefreshing(false); }} />}
      >
        <Column style={{ gap: space.lg }}>
          <ScreenHeader label="All locations" title="Credit notes" />
          {rights.credit ? (
            <>
              <Segmented options={[{ value: "open", label: "To claim" }, { value: "raised", label: "Raised" }]} value={view} onChange={setView} />
              {view === "open" ? (
                <ListState list={discrepancies} snap={open} loading="Loading what can be claimed…" empty={{ title: "Nothing to claim", text: "Short, rejected or overpriced items on a confirmed delivery appear here until a credit note is raised." }}>
                  <DiscrepancyRows items={open.items} onPress={(d) => router.push({ pathname: "/credit-note-entry", params: { discrepancyId: d.discrepancyId, supplierId: d.supplierId } })} />
                </ListState>
              ) : (
                <ListState list={credits} snap={raised} loading="Loading credit notes…" empty={{ title: "No credit notes yet", text: "Credit notes raised from a delivery problem are kept here." }}>
                  <Surface>
                    {raised.items.map((n, i) => (
                      <View key={n.creditNoteId} style={[{ paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.xs }, rowDivider(i, c.border)]}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                          <Text variant="heading" style={{ flexShrink: 1 }}>{n.creditReference ?? "No reference"}</Text>
                          <Text style={{ fontFamily: fontFamily.uiStrong }}>{money(n.creditAmount)}</Text>
                        </View>
                        {dayLabel(n.createdAt) ? <Text variant="meta">{dayLabel(n.createdAt)}</Text> : null}
                        {n.notes ? <Text variant="muted">{n.notes}</Text> : null}
                      </View>
                    ))}
                  </Surface>
                </ListState>
              )}
            </>
          ) : (
            <Text variant="muted">You don&apos;t have permission to raise credit notes.</Text>
          )}
          <Button kind="quiet" label="Back to orders" onPress={() => router.back()} />
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

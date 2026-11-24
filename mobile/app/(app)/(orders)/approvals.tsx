import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../../src/runtime/appContext";
import { ListState } from "../../../src/orders/ListState";
import { OrderRow } from "../../../src/orders/OrderRow";
import { useList, useOrders } from "../../../src/orders/OrdersProvider";
import { byWait } from "../../../src/orders/orderView";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { Surface } from "../../../src/ui/Surface";
import { Text } from "../../../src/ui/Text";
import { space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** Orders at this location waiting for approval, longest wait first. Approve and Reject are on the order itself, under its items. */
export default function Approvals() {
  const { state } = useSession();
  const { approvals, rights } = useOrders();
  const router = useRouter();
  const c = useColors();
  const snap = useList(approvals);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setNow(Date.now()), [snap]);
  useFocusEffect(
    useCallback(() => {
      if (rights.approve) void approvals.refresh();
    }, [approvals, rights.approve]),
  );
  if (state.phase !== "ready") return null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await approvals.refresh(); setRefreshing(false); }} />}
      >
        <Column style={{ gap: space.lg }}>
          <ScreenHeader label={state.location.locationName} title="Approvals" />
          {rights.approve ? (
            <ListState list={approvals} snap={snap} loading="Loading approvals…" empty={{ title: "Nothing to approve", text: "Orders over your kitchen's spending limit wait here until someone approves them." }}>
              <Surface>
                {byWait(snap.items).map((order, index) => (
                  <OrderRow key={order.poId} order={order} index={index} now={now} queue onPress={() => router.push({ pathname: "/order", params: { poId: order.poId } })} />
                ))}
              </Surface>
            </ListState>
          ) : (
            <Text variant="muted">You don&apos;t have permission to approve orders.</Text>
          )}
          <Button kind="quiet" label="Back to orders" onPress={() => router.back()} />
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

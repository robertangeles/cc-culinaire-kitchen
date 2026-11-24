import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../../src/runtime/appContext";
import { isEmpty } from "../../../src/orders/draft";
import { ListState } from "../../../src/orders/ListState";
import { OrderRow } from "../../../src/orders/OrderRow";
import { useDraft, useList, useOrders } from "../../../src/orders/OrdersProvider";
import { FILTERS, itemCount, type FilterLabel } from "../../../src/orders/orderView";
import { Button } from "../../../src/ui/Button";
import { ChoiceChips } from "../../../src/ui/ChoiceChips";
import { Column } from "../../../src/ui/Column";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { Chip, Surface, rowDivider } from "../../../src/ui/Surface";
import { Text } from "../../../src/ui/Text";
import { fontFamily, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

const FILTER_LABELS = FILTERS.map((f) => f.label);

/** This location's purchase orders, with the way in to approvals and credit notes for the people who hold them. */
export default function Orders() {
  const { state } = useSession();
  const { list: listFor, approvals, discrepancies, rights } = useOrders();
  const { snap: draftSnap } = useDraft();
  const router = useRouter();
  const c = useColors();
  const [filter, setFilter] = useState<FilterLabel>("All");
  const [refreshing, setRefreshing] = useState(false);
  const list = listFor(filter);
  const snap = useList(list);
  const pending = useList(approvals);
  const toCredit = useList(discrepancies);

  const load = useCallback(async () => {
    await Promise.all([rights.list ? list.refresh() : null, rights.list && rights.approve ? approvals.refresh() : null, rights.credit ? discrepancies.refresh() : null]);
  }, [list, approvals, discrepancies, rights]);

  // On focus, not only on mount: coming back from an order returns to this still-mounted screen.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  // "Waiting 25 h" is read at this moment, refreshed whenever the rows are.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setNow(Date.now()), [snap]);

  if (state.phase !== "ready") return null;

  const count = (s: { items: unknown[]; hasMore: boolean }) => (s.items.length === 0 ? null : `${s.items.length}${s.hasMore ? "+" : ""}`);
  const links = [
    rights.list && rights.approve ? { label: "Approvals", badge: count(pending), says: "waiting", href: "/approvals" as const } : null,
    rights.credit ? { label: "Credit notes", badge: count(toCredit), says: "to claim", href: "/credit-notes" as const } : null,
  ].filter((l) => l !== null);
  const unfinished = !isEmpty(draftSnap.draft);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <Column style={{ gap: space.lg }}>
          <ScreenHeader label={state.location.locationName} title="Orders" />
          {rights.create ? <Button label={unfinished ? `Continue your order${draftSnap.draft.lines.length > 0 ? ` · ${itemCount(draftSnap.draft.lines.length)}` : ""}` : "New order"} onPress={() => router.push("/order-new")} /> : null}

          {links.length > 0 ? (
            <Surface>
              {links.map((l, i) => (
                <Pressable
                  key={l.href}
                  accessibilityRole="button"
                  accessibilityLabel={l.badge ? `${l.label}, ${l.badge} ${l.says}` : l.label}
                  onPress={() => router.push(l.href)}
                  style={({ pressed }) => [{ minHeight: size.tap, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, backgroundColor: pressed ? c.surface : undefined }, rowDivider(i, c.border)]}
                >
                  <Text style={{ flex: 1, fontFamily: fontFamily.uiStrong }}>{l.label}</Text>
                  {l.badge ? <Chip label={`${l.badge} ${l.says}`} /> : null}
                  <Text style={{ color: c.accentText, fontSize: 22 }}>›</Text>
                </Pressable>
              ))}
            </Surface>
          ) : null}

          {rights.list ? (
            <>
              <ChoiceChips label="Show" options={FILTER_LABELS} value={filter} onChange={(f) => f && setFilter(f)} />
              <ListState
                list={list}
                snap={snap}
                loading="Loading orders…"
                empty={filter === "All" ? { title: "No orders yet", text: "Purchase orders raised at this location appear here, newest first." } : { title: "Nothing here", text: "No orders at this location match this filter." }}
              >
                <Surface>
                  {snap.items.map((order, index) => (
                    <OrderRow key={order.poId} order={order} index={index} now={now} onPress={() => router.push({ pathname: "/order", params: { poId: order.poId } })} />
                  ))}
                </Surface>
              </ListState>
            </>
          ) : null}
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

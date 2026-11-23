import { useCallback, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../../src/runtime/appContext";
import { useStock } from "../../../src/stock/StockProvider";
import { alertLists, valueRows, type AlertItem } from "../../../src/stock/stockView";
import { dayAndTime } from "../../../src/transfers/transferView";
import { OfflineBanner } from "../../../src/ui/Banner";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { fontFamily, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/**
 * The location's stock at a glance, with the server's figures: what is critical (at or under a quarter of par) and low (at or under three
 * quarters), for everyone who may see stock; the stock value only for `inventory:cost` holders. Each list opens to its items, and each
 * item to its page. With no signal it shows the last download and its time.
 */
export default function StockHome() {
  const { state } = useSession();
  const { store, snap } = useStock();
  const router = useRouter();
  const c = useColors();
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<"critical" | "low" | null>(null);
  const seen = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (seen.current) void store.refresh();
      seen.current = true;
    }, [store]),
  );
  if (state.phase !== "ready") return null;
  const caps = { fontFamily: fontFamily.uiStrong, fontSize: 12, letterSpacing: 1.8, textTransform: "uppercase", color: c.accentText } as const;
  const d = snap.dashboard;
  const alerts = d ? alertLists(d, snap.items) : { critical: [], low: [] };
  const value = d ? valueRows(d) : null;
  const waiting = snap.requests.filter((r) => r.state === "waiting" || r.state === "attention").length;

  const alertGroup = (key: "critical" | "low", title: string, hint: string, items: AlertItem[], tone: string) => (
    <Surface>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open === key }}
        accessibilityLabel={`${title}: ${items.length} ${items.length === 1 ? "item" : "items"}`}
        onPress={() => setOpen(open === key ? null : key)}
        style={{ minHeight: size.tap, padding: space.lg, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}
      >
        <View style={{ flexShrink: 1, gap: 2 }}>
          <Text style={{ fontFamily: fontFamily.title, fontSize: 20, color: tone }}>{title}</Text>
          <Text variant="meta">{hint}</Text>
        </View>
        <Text style={{ fontFamily: fontFamily.title, fontSize: 28, color: tone }}>{items.length}</Text>
      </Pressable>
      {open === key
        ? items.map((a, index) => (
            <Pressable
              key={a.ingredientId}
              accessibilityRole="button"
              accessibilityLabel={`${a.name}, on hand ${a.onHand}, par ${a.par}`}
              onPress={() => router.push({ pathname: "/item/[ingredientId]", params: { ingredientId: a.ingredientId } })}
              style={[{ minHeight: size.tap, paddingVertical: space.md, paddingHorizontal: space.lg, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }, rowDivider(index === 0 ? 1 : index, c.border)]}
            >
              <Text style={{ flexShrink: 1 }}>{a.name}</Text>
              <Text variant="meta">{`${a.onHand} / par ${a.par}`}</Text>
            </Pressable>
          ))
        : null}
    </Surface>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await store.refresh(); setRefreshing(false); }} />}
      >
        <Column style={{ gap: space.lg }}>
          <Text variant="title">Stock</Text>
          <Text variant="meta">{state.location.locationName}</Text>
          {snap.offline ? <OfflineBanner text={snap.savedAt ? `You're offline. These are the figures from ${dayAndTime(new Date(snap.savedAt).toISOString())}.` : "You're offline, and the stock figures have not been downloaded to this phone yet. Open this tab once with a signal."} /> : null}
          {snap.phase === "error" ? (
            <>
              <Text variant="error">{snap.error}</Text>
              <Button label="Try again" onPress={() => void store.refresh()} />
            </>
          ) : null}

          {d ? (
            <>
              {alerts.critical.length > 0 ? alertGroup("critical", "Critical, reorder now", "At or under a quarter of par", alerts.critical, c.danger) : null}
              {alerts.low.length > 0 ? alertGroup("low", "Low stock, keep an eye on it", "At or under three quarters of par", alerts.low, c.accentText) : null}
              {alerts.critical.length === 0 && alerts.low.length === 0 ? <Text variant="muted">Nothing is low or critical against its par.</Text> : null}

              {value ? (
                <View style={{ gap: space.xs }}>
                  <Text style={caps}>Stock value</Text>
                  <Surface>
                    <View style={{ padding: space.lg, gap: space.md }}>
                      <Text style={{ fontFamily: fontFamily.title, fontSize: 28 }}>{value.total}</Text>
                      {value.rows.slice(0, 6).map((r) => (
                        <View key={r.label} accessible accessibilityLabel={`${r.label}, ${r.value}`} style={{ gap: 4 }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
                            <Text variant="meta">{r.label}</Text>
                            <Text variant="meta">{r.value}</Text>
                          </View>
                          <View style={{ height: 6, borderRadius: 3, backgroundColor: c.border, overflow: "hidden" }}>
                            <View style={{ width: `${Math.max(2, r.share * 100)}%`, height: 6, backgroundColor: c.accentText }} />
                          </View>
                        </View>
                      ))}
                    </View>
                  </Surface>
                </View>
              ) : null}

              {d.activeSession ? <Text variant="meta">{`Stock take in progress: ${d.activeSession.submitted} of ${d.activeSession.total} submitted`}</Text> : null}
              {d.lastCompletedSession?.closedDttm ? <Text variant="meta">{`Last count: ${new Date(d.lastCompletedSession.closedDttm).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`}</Text> : null}
              {d.stockLevels.length === 0 && alerts.critical.length === 0 && alerts.low.length === 0 ? (
                <Surface>
                  <View style={{ padding: space.lg, gap: space.xs }}>
                    <Text style={{ fontFamily: fontFamily.title, fontSize: 20 }}>No stock figures yet</Text>
                    <Text variant="muted">Run your first stock take to see figures here.</Text>
                  </View>
                </Surface>
              ) : null}
            </>
          ) : null}

          <Button label="Look up an item" onPress={() => router.push("/items")} />
          <Button kind="ghost" label="Ask for a new item" onPress={() => router.push("/request-new")} />
          <Button kind="quiet" label={waiting > 0 ? `My requests (${waiting} waiting)` : "My requests"} onPress={() => router.push("/requests")} />
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

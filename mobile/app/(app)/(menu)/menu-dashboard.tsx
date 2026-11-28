import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { FOOD_COST_ALERT_PCT } from "@culinaire/shared";
import type { MenuItem } from "@culinaire/shared/schemas/menu";
import { useSession } from "../../../src/runtime/appContext";
import { hasAnyPermission } from "../../../src/shell/tabs";
import { useMenu } from "../../../src/menu/MenuProvider";
import { isOffline } from "../../../src/menu/menuStore";
import { QUADRANTS, dashboardOf, money, pct } from "../../../src/menu/menuView";
import { dayAndTime } from "../../../src/transfers/transferView";
import { OfflineBanner } from "../../../src/ui/Banner";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { fontFamily, fontSize, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/**
 * The web's Menu & Costing dashboard (MenuDashboard.tsx): how many items are Stars, Plowhorses, Puzzles and Dogs, the most and least popular,
 * and for `inventory:cost` holders the average food cost and margin and the highest and lowest margin. Recalculate and the units sold import
 * are for `menu:manage` holders, the server's gate. Read from the menu on the phone, so it shows offline too.
 */
export default function MenuDashboard() {
  const { state } = useSession();
  const { store, snap } = useMenu();
  const router = useRouter();
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  if (state.phase !== "ready") return null;
  const canManage = hasAnyPermission(state.user, ["menu:manage"]);
  const d = dashboardOf(snap.items);
  const dogs = snap.items.filter((i) => i.classification === "dog").sort((a, b) => a.name.localeCompare(b.name));
  const open = (item: MenuItem) => router.push({ pathname: "/menu-item/[menuItemId]", params: { menuItemId: item.menuItemId } });

  async function recalculate() {
    setBusy(true);
    setMessage(null);
    try {
      await store.recalculate();
      setMessage({ text: "Every item was priced again and classified.", failed: false });
    } catch (err) {
      setMessage({ text: isOffline(err) ? "Not recalculated: this needs a connection. Try again when you're back online." : err instanceof Error ? err.message : "Something went wrong. Try again.", failed: true });
    }
    setBusy(false);
  }

  const fact = (label: string, value: string, alert = false) => (
    <View key={label} accessible accessibilityLabel={`${label}, ${value}`} style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
      <Text variant="meta" style={{ flexShrink: 1 }}>{label}</Text>
      <Text style={{ fontFamily: fontFamily.uiStrong, color: alert ? c.danger : c.text }}>{value}</Text>
    </View>
  );
  const performers = [
    { label: "Highest margin", item: d.highestMargin, metric: (i: MenuItem) => `${money(i.contributionMargin!)} margin` },
    { label: "Lowest margin", item: d.lowestMargin, metric: (i: MenuItem) => `${money(i.contributionMargin!)} margin` },
    { label: "Most popular", item: d.mostPopular, metric: (i: MenuItem) => `${pct(i.menuMixPct)} of sales` },
    { label: "Least popular", item: d.leastPopular, metric: (i: MenuItem) => `${pct(i.menuMixPct)} of sales` },
  ].flatMap((p) => (p.item ? [{ ...p, item: p.item }] : []));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.xl }}>
        <Column style={{ gap: space.lg }}>
          <Text variant="title">Dashboard</Text>
          <Text variant="muted">Find your Stars. Fix your Dogs.</Text>
          {snap.offline ? <OfflineBanner text={snap.savedAt ? `You're offline. These figures are from the menu of ${dayAndTime(new Date(snap.savedAt).toISOString())}.` : "You're offline, and the menu has not been downloaded to this phone yet."} /> : null}

          {d.totalItems === 0 ? (
            <Surface>
              <View style={{ padding: space.lg, gap: space.xs }}>
                <Text variant="heading">No menu data yet</Text>
                <Text variant="muted">{canManage ? "Add the first menu item to see how the menu performs." : "Items added to your organisation's menu show here."}</Text>
              </View>
            </Surface>
          ) : (
            <>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
                {QUADRANTS.map((q) => (
                  <View key={q.key} accessible accessibilityLabel={`${q.label}, ${d.counts[q.key]}, ${q.sentence}`} style={{ flexBasis: "45%", flexGrow: 1 }}>
                    <Surface>
                      <View style={{ padding: space.lg, gap: space.xs }}>
                        <Text variant="label">{q.label}</Text>
                        <Text style={{ fontFamily: fontFamily.uiStrong, fontSize: fontSize.title, color: c.text }}>{String(d.counts[q.key])}</Text>
                        <Text variant="meta">{q.sentence}</Text>
                      </View>
                    </Surface>
                  </View>
                ))}
              </View>

              <View style={{ gap: space.xs }}>
                <Text variant="label">Key figures</Text>
                <Surface>
                  <View style={{ padding: space.lg, gap: space.sm }}>
                    {fact("Items analysed", String(d.totalItems))}
                    {d.costs ? fact("Average food cost", pct(d.costs.avgFoodCostPct), d.costs.avgFoodCostPct > FOOD_COST_ALERT_PCT) : null}
                    {d.costs ? fact("Average margin", money(d.costs.avgMargin)) : null}
                    {d.costs ? fact("Overall food cost", pct(d.costs.overallFoodCostPct), d.costs.overallFoodCostPct > FOOD_COST_ALERT_PCT) : null}
                  </View>
                </Surface>
              </View>

              <View style={{ gap: space.xs }}>
                <Text variant="label">Top and bottom</Text>
                <Surface>
                  {performers.map((p, index) => (
                    <Pressable
                      key={p.label}
                      accessibilityRole="button"
                      accessibilityLabel={`${p.label}: ${p.item.name}, ${p.metric(p.item)}`}
                      onPress={() => open(p.item)}
                      style={[{ minHeight: size.tap, paddingVertical: space.md, paddingHorizontal: space.lg, gap: 2 }, rowDivider(index, c.border)]}
                    >
                      <Text variant="meta">{p.label}</Text>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.md }}>
                        <Text variant="heading" style={{ flexShrink: 1 }}>{p.item.name}</Text>
                        <Text style={{ fontFamily: fontFamily.uiStrong }}>{p.metric(p.item)}</Text>
                      </View>
                    </Pressable>
                  ))}
                </Surface>
              </View>

              {dogs.length > 0 ? (
                <View style={{ gap: space.xs }}>
                  <Text variant="label">Dogs to rework or replace</Text>
                  <Surface>
                    {dogs.map((item, index) => (
                      <Pressable
                        key={item.menuItemId}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.name}, ${item.category}`}
                        onPress={() => open(item)}
                        style={[{ minHeight: size.tap, paddingVertical: space.md, paddingHorizontal: space.lg, justifyContent: "center" }, rowDivider(index, c.border)]}
                      >
                        <Text variant="heading">{item.name}</Text>
                        <Text variant="meta">{item.category}</Text>
                      </Pressable>
                    ))}
                  </Surface>
                </View>
              ) : null}

              {d.costs ? <Button kind="ghost" label="Engineering matrix" onPress={() => router.push("/menu-matrix")} /> : null}
            </>
          )}

          {canManage ? (
            <View style={{ gap: space.sm }}>
              <Text variant="label">Keep it current</Text>
              <Text variant="muted">Recalculate prices every item at the catalogue's costs again, then works out each one's share of sales and its class.</Text>
              <Button kind="ghost" label={busy ? "Recalculating…" : "Recalculate"} disabled={busy || snap.offline} onPress={() => void recalculate()} />
              {message ? <Text variant={message.failed ? "error" : "muted"} accessibilityLiveRegion="polite">{message.text}</Text> : null}
              <Button kind="quiet" label="Import units sold from a CSV" onPress={() => router.push({ pathname: "/menu-import", params: { kind: "units" } })} />
            </View>
          ) : null}
          <Button kind="quiet" label="Back to the menu" onPress={() => router.back()} />
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

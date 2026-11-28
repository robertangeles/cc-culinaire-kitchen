import { useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type { MenuItem } from "@culinaire/shared/schemas/menu";
import { useMenu } from "../../../src/menu/MenuProvider";
import { QUADRANTS, classInfo, matrixOf, money, pct } from "../../../src/menu/menuView";
import { OfflineBanner } from "../../../src/ui/Banner";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { fontFamily, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** Wider than this, the chart takes the screen's width as the web's does; the list under it keeps the column. */
const WIDE = 700;
const CHART_MAX = 1100;
const DOT = 16;

/**
 * The web's engineering matrix (MenuEngineeringMatrix.tsx): every item that sold, placed by its share of sales (across) and its margin (up),
 * the lines at the averages. A dot opens its item's figures; the same items are listed under the chart by class, so nothing needs a precise
 * tap. Only for `inventory:cost` holders: it is drawn from margins, so the menu offers it to nobody else.
 */
export default function MenuMatrix() {
  const { snap } = useMenu();
  const router = useRouter();
  const c = useColors();
  const { width } = useWindowDimensions();
  const [picked, setPicked] = useState<string | null>(null);
  const matrix = matrixOf(snap.items);
  const wide = width >= WIDE;
  const tone: Record<string, string> = { star: c.accentText, plowhorse: "#3B6E9E", puzzle: "#7A5A99", dog: c.textMuted };
  const open = (item: MenuItem) => router.push({ pathname: "/menu-item/[menuItemId]", params: { menuItemId: item.menuItemId } });
  const chosen = matrix?.points.find((p) => p.item.menuItemId === picked)?.item;
  const corner = (label: string, color: string, at: object) => (
    <Text variant="meta" style={[{ position: "absolute", color, fontFamily: fontFamily.uiStrong }, at]}>{label}</Text>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
        <Column style={{ gap: space.lg }}>
          <Text variant="title">Engineering matrix</Text>
          <Text variant="muted">Each item that sold, placed by how popular it is (across) and what it earns per sale (up). The lines are the averages.</Text>
          {snap.offline ? <OfflineBanner text="You're offline. This is the menu as last downloaded." /> : null}
        </Column>

        {!matrix ? (
          <Column>
            <Surface>
              <View style={{ padding: space.lg, gap: space.xs }}>
                <Text variant="heading">Not enough sales yet</Text>
                <Text variant="muted">The matrix needs at least two items with units sold. Record sales or import them to see it.</Text>
              </View>
            </Surface>
          </Column>
        ) : (
          <>
            <View style={{ width: "100%", maxWidth: wide ? CHART_MAX : undefined, alignSelf: "center", gap: space.xs }}>
              <Text variant="label">↑ Margin per sale</Text>
              <View style={{ width: "100%", aspectRatio: wide ? 3 / 2 : 1, borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.field, overflow: "hidden" }}>
                <View style={{ position: "absolute", left: 0, top: 0, width: `${matrix.avgX}%`, height: `${matrix.avgY}%`, backgroundColor: tone.puzzle, opacity: 0.07 }} />
                <View style={{ position: "absolute", left: `${matrix.avgX}%`, right: 0, top: 0, height: `${matrix.avgY}%`, backgroundColor: tone.star, opacity: 0.09 }} />
                <View style={{ position: "absolute", left: `${matrix.avgX}%`, right: 0, top: `${matrix.avgY}%`, bottom: 0, backgroundColor: tone.plowhorse, opacity: 0.07 }} />
                <View style={{ position: "absolute", left: `${matrix.avgX}%`, top: 0, bottom: 0, width: 1, backgroundColor: c.border }} />
                <View style={{ position: "absolute", top: `${matrix.avgY}%`, left: 0, right: 0, height: 1, backgroundColor: c.border }} />
                {corner("Puzzles", tone.puzzle, { left: space.sm, top: space.sm })}
                {corner("Stars", tone.star, { right: space.sm, top: space.sm })}
                {corner("Dogs", tone.dog, { left: space.sm, bottom: space.sm })}
                {corner("Plowhorses", tone.plowhorse, { right: space.sm, bottom: space.sm })}
                {matrix.points.map(({ item, x, y }) => {
                  const on = item.menuItemId === picked;
                  return (
                    <Pressable
                      key={item.menuItemId}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.name}: margin ${money(item.contributionMargin!)}, ${pct(item.menuMixPct)} of sales, ${classInfo(item.classification).label}`}
                      onPress={() => setPicked(on ? null : item.menuItemId)}
                      style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: size.tap, height: size.tap, marginLeft: -size.tap / 2, marginTop: -size.tap / 2, alignItems: "center", justifyContent: "center", zIndex: on ? 2 : 1 }}
                    >
                      <View style={{ width: on ? DOT * 1.5 : DOT, height: on ? DOT * 1.5 : DOT, borderRadius: DOT, borderWidth: 2, borderColor: c.surface, backgroundColor: tone[item.classification] ?? c.textMuted }} />
                    </Pressable>
                  );
                })}
              </View>
              <Text variant="label" style={{ alignSelf: "flex-end" }}>Popularity, share of sales →</Text>
            </View>

            <Column style={{ gap: space.lg }}>
              {chosen ? (
                <Surface>
                  <View style={{ padding: space.lg, gap: space.sm }} accessibilityLiveRegion="polite">
                    <Text variant="heading">{chosen.name}</Text>
                    <Text variant="meta">{`${classInfo(chosen.classification).label} · Margin ${money(chosen.contributionMargin!)} · ${pct(chosen.menuMixPct)} of sales`}</Text>
                    <Button kind="ghost" label={`Open ${chosen.name}`} onPress={() => open(chosen)} />
                  </View>
                </Surface>
              ) : null}

              {QUADRANTS.map((q) => {
                const mine = matrix.points.filter((p) => p.item.classification === q.key).map((p) => p.item).sort((a, b) => b.contributionMargin! - a.contributionMargin!);
                return (
                  <View key={q.key} style={{ gap: space.xs }}>
                    <Text variant="label">{`${q.label} · ${mine.length}`}</Text>
                    {mine.length === 0 ? <Text variant="meta">None</Text> : (
                      <Surface>
                        {mine.map((item, index) => (
                          <Pressable
                            key={item.menuItemId}
                            accessibilityRole="button"
                            accessibilityLabel={`${item.name}, margin ${money(item.contributionMargin!)}, ${pct(item.menuMixPct)} of sales`}
                            onPress={() => open(item)}
                            style={[{ minHeight: size.tap, paddingVertical: space.md, paddingHorizontal: space.lg, flexDirection: "row", alignItems: "center", gap: space.md }, rowDivider(index, c.border)]}
                          >
                            <View style={{ width: DOT / 1.5, height: DOT / 1.5, borderRadius: DOT, backgroundColor: tone[q.key] }} />
                            <Text style={{ flex: 1, fontFamily: fontFamily.title }}>{item.name}</Text>
                            <Text variant="meta">{`${money(item.contributionMargin!)} · ${pct(item.menuMixPct)}`}</Text>
                          </Pressable>
                        ))}
                      </Surface>
                    )}
                  </View>
                );
              })}
            </Column>
          </>
        )}
        <Column>
          <Button kind="quiet" label="Back" onPress={() => router.back()} />
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

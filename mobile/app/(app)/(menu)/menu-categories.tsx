import { useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../../src/runtime/appContext";
import { hasAnyPermission } from "../../../src/shell/tabs";
import { useMenu } from "../../../src/menu/MenuProvider";
import { isOffline } from "../../../src/menu/menuStore";
import { amount, categoryRows, pct, type CategoryRow } from "../../../src/menu/menuView";
import { OfflineBanner } from "../../../src/ui/Banner";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { TextField } from "../../../src/ui/TextField";
import { Surface } from "../../../src/ui/Surface";
import { fontFamily, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/**
 * The food cost target of each category on the menu, and (for `inventory:cost` holders) what its items cost on average and which are over.
 * Changing a target is for `menu:manage` holders. A category appears when an item is given it, as on the web.
 */
export default function MenuCategories() {
  const { state } = useSession();
  const { store, snap } = useMenu();
  const router = useRouter();
  const c = useColors();
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ category: string; text: string; failed: boolean } | null>(null);
  if (state.phase !== "ready") return null;
  const canManage = hasAnyPermission(state.user, ["menu:manage"]);
  const rows = categoryRows(snap.items, snap.targets);

  async function save(row: CategoryRow) {
    setSaving(row.category);
    setMessage(null);
    try {
      await store.setTarget(row.category, typed[row.category]);
      setTyped(({ [row.category]: _saved, ...rest }) => rest);
      setMessage({ category: row.category, text: "Saved.", failed: false });
    } catch (err) {
      setMessage({ category: row.category, text: isOffline(err) ? "Not saved: this needs a connection. Try again when you're back online." : err instanceof Error ? err.message : "Something went wrong. Try again.", failed: true });
    }
    setSaving(null);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
          <Column style={{ gap: space.lg }}>
            <Text variant="title">Category targets</Text>
            <Text variant="muted">The most of its price an item's ingredients should cost. An item over its category's target is marked on the menu. The targets are your own.</Text>
            {snap.offline ? <OfflineBanner text="You're offline. Changing a target needs a connection." /> : null}
            {rows.length === 0 ? (
              <Surface>
                <View style={{ padding: space.lg, gap: space.xs }}>
                  <Text variant="heading">No categories yet</Text>
                  <Text variant="muted">Categories appear here from the items on the menu.</Text>
                </View>
              </Surface>
            ) : null}
            {rows.map((row) => (
              <Surface key={row.category}>
                <View style={{ padding: space.lg, gap: space.md }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.md }}>
                    <Text variant="heading" style={{ flexShrink: 1 }}>{row.category}</Text>
                    <Text variant="meta">{`${row.count} ${row.count === 1 ? "item" : "items"}`}</Text>
                  </View>
                  {row.actual !== null ? (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
                      <Text variant="meta">Actual</Text>
                      <Text style={{ fontFamily: fontFamily.uiStrong, color: row.actual > row.target ? c.danger : c.success }}>{pct(row.actual)}</Text>
                    </View>
                  ) : null}
                  {canManage ? (
                    <>
                      <TextField label={`Target for ${row.category}, in %`} value={typed[row.category] ?? amount(row.target)} onChangeText={(t) => setTyped((all) => ({ ...all, [row.category]: t }))} keyboardType="decimal-pad" returnKeyType="done" />
                      {typed[row.category] !== undefined ? <Button kind="ghost" label={`Save the target for ${row.category}`} disabled={saving !== null} onPress={() => void save(row)} /> : null}
                    </>
                  ) : (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
                      <Text variant="meta">Target</Text>
                      <Text style={{ fontFamily: fontFamily.uiStrong }}>{`${amount(row.target)}%`}</Text>
                    </View>
                  )}
                  {message?.category === row.category ? <Text variant={message.failed ? "error" : "muted"} accessibilityLiveRegion="polite">{message.text}</Text> : null}
                  {row.over.length > 0 ? (
                    <View>
                      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === row.category }} onPress={() => setOpen(open === row.category ? null : row.category)} style={{ minHeight: size.tap, justifyContent: "center" }}>
                        <Text style={{ fontFamily: fontFamily.uiStrong, color: c.danger }}>{`${row.over.length} over ${amount(row.target)}%, ${open === row.category ? "hide" : "show"}`}</Text>
                      </Pressable>
                      {open === row.category
                        ? row.over.map((i) => (
                            <View key={i.menuItemId} style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md, paddingVertical: space.xs }}>
                              <Text style={{ flexShrink: 1 }}>{i.name}</Text>
                              <Text style={{ fontFamily: fontFamily.uiStrong, color: c.danger }}>{pct(i.foodCostPct!)}</Text>
                            </View>
                          ))
                        : null}
                    </View>
                  ) : null}
                </View>
              </Surface>
            ))}
            <Button kind="quiet" label="Back to the menu" onPress={() => router.back()} />
          </Column>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

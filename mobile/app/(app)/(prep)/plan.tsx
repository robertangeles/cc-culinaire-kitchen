import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type { PrepSelectionInput } from "@culinaire/shared/schemas/prep";
import { usePrep } from "../../../src/prep/PrepProvider";
import type { PrepChoices } from "../../../src/prep/prepStore";
import { OfflineBanner } from "../../../src/ui/Banner";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { TextField } from "../../../src/ui/TextField";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { fontFamily, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

interface Dish {
  /** `m:<id>` for a menu item, `r:<id>` for a recipe: the web's keys. */
  key: string;
  name: string;
  category: string | null;
  menuItemId?: string;
  recipeId?: string;
}

const asCount = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : 0);

/** Pick the dishes and how many portions of each, then make today's list. Saved on the phone and sent when it can be. */
export default function PrepPlan() {
  const { store, canPlan } = usePrep();
  const router = useRouter();
  const c = useColors();
  const [choices, setChoices] = useState<PrepChoices | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [portions, setPortions] = useState<Record<string, number>>({});
  const [find, setFind] = useState("");
  const [covers, setCovers] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canPlan) return;
    let live = true;
    store.loadChoices().then((r) => live && setChoices(r), (err: unknown) => live && setLoadError(err instanceof Error ? err.message : "Something went wrong. Try again."));
    return () => { live = false; };
  }, [store, canPlan]);

  const dishes = useMemo<Dish[]>(() => (choices ? [
    ...choices.menu.menuItems.map((m) => ({ key: `m:${m.menuItemId}`, name: m.name, category: m.category, menuItemId: m.menuItemId })),
    ...choices.menu.recipes.map((r) => ({ key: `r:${r.recipeId}`, name: r.title, category: null, recipeId: r.recipeId })),
  ] : []), [choices]);

  if (!canPlan) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <Column style={{ padding: space.xl, gap: space.lg }}>
          <Text variant="title">Plan today's prep</Text>
          <Text variant="muted">Ask a manager to plan today's prep.</Text>
          <Button kind="quiet" label="Back" onPress={() => router.back()} />
        </Column>
      </SafeAreaView>
    );
  }

  const set = (key: string, n: number) => setPortions((p) => ({ ...p, [key]: Math.max(0, n) }));
  const chosen = dishes.filter((d) => (portions[d.key] ?? 0) > 0);
  const shown = dishes.filter((d) => d.name.toLowerCase().includes(find.trim().toLowerCase()));

  function useLast() {
    const next: Record<string, number> = {};
    for (const s of choices?.previous ?? []) {
      const key = s.menuItemId ? `m:${s.menuItemId}` : s.recipeId ? `r:${s.recipeId}` : null;
      if (key && dishes.some((d) => d.key === key)) next[key] = s.expectedPortions;
    }
    setPortions(next);
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const selections: PrepSelectionInput[] = chosen.map((d) => ({ ...(d.menuItemId ? { menuItemId: d.menuItemId } : { recipeId: d.recipeId }), dishName: d.name, expectedPortions: portions[d.key], ...(d.category ? { category: d.category } : {}) }));
      const text = covers.trim();
      await store.makeList({ selections, expectedCovers: text === "" ? null : Number(text) });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
          <Column style={{ gap: space.lg }}>
            <Text variant="title">Plan today's prep</Text>
            {choices?.offline ? <OfflineBanner text="You're offline. This is the menu saved on this phone; the list is made when you're back." /> : null}
            {loadError ? <Text variant="error">{loadError}</Text> : null}
            {!choices && !loadError ? <Text variant="muted">Loading your menu…</Text> : null}
            {choices && dishes.length === 0 ? <Text variant="muted">There are no dishes on your menu yet. Add them on the web.</Text> : null}
            {choices && dishes.length > 0 ? (
              <>
                {choices.previous.length > 0 ? <Button kind="ghost" label="Use the last plan's portions" onPress={useLast} /> : null}
                <TextField label="Find a dish" value={find} onChangeText={setFind} placeholder="Soup" />
                <Surface>
                  {shown.map((d, index) => {
                    const n = portions[d.key] ?? 0;
                    return (
                      <View key={d.key} style={[{ paddingVertical: space.sm, paddingHorizontal: space.lg, flexDirection: "row", alignItems: "center", gap: space.md }, rowDivider(index, c.border)]}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: fontFamily.title, fontSize: 20 }}>{d.name}</Text>
                          {d.category ? <Text variant="meta">{d.category}</Text> : null}
                        </View>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Fewer ${d.name}`} onPress={() => set(d.key, n - 1)} style={{ width: size.tap, height: size.tap, alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontSize: 28, color: c.accentText }}>−</Text>
                        </Pressable>
                        <TextInput
                          accessibilityLabel={`Portions of ${d.name}`}
                          keyboardType="number-pad"
                          value={String(n)}
                          onChangeText={(t) => set(d.key, asCount(t))}
                          selectTextOnFocus
                          style={{ width: 56, minHeight: size.tap, textAlign: "center", fontFamily: fontFamily.uiStrong, fontSize: 20, color: c.text, backgroundColor: c.field, borderRadius: 12 }}
                        />
                        <Pressable accessibilityRole="button" accessibilityLabel={`More ${d.name}`} onPress={() => set(d.key, n + 1)} style={{ width: size.tap, height: size.tap, alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontSize: 28, color: c.accentText }}>+</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </Surface>
                <TextField label="Expected covers (optional)" value={covers} onChangeText={setCovers} keyboardType="number-pad" placeholder="80" />
                {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
                <Button label="Make today's prep list" onPress={() => void save()} disabled={saving || chosen.length === 0} />
              </>
            ) : null}
            <Button kind="quiet" label="Cancel" onPress={() => router.back()} />
          </Column>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

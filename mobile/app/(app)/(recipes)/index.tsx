import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RecipeDomain } from "@culinaire/shared/schemas/recipe";
import { useLab, useShelf } from "../../../src/recipes/RecipesProvider";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { TextField } from "../../../src/ui/TextField";
import { Chip, Surface, rowDivider } from "../../../src/ui/Surface";
import { fontFamily, radius, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** The web's My Recipe Book tabs. */
const TABS: { label: string; domain: RecipeDomain | null }[] = [
  { label: "All", domain: null },
  { label: "Culinary", domain: "recipe" },
  { label: "Patisserie", domain: "patisserie" },
  { label: "Spirits", domain: "spirits" },
];

/** My Recipes: what this person has made, newest first, a lab at a time; and the way into the Recipe Lab. */
export default function MyRecipes() {
  const router = useRouter();
  const c = useColors();
  const { store, snap } = useShelf();
  const { store: labStore, snap: lab } = useLab();
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  useFocusEffect(useCallback(() => void store.refresh(), [store]));
  // A recipe that finishes while the person is here shows up in the list.
  useEffect(() => {
    if (lab.phase === "made" || lab.phase === "found") void store.refresh();
  }, [lab.phase, store]);
  function openLab() {
    // A finished recipe has been seen (in the list, or on its page): the lab opens on its form again.
    if (lab.phase === "made") labStore.reset();
    router.push("/recipe-lab");
  }
  const caps = { fontFamily: fontFamily.uiStrong, fontSize: 12, letterSpacing: 1.8, textTransform: "uppercase", color: c.accentText } as const;
  // As on the web, the search looks through the recipes already loaded.
  const q = search.trim().toLowerCase();
  const shown = q ? snap.recipes.filter((r) => `${r.title} ${r.description ?? ""}`.toLowerCase().includes(q)) : snap.recipes;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await store.refresh(); setRefreshing(false); }} />}
      >
        <Column style={{ gap: space.lg }}>
          <Text style={caps}>Recipe book</Text>
          <Text variant="title">My Recipes</Text>
          <Button label={lab.phase === "generating" ? "Recipe Lab: making your recipe…" : "Create a recipe"} onPress={openLab} />

          <View accessibilityRole="tablist" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {TABS.map((t) => {
              const selected = t.domain === snap.domain;
              return (
                <Pressable
                  key={t.label}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => void store.setDomain(t.domain)}
                  style={{ minHeight: 44, borderRadius: 999, borderWidth: 1, borderColor: selected ? c.text : c.border, backgroundColor: selected ? c.text : c.field, paddingHorizontal: space.lg, justifyContent: "center" }}
                >
                  <Text style={{ fontFamily: fontFamily.uiStrong, color: selected ? c.bg : c.text }}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {snap.recipes.length > 0 ? <TextField label="Search" value={search} onChangeText={setSearch} placeholder="Search your recipes" autoCorrect={false} /> : null}

          {snap.error ? <Text variant="error">{snap.error}</Text> : null}
          {snap.phase === "error" ? <Button kind="ghost" label="Try again" onPress={() => void store.refresh()} /> : null}
          {snap.phase === "loading" ? <Text variant="muted">Loading your recipes…</Text> : null}
          {snap.phase === "ready" && snap.recipes.length === 0 ? (
            <Surface>
              <View style={{ padding: space.lg, gap: space.xs }}>
                <Text style={{ fontFamily: fontFamily.title, fontSize: 20 }}>No recipes yet</Text>
                <Text variant="muted">Recipes you make in the Recipe Lab, here or on the web, are kept here.</Text>
              </View>
            </Surface>
          ) : null}
          {snap.phase === "ready" && snap.recipes.length > 0 ? (
            <View style={{ gap: space.xs }}>
              <Text variant="meta">{q ? `${shown.length} found in the ${snap.recipes.length} loaded` : `Showing ${snap.recipes.length} of ${snap.total}`}</Text>
              <Surface>
                {shown.map((r, index) => (
                  <Pressable
                    key={r.recipeId}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.title}, ${r.isPublicInd ? "public" : "private"}`}
                    onPress={() => router.push({ pathname: "/recipe", params: { id: r.recipeId } })}
                    style={({ pressed }) => [{ flexDirection: "row", gap: space.md, padding: space.md, minHeight: size.tap + 16, opacity: pressed ? 0.6 : 1 }, rowDivider(index, c.border)]}
                  >
                    {r.imageUrl ? (
                      <Image source={{ uri: r.imageUrl }} accessibilityIgnoresInvertColors style={{ width: 64, height: 64, borderRadius: radius.banner, backgroundColor: c.surface }} />
                    ) : (
                      <View style={{ width: 64, height: 64, borderRadius: radius.banner, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }} />
                    )}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text numberOfLines={2} style={{ fontFamily: fontFamily.title, fontSize: 18 }}>{r.title}</Text>
                      {r.description ? <Text variant="muted" numberOfLines={2}>{r.description}</Text> : null}
                      <View style={{ flexDirection: "row", marginTop: space.xs }}>
                        <Chip label={r.isPublicInd ? "Public" : "Private"} />
                      </View>
                    </View>
                  </Pressable>
                ))}
              </Surface>
              {!q && snap.recipes.length < snap.total ? <Button kind="ghost" label={snap.more ? "Loading…" : "Load more"} disabled={snap.more} onPress={() => void store.loadMore()} /> : null}
            </View>
          ) : null}
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

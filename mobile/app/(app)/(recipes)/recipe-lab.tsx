import { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLab } from "../../../src/recipes/RecipesProvider";
import type { RecipeRequest } from "../../../src/recipes/recipeApi";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Markdown } from "../../../src/ui/Markdown";
import { Text } from "../../../src/ui/Text";
import { TextField } from "../../../src/ui/TextField";
import { Surface } from "../../../src/ui/Surface";
import { fontFamily, radius, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** The web's culinary lists (`RecipeForm.tsx`). */
const DIETARY = ["Vegetarian", "Vegan", "Gluten-Free", "Dairy-Free", "Nut-Free", "Halal", "Kosher"];
const DIFFICULTY: { value: NonNullable<RecipeRequest["difficulty"]>; label: string }[] = [
  { value: "beginner", label: "Home Cook" },
  { value: "intermediate", label: "Skilled Home Cook / Culinary Student" },
  { value: "advanced", label: "Professional / Line Cook" },
  { value: "expert", label: "Chef de Partie / Master Level" },
];
/** The server's limits (`recipeController.ts`). */
const REQUEST_MIN = 3;
const REQUEST_MAX = 500;
const INGREDIENT_MAX = 50;

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function Pill({ label, selected, onPress, role }: { label: string; selected: boolean; onPress: () => void; role: "radio" | "checkbox" }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      aria-checked={selected}
      hitSlop={4}
      onPress={onPress}
      style={{ minHeight: 48, borderRadius: 999, borderWidth: 1, borderColor: selected ? c.text : c.border, backgroundColor: selected ? c.text : c.field, paddingHorizontal: space.lg, justifyContent: "center" }}
    >
      <Text style={{ fontFamily: fontFamily.uiStrong, color: selected ? c.bg : c.text }}>{label}</Text>
    </Pressable>
  );
}

/** The long wait, told honestly: how long it has been, how long it usually takes, and a way out. */
function Waiting({ startedAt, onStop }: { startedAt: number; onStop: () => void }) {
  const c = useColors();
  const [now, setNow] = useState(Date.now());
  // Every 5 s: a clock that changes every second keeps a screen reader (and uiautomator) busy for nothing.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const elapsed = now - startedAt;
  return (
    <Surface>
      <View style={{ padding: space.lg, gap: space.md }}>
        <Text accessibilityLiveRegion="polite" style={{ fontFamily: fontFamily.title, fontSize: 22 }}>Writing your recipe…</Text>
        <Text variant="meta" accessibilityLabel={`${Math.floor(elapsed / 1000)} seconds so far`}>{clock(elapsed)}</Text>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: c.border, overflow: "hidden" }}>
          <View style={{ width: `${Math.min(95, (elapsed / 90_000) * 100)}%`, height: 6, backgroundColor: c.accentText }} />
        </View>
        <Text variant="muted">
          {elapsed < 90_000
            ? "This usually takes about a minute, and can take up to two and a half. You can leave this screen: it keeps going."
            : "Taking longer than usual. It stops by itself after two and a half minutes, and nothing is saved or charged if it does."}
        </Text>
        <Button kind="danger" label="Stop" onPress={onStop} />
        <Text variant="meta">Stopping saves nothing and uses none of your sessions.</Text>
      </View>
    </Surface>
  );
}

/** Recipe Lab (culinary): describe a dish, get a full recipe saved to My Recipes. */
export default function RecipeLab() {
  const router = useRouter();
  const c = useColors();
  const { store, snap } = useLab();
  const [request, setRequest] = useState("");
  const [servings, setServings] = useState(4);
  const [difficulty, setDifficulty] = useState<RecipeRequest["difficulty"]>(undefined);
  const [dietary, setDietary] = useState<string[]>([]);
  const [cuisine, setCuisine] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [occasion, setOccasion] = useState("");

  // A recipe that was just made opens straight away (the lab keeps it, for the marker on its page, until My Recipes opens the lab again).
  // Only while this screen is in view: made while the person is on another tab, it opens when they come back.
  useFocusEffect(useCallback(() => {
    if (snap.made) router.replace({ pathname: "/recipe", params: { id: snap.made.recipeId } });
  }, [snap.made, router]));

  const text = request.trim();
  const valid = text.length >= REQUEST_MIN;
  function generate() {
    if (!valid) return;
    const list = ingredients.split(",").map((s) => s.trim().slice(0, INGREDIENT_MAX)).filter(Boolean).slice(0, 20);
    void store.generate({
      request: text.slice(0, REQUEST_MAX),
      servings,
      difficulty,
      dietary: dietary.length ? dietary : undefined,
      cuisine: cuisine.trim() || undefined,
      mainIngredients: list.length ? list : undefined,
      occasion: occasion.trim() || undefined,
    });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
          <Column style={{ gap: space.lg }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to My Recipes" hitSlop={8} onPress={() => router.back()} style={{ minHeight: size.tap, justifyContent: "center", alignSelf: "flex-start" }}>
              <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText }}>‹ My Recipes</Text>
            </Pressable>
            <Text variant="label">Recipe Lab</Text>
            <Text variant="title">Create a recipe</Text>

            {snap.phase === "generating" && snap.startedAt ? <Waiting startedAt={snap.startedAt} onStop={store.stop} /> : null}

            {snap.phase === "checking" ? <Text variant="muted" accessibilityLiveRegion="polite">Checking My Recipes…</Text> : null}

            {snap.phase === "pending" ? (
              <Surface>
                <View style={{ padding: space.lg, gap: space.md }} accessibilityLiveRegion="polite">
                  <Text variant="heading">Your recipe may still be on its way</Text>
                  <Text variant="muted">The connection dropped while Antoine was writing, and he may still be at it. The phone looks in My Recipes every few seconds, so do not make it again yet.</Text>
                  <Button label="Check now" onPress={() => void store.checkAgain()} />
                </View>
              </Surface>
            ) : null}

            {snap.phase === "found" && snap.found ? (
              <Surface>
                <View style={{ padding: space.lg, gap: space.md }} accessibilityLiveRegion="polite">
                  <Text variant="heading">A new recipe appeared. Is it this one?</Text>
                  <Text variant="muted">{`The answer did not reach the phone, but "${snap.found.title}" was saved to My Recipes while you waited. Open it before making the recipe again.`}</Text>
                  <Button label="Open it" onPress={() => { const id = snap.found!.recipeId; store.reset(); router.replace({ pathname: "/recipe", params: { id } }); }} />
                  <Button kind="quiet" label="It's another recipe: make mine again" onPress={() => void store.retry()} />
                </View>
              </Surface>
            ) : null}

            {snap.phase === "prose" && snap.prose ? (
              <Surface>
                <View style={{ padding: space.lg, gap: space.md }}>
                  <Text variant="heading">Antoine answered in words</Text>
                  <Markdown text={snap.prose} />
                  <Text variant="meta">Nothing was saved, and no session was used.</Text>
                  <Button kind="ghost" label="Change the request" onPress={store.reset} />
                </View>
              </Surface>
            ) : null}

            {snap.phase === "failed" && snap.failure ? (
              <View style={{ gap: space.sm }} accessibilityLiveRegion="polite">
                <Text variant="error">{snap.failure.message}</Text>
                {snap.unchecked ? <Button label="Check again" onPress={() => void store.checkAgain()} /> : null}
                {snap.failure.canRetry ? <Button kind={snap.unchecked ? "ghost" : undefined} label="Try again" onPress={() => void store.retry()} /> : null}
                <Button kind="quiet" label="Change the request" onPress={store.reset} />
              </View>
            ) : null}

            {snap.phase === "form" ? (
              <>
                {snap.note ? <Text variant="meta">{snap.note}</Text> : null}
                <TextField label="What would you like to create?" value={request} onChangeText={setRequest} placeholder="e.g. French chicken thigh braise with cider and shallot confit" multiline maxLength={REQUEST_MAX} />
                <TextField label="Cuisine style" value={cuisine} onChangeText={setCuisine} placeholder="e.g. French, Japanese" maxLength={100} />
                <TextField label="Key ingredients" value={ingredients} onChangeText={setIngredients} placeholder="e.g. chicken, cider, shallots" autoCapitalize="none" />

                <View style={{ gap: space.xs }}>
                  <Text variant="label">Servings</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                    <Pressable accessibilityRole="button" accessibilityLabel="Fewer servings" disabled={servings <= 1} onPress={() => setServings(servings - 1)} style={{ width: size.tap, height: size.tap, borderRadius: radius.button, borderWidth: 1, borderColor: c.border, backgroundColor: c.field, alignItems: "center", justifyContent: "center", opacity: servings <= 1 ? 0.5 : 1 }}>
                      <Text style={{ fontFamily: fontFamily.uiStrong, fontSize: 22 }}>−</Text>
                    </Pressable>
                    <Text accessibilityLabel={`${servings} servings`} style={{ fontFamily: fontFamily.title, fontSize: 26, minWidth: 48, textAlign: "center" }}>{servings}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="More servings" disabled={servings >= 100} onPress={() => setServings(servings + 1)} style={{ width: size.tap, height: size.tap, borderRadius: radius.button, borderWidth: 1, borderColor: c.border, backgroundColor: c.field, alignItems: "center", justifyContent: "center", opacity: servings >= 100 ? 0.5 : 1 }}>
                      <Text style={{ fontFamily: fontFamily.uiStrong, fontSize: 22 }}>+</Text>
                    </Pressable>
                  </View>
                </View>

                <View style={{ gap: space.xs }}>
                  <Text variant="label">Difficulty</Text>
                  <View accessibilityRole="radiogroup" accessibilityLabel="Difficulty" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                    <Pill role="radio" label="Any" selected={!difficulty} onPress={() => setDifficulty(undefined)} />
                    {DIFFICULTY.map((d) => <Pill key={d.value} role="radio" label={d.label} selected={difficulty === d.value} onPress={() => setDifficulty(d.value)} />)}
                  </View>
                </View>

                <TextField label="Occasion (optional)" value={occasion} onChangeText={setOccasion} placeholder="e.g. dinner party, weeknight, holiday" maxLength={100} />

                <View style={{ gap: space.xs }}>
                  <Text variant="label">Dietary restrictions</Text>
                  <View accessibilityLabel="Dietary restrictions" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                    {DIETARY.map((d) => {
                      const on = dietary.includes(d);
                      return <Pill key={d} role="checkbox" label={d} selected={on} onPress={() => setDietary(on ? dietary.filter((x) => x !== d) : [...dietary, d])} />;
                    })}
                  </View>
                </View>

                <Button label="Generate recipe" disabled={!valid} onPress={generate} />
                <Text variant="meta">The recipe is saved to My Recipes, private until you make it public. It uses one of your sessions only when a recipe is made.</Text>
              </>
            ) : null}
          </Column>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

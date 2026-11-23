import { useState } from "react";
import { Image, KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { parseRecipeData, type RecipeData } from "@culinaire/shared/schemas/recipe";
import { useSession } from "../../../src/runtime/appContext";
import { useRecipe } from "../../../src/recipes/RecipesProvider";
import { INSTRUCTION_MAX, INSTRUCTION_MIN } from "../../../src/recipes/recipeStore";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Segmented } from "../../../src/ui/Segmented";
import { Text } from "../../../src/ui/Text";
import { TextField } from "../../../src/ui/TextField";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { fontFamily, radius, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** The web's quick refinements (`RecipeRefinePanel.tsx`). */
const QUICK = ["Make dairy-free", "Scale to 50 portions", "Reduce food cost", "Simplify technique", "Make gluten-free", "Add vegetarian option"];
const DIFFICULTY: Record<string, string> = { beginner: "Home cook", intermediate: "Skilled home cook", advanced: "Professional", expert: "Master level" };

function useCaps() {
  const c = useColors();
  return { fontFamily: fontFamily.uiStrong, fontSize: 12, letterSpacing: 1.8, textTransform: "uppercase", color: c.accentText } as const;
}

/** The recipe itself: facts, ingredients, method, tips. Used for the saved recipe and for a refinement's proposal. */
function RecipeBody({ data }: { data: RecipeData }) {
  const c = useColors();
  const caps = useCaps();
  const facts = [
    ["Yield", data.yield],
    ["Prep", data.prepTime],
    ["Cook", data.cookTime],
    ["Level", DIFFICULTY[data.difficulty] ?? data.difficulty],
  ].filter(([, v]) => v);
  return (
    <View style={{ gap: space.lg }}>
      {facts.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lg }}>
          {facts.map(([k, v]) => (
            <View key={k} style={{ gap: 2, minWidth: 96 }}>
              <Text style={caps}>{k}</Text>
              <Text style={{ fontFamily: fontFamily.uiStrong }}>{v}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {data.glassware || data.garnish ? <Text variant="meta">{[data.glassware && `Glass: ${data.glassware}`, data.garnish && `Garnish: ${data.garnish}`].filter(Boolean).join(" · ")}</Text> : null}

      {data.ingredients.length ? (
        <View style={{ gap: space.xs }}>
          <Text style={caps}>Ingredients</Text>
          <Surface>
            {data.ingredients.map((ing, i) => (
              <View key={i} style={[{ flexDirection: "row", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg }, rowDivider(i, c.border)]}>
                <Text style={{ fontFamily: fontFamily.uiStrong, minWidth: 88 }}>{[ing.amount, ing.unit].filter(Boolean).join(" ")}</Text>
                <Text style={{ flex: 1 }}>{ing.name}{ing.note ? <Text variant="muted">{`, ${ing.note}`}</Text> : null}</Text>
              </View>
            ))}
          </Surface>
        </View>
      ) : null}

      {data.steps.length ? (
        <View style={{ gap: space.md }}>
          <Text style={caps}>Method</Text>
          {data.steps.map((s, i) => (
            <View key={i} style={{ flexDirection: "row", gap: space.md }}>
              <Text style={{ fontFamily: fontFamily.title, fontSize: 22, color: c.accentText, minWidth: 28 }}>{s.step || i + 1}</Text>
              <Text style={{ flex: 1 }}>{s.instruction}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {data.proTips.length ? (
        <View style={{ gap: space.xs }}>
          <Text style={caps}>Pro tips</Text>
          {data.proTips.map((t, i) => <Text key={i}>{`• ${t}`}</Text>)}
        </View>
      ) : null}
      {data.whyThisWorks ? (
        <View style={{ gap: space.xs }}>
          <Text style={caps}>Why this works</Text>
          <Text>{data.whyThisWorks}</Text>
        </View>
      ) : null}
      {data.allergenNote ? (
        <View style={{ gap: space.xs }}>
          <Text style={caps}>Allergens</Text>
          <Text>{data.allergenNote}</Text>
        </View>
      ) : null}
      {data.confidenceNote ? <Text variant="meta">{data.confidenceNote}</Text> : null}
    </View>
  );
}

/** A recipe from My Recipes. Its owner can refine it and make it public or private; anyone else only reads it. */
export default function RecipeView() {
  const router = useRouter();
  const c = useColors();
  const caps = useCaps();
  const { state } = useSession();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { store, snap } = useRecipe(id ?? "", state.phase === "ready" ? state.user.userId : -1);
  const [instruction, setInstruction] = useState("");
  const recipe = snap.recipe;
  const data = recipe ? parseRecipeData(recipe.recipeData) : null;
  const refine = snap.refine;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
          <Column style={{ gap: space.lg }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to My Recipes" hitSlop={8} onPress={() => router.back()} style={{ minHeight: size.tap, justifyContent: "center", alignSelf: "flex-start" }}>
              <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText }}>‹ My Recipes</Text>
            </Pressable>
            {snap.phase === "loading" ? <Text variant="muted">Loading the recipe…</Text> : null}
            {snap.phase === "error" ? (
              <>
                <Text variant="error">{snap.error}</Text>
                <Button kind="ghost" label="Try again" onPress={() => void store.load()} />
              </>
            ) : null}

            {recipe && data ? (
              <>
                {recipe.imageUrl ? <Image source={{ uri: recipe.imageUrl }} accessibilityLabel={`Photo of ${recipe.title}`} style={{ width: "100%", aspectRatio: 1, borderRadius: radius.key, backgroundColor: c.surface }} /> : null}
                <Text style={caps}>{recipe.domain === "patisserie" ? "Patisserie" : recipe.domain === "spirits" ? "Spirits" : "Culinary"}</Text>
                <Text variant="title">{recipe.title}</Text>
                {recipe.description || data.description ? <Text variant="muted">{recipe.description || data.description}</Text> : null}

                {snap.isOwner ? (
                  <View style={{ gap: space.xs }}>
                    <Text style={caps}>Who can see it</Text>
                    <View style={{ alignSelf: "flex-start" }}>
                      <Segmented options={[{ value: "private", label: "Only me" }, { value: "public", label: "Public" }]} value={recipe.isPublicInd ? "public" : "private"} onChange={(v) => void store.setPublic(v === "public")} />
                    </View>
                    <Text variant="meta">{recipe.isPublicInd ? "Anyone can open it, and it is listed in the community gallery." : "Only you can open it."}</Text>
                    {snap.visibilityError ? <Text variant="error">{snap.visibilityError}</Text> : null}
                  </View>
                ) : null}

                <RecipeBody data={data} />

                {snap.isOwner ? (
                  <View style={{ gap: space.md, borderTopWidth: 1, borderTopColor: c.border, paddingTop: space.lg }}>
                    <Text style={caps}>Refine with Antoine</Text>
                    {refine.phase === "idle" ? (
                      <>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                          {QUICK.map((q) => (
                            <Pressable key={q} accessibilityRole="button" onPress={() => setInstruction(q)} style={{ minHeight: 44, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.field, paddingHorizontal: space.lg, justifyContent: "center" }}>
                              <Text style={{ fontFamily: fontFamily.uiStrong }}>{q}</Text>
                            </Pressable>
                          ))}
                        </View>
                        <TextField label="What should change?" value={instruction} onChangeText={setInstruction} placeholder="e.g. swap the cream for something lighter" multiline maxLength={INSTRUCTION_MAX} />
                        {refine.failure ? <Text variant="error">{refine.failure.message}</Text> : null}
                        <Button label="Refine" disabled={instruction.trim().length < INSTRUCTION_MIN} onPress={() => void store.refine(instruction)} />
                        <Text variant="meta">You see the changes before anything is saved.</Text>
                      </>
                    ) : null}
                    {refine.phase === "refining" ? (
                      <View style={{ gap: space.md }} accessibilityLiveRegion="polite">
                        <Text style={{ fontFamily: fontFamily.title, fontSize: 20 }}>Antoine is refining your recipe…</Text>
                        <Text variant="muted">Usually under a minute. Nothing changes until you accept.</Text>
                        <Button kind="danger" label="Stop" onPress={store.stopRefine} />
                      </View>
                    ) : null}
                    {refine.phase === "proposal" || refine.phase === "accepting" ? (
                      <View style={{ gap: space.lg }}>
                        <Surface>
                          <View style={{ padding: space.lg, gap: space.xs }}>
                            <Text style={caps}>What changed</Text>
                            <Text>{refine.changeSummary || "Antoine did not describe the change."}</Text>
                          </View>
                        </Surface>
                        <Text style={{ fontFamily: fontFamily.title, fontSize: 22 }}>{parseRecipeData(refine.refinedData).name || recipe.title}</Text>
                        <RecipeBody data={parseRecipeData(refine.refinedData)} />
                        {refine.phase === "proposal" && refine.failure ? <Text variant="error">{refine.failure.message}</Text> : null}
                        <Button label={refine.phase === "accepting" ? "Saving…" : "Accept changes"} disabled={refine.phase === "accepting"} onPress={() => void store.accept()} />
                        <Button kind="quiet" label="Discard" disabled={refine.phase === "accepting"} onPress={store.discard} />
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : null}
          </Column>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

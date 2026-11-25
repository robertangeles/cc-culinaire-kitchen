import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { FOOD_COST_ALERT_PCT, type CustomConversion } from "@culinaire/shared";
import { DEFAULT_MENU_CATEGORIES, type ImportRecipe, type MenuCatalogueItem } from "@culinaire/shared/schemas/menu";
import { ApiError } from "../../../src/api/client";
import { createIngredientSource, type PickedIngredient } from "../../../src/ingredients/source";
import { useSession } from "../../../src/runtime/appContext";
import { hasAnyPermission } from "../../../src/shell/tabs";
import { LineEditor } from "../../../src/menu/LineEditor";
import { useMenu } from "../../../src/menu/MenuProvider";
import { blankLine, checkDraft, draftCosts, draftFromRecipe, draftOf, emptyDraft, mayHaveLanded, pickInto, saveMenuItem, saveSession, type DraftLine, type MenuDraft } from "../../../src/menu/menuEditor";
import { isOffline } from "../../../src/menu/menuStore";
import { categoriesOf, money, pct } from "../../../src/menu/menuView";
import { OfflineBanner } from "../../../src/ui/Banner";
import { Button } from "../../../src/ui/Button";
import { ChoiceChips } from "../../../src/ui/ChoiceChips";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { TextField } from "../../../src/ui/TextField";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { fontFamily, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

type FieldKey = Exclude<keyof MenuDraft, "lines">;

/**
 * Add a menu item (from scratch, or from a saved recipe) or change one (`?menuItemId=`): name, category, price, servings and its recipe
 * lines, with a live cost for `inventory:cost` holders. Saving needs a connection; pressing Save again after a failure carries on from what
 * is already saved. Only for `menu:manage` holders who may change this item.
 */
export default function MenuEdit() {
  const { state } = useSession();
  const { store, api, recents, snap } = useMenu();
  const router = useRouter();
  const c = useColors();
  const params = useLocalSearchParams<{ menuItemId?: string }>();
  const id = (Array.isArray(params.menuItemId) ? params.menuItemId[0] : params.menuItemId) || null;
  const [draft, setDraft] = useState<MenuDraft | null>(id ? null : emptyDraft());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<MenuCatalogueItem[]>([]);
  const [conversions, setConversions] = useState<Record<string, CustomConversion[]>>({});
  const [recipes, setRecipes] = useState<ImportRecipe[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const session = useRef(saveSession());
  const asked = useRef(new Set<string>());

  const load = useCallback(async () => {
    if (!id) return;
    setLoadError(null);
    try {
      // Fresh, not the copy on the phone: saving compares with it.
      const [items, lines] = await Promise.all([api.items(), api.lines(id)]);
      const item = items.find((i) => i.menuItemId === id);
      if (!item) return setLoadError("This item is no longer on the menu.");
      if (item.canManage === false) return setRefused(true);
      session.current = saveSession(item, lines);
      setDraft(draftOf(item, lines));
    } catch (err) {
      setLoadError(isOffline(err) ? "Changing the menu needs a connection, and the server can't be reached." : err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  }, [api, id]);
  useEffect(() => void load(), [load]);

  // The catalogue the picker offers. Refused or unreachable: lines are typed names, as on the web.
  useEffect(() => {
    let live = true;
    api.catalogue().then((list) => live && setCatalogue(list), () => {});
    return () => void (live = false);
  }, [api]);

  // Each linked item's own units, read once; without them the line keeps its standard units.
  const linked = draft?.lines.flatMap((l) => (l.ingredientId ? [l.ingredientId] : [])).join() ?? "";
  useEffect(() => {
    for (const ingredientId of linked.split(",")) {
      if (!ingredientId || asked.current.has(ingredientId)) continue;
      asked.current.add(ingredientId);
      api.conversions(ingredientId).then((own) => setConversions((all) => ({ ...all, [ingredientId]: own })), () => void asked.current.delete(ingredientId));
    }
  }, [api, linked]);

  const source = useMemo(() => createIngredientSource({ catalogue: { items: async () => catalogue }, recents }), [catalogue, recents]);
  if (state.phase !== "ready") return null;

  const page = (children: React.ReactNode) => (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
          <Column style={{ gap: space.lg }}>{children}</Column>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
  const title = <Text variant="title">{id ? "Change the item" : "Add a menu item"}</Text>;
  const back = <Button kind="quiet" label="Cancel" disabled={saving} onPress={() => router.back()} />;

  if (!hasAnyPermission(state.user, ["menu:manage"]) || refused) {
    return page(
      <>
        {title}
        <Text variant="muted">{refused ? "Only the person who made this item or an admin of your organisation can change it." : "Changing the menu needs the permission to manage it. Ask a manager."}</Text>
        <Button kind="quiet" label="Back" onPress={() => router.back()} />
      </>,
    );
  }
  if (!draft) {
    return page(
      <>
        {title}
        {loadError ? <Text variant="error">{loadError}</Text> : <Text variant="muted">Loading…</Text>}
        {loadError ? <Button label="Try again" onPress={() => void load()} /> : null}
        {back}
      </>,
    );
  }

  const canSeeCost = hasAnyPermission(state.user, ["inventory:cost"]);
  const userId = state.user.userId;
  const conversionsFor = (ingredientId: string | null) => (ingredientId ? (conversions[ingredientId] ?? []) : []);
  const categories = [...new Set([...DEFAULT_MENU_CATEGORIES, ...categoriesOf(snap.items)])].sort();
  const costs = draftCosts(draft, conversionsFor);
  const set = (key: FieldKey) => (value: string) => setDraft((d) => d && { ...d, [key]: value });
  const changeLine = (next: DraftLine) => setDraft((d) => d && { ...d, lines: d.lines.map((l) => (l.key === next.key ? next : l)) });

  function pick(line: DraftLine, p: PickedIngredient) {
    void recents.remember(p);
    const item = catalogue.find((i) => i.ingredientId === p.ingredientId);
    changeLine(item ? pickInto(line, item) : { ...line, ingredientName: p.name });
  }

  async function openImport() {
    setImporting(true);
    setError(null);
    if (recipes) return;
    try {
      setRecipes(await api.recipes());
    } catch (err) {
      setImporting(false);
      setError(isOffline(err) ? "Recipes show when you're back online." : err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  }

  async function save() {
    const checked = checkDraft(draft!);
    if ("error" in checked) return setError(checked.error);
    setSaving(true);
    setError(null);
    try {
      const savedId = await saveMenuItem(api, session.current, checked, userId);
      await Promise.all([store.refresh(), store.loadLines(savedId)]);
      if (id) router.back();
      else router.replace({ pathname: "/menu-item/[menuItemId]", params: { menuItemId: savedId } });
    } catch (err) {
      const said = err instanceof Error ? err.message : "Something went wrong.";
      const partly = !id && session.current.itemId ? "The item is saved, but not all of its ingredients. " : "";
      setError(err instanceof ApiError && mayHaveLanded(err) ? `${partly}${isOffline(err) ? "The server can't be reached, so this may not be saved." : "The server had a problem, so this may not be saved."} Press Save again: nothing is added twice.` : `${partly}${said}`);
      setSaving(false);
    }
  }

  if (importing) {
    const q = search.trim().toLowerCase();
    const found = (recipes ?? []).filter((r) => !q || r.title.toLowerCase().includes(q) || r.domain.toLowerCase().includes(q));
    return page(
      <>
        <Text variant="title">Start from a recipe</Text>
        <Text variant="muted">Your recipes and your organisation's. Its name, servings and ingredients are filled in; you link the ingredients and set the price.</Text>
        <TextField label="Search the recipes" value={search} onChangeText={setSearch} placeholder="Recipe name" autoCorrect={false} returnKeyType="search" />
        {!recipes ? <Text variant="muted">Loading the recipes…</Text> : null}
        {recipes && found.length === 0 ? <Text variant="muted">{recipes.length === 0 ? "There are no saved recipes yet." : `No recipe matches "${search.trim()}".`}</Text> : null}
        {found.length > 0 ? (
          <Surface>
            {found.map((r, index) => (
              <Pressable key={r.recipeId} accessibilityRole="button" accessibilityLabel={`Start from ${r.title}`} onPress={() => { setDraft(draftFromRecipe(r)); setImporting(false); }} style={[{ minHeight: size.tap, paddingHorizontal: space.lg, paddingVertical: space.md, justifyContent: "center", gap: 2 }, rowDivider(index, c.border)]}>
                <Text variant="heading">{r.title}</Text>
                <Text variant="meta">{`${r.ingredients.length} ${r.ingredients.length === 1 ? "ingredient" : "ingredients"}`}</Text>
              </Pressable>
            ))}
          </Surface>
        ) : null}
        <Button kind="quiet" label="Back to the item" onPress={() => setImporting(false)} />
      </>,
    );
  }

  const figure = (label: string, value: string, hint?: string, tone?: string) => (
    <View accessible accessibilityLabel={`${label}, ${value}${hint ? `, ${hint}` : ""}`} style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
        <Text variant="meta" style={{ flexShrink: 1 }}>{label}</Text>
        <Text style={{ fontFamily: fontFamily.uiStrong, color: tone ?? c.text }}>{value}</Text>
      </View>
      {hint ? <Text variant="muted">{hint}</Text> : null}
    </View>
  );
  const q = Number(draft.qFactorPct.replace(",", ".")) || 0;
  const servings = Number(draft.servings) || 1;
  const perServing = [servings > 1 ? `divided by ${servings} servings` : "", q > 0 ? `plus ${q}% Q factor` : ""].filter(Boolean).join(", ");

  return page(
    <>
      {title}
      {snap.offline ? <OfflineBanner text="You're offline. Saving a menu item needs a connection." /> : null}
      {!id && !session.current.itemId ? <Button kind="ghost" label="Start from a recipe" onPress={() => void openImport()} /> : null}
      <TextField label="Item name" value={draft.name} onChangeText={set("name")} placeholder="Pan-seared salmon" maxLength={200} />
      <ChoiceChips label="Category" options={categories} value={categories.includes(draft.category) ? draft.category : null} onChange={(v) => set("category")(v ?? "")} />
      <TextField label="Or a new category" value={categories.includes(draft.category) ? "" : draft.category} onChangeText={set("category")} maxLength={50} />
      <TextField label="Selling price, in $" value={draft.sellingPrice} onChangeText={set("sellingPrice")} keyboardType="decimal-pad" placeholder="0.00" returnKeyType="done" />
      <TextField label="Servings the price covers" value={draft.servingsPerSale} onChangeText={set("servingsPerSale")} keyboardType="number-pad" returnKeyType="done" />
      <TextField label="Servings the recipe makes" value={draft.servings} onChangeText={set("servings")} keyboardType="number-pad" returnKeyType="done" />
      <TextField label="Q factor (small extras), in %" value={draft.qFactorPct} onChangeText={set("qFactorPct")} keyboardType="decimal-pad" placeholder="0" returnKeyType="done" />
      {id ? <TextField label="Units sold" value={draft.unitsSold} onChangeText={set("unitsSold")} keyboardType="number-pad" returnKeyType="done" /> : null}

      <View style={{ gap: space.xs }}>
        <Text variant="label">Ingredients</Text>
        {draft.lines.length === 0 ? (
          <Surface>
            <View style={{ padding: space.lg, gap: space.xs }}>
              <Text variant="heading">No ingredients yet</Text>
              <Text variant="muted">Add what goes into one batch of this recipe.</Text>
            </View>
          </Surface>
        ) : (
          <Surface>
            {draft.lines.map((line, index) => (
              <View key={line.key} style={rowDivider(index, c.border)}>
                <LineEditor
                  line={line}
                  conversions={conversionsFor(line.ingredientId)}
                  open={openLine === line.key}
                  onToggle={() => setOpenLine(openLine === line.key ? null : line.key)}
                  onChange={changeLine}
                  onPick={(p) => pick(line, p)}
                  onRemove={() => setDraft((d) => d && { ...d, lines: d.lines.filter((l) => l.key !== line.key) })}
                  source={source}
                  canSeeCost={canSeeCost}
                />
              </View>
            ))}
          </Surface>
        )}
      </View>
      <Button
        kind="ghost"
        label="Add an ingredient"
        onPress={() => {
          const line = blankLine();
          setDraft((d) => d && { ...d, lines: [...d.lines, line] });
          setOpenLine(line.key);
        }}
      />

      {canSeeCost ? (
        <View style={{ gap: space.xs }}>
          <Text variant="label">Cost summary</Text>
          <Surface>
            <View style={{ padding: space.lg, gap: space.md }}>
              {figure("Batch cost", money(costs.batch), `the sum of ${draft.lines.length} ${draft.lines.length === 1 ? "line" : "lines"}`)}
              {figure("Food cost per serving", money(costs.foodCostWithQ), perServing || undefined)}
              {figure("Food cost", pct(costs.foodCostPct), costs.salePack > 1 ? `${money(costs.foodCostPerSale)} per sale of ${costs.salePack}` : undefined, costs.foodCostPct > FOOD_COST_ALERT_PCT ? c.danger : undefined)}
              {figure("Contribution margin", money(costs.contributionMargin), costs.salePack > 1 ? `per sale of ${costs.salePack} servings` : undefined, costs.contributionMargin < 0 ? c.danger : c.success)}
              <Text variant="muted">A preview. The item's page shows what the server stored.</Text>
            </View>
          </Surface>
        </View>
      ) : null}

      {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
      <Button label={saving ? "Saving…" : "Save the item"} disabled={saving} onPress={() => void save()} />
      {back}
    </>,
  );
}

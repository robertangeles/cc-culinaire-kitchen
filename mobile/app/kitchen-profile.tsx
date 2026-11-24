import { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { ESTABLISHMENT_TYPES, KITCHEN_CONSTRAINTS_OPTIONS, MENU_NEEDS, PLATING_STYLES, PRICE_POINTS, SOURCING_VALUES } from "@culinaire/shared";
import type { PersonalisationOptions } from "@culinaire/shared/schemas/account";
import { accountApi, authApi } from "../src/runtime/appContext";
import { ApiError } from "../src/api/client";
import { servings, toChanges, toForm, type KitchenForm } from "../src/profile/kitchenProfile";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { TextField } from "../src/ui/TextField";
import { Button } from "../src/ui/Button";
import { OptionChips, type Option } from "../src/ui/OptionChips";
import { space } from "../src/theme";

interface Loaded {
  form: KitchenForm;
  options: PersonalisationOptions;
  isOrgAdmin: boolean;
}

/**
 * The skill levels the server accepts (`KitchenProfileUpdateSchema`), for a server whose admin-managed list is empty: the web then shows no choice at all,
 * and nobody could set one.
 */
const SKILL_LEVELS: Option[] = [
  { value: "home_cook", label: "Home cook" },
  { value: "culinary_student", label: "Culinary student" },
  { value: "line_cook", label: "Line cook" },
  { value: "sous_chef", label: "Sous chef" },
  { value: "head_chef", label: "Head chef" },
  { value: "restaurant_owner", label: "Restaurant owner" },
];

/** Cuisine, dietary and equipment are stored by their label, as the web stores them. */
const byLabel = (rows: PersonalisationOptions["cuisine"]): Option[] => rows.map((r) => ({ value: r.optionLabel, label: r.optionLabel }));

/**
 * Kitchen profile (the web's Profile > Profile > Kitchen Profile): what shapes every AI answer and recipe. Everyone sets their skill level;
 * an organisation admin also sets the kitchen, restaurant and menu answers, as on the web.
 */
export default function KitchenProfile() {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | "failed" | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: true }>();
  const [saving, setSaving] = useState(false);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    void Promise.all([accountApi.kitchenProfile(), accountApi.personalisationOptions(), authApi.locationContext()]).then(
      ([profile, options, ctx]) => setLoaded({ form: toForm(profile), options, isOrgAdmin: ctx.isOrgAdmin }),
      () => setLoaded("failed"),
    );
  }, [attempt]);

  if (loaded === null || loaded === "failed") {
    return (
      <Screen>
        <Text variant="title">Kitchen profile</Text>
        {loaded === null ? <Text variant="muted">Loading…</Text> : <Text variant="error">Couldn't load your kitchen profile. Check your signal and try again.</Text>}
        {loaded === "failed" ? <Button kind="ghost" label="Try again" onPress={() => (setLoaded(null), setAttempt((a) => a + 1))} /> : null}
        <Button kind="quiet" label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  const { form, options, isOrgAdmin } = loaded;
  const edit = (changes: Partial<KitchenForm>) => {
    setLoaded({ ...loaded, form: { ...form, ...changes } });
    setMessage(undefined);
  };
  const one = (key: keyof KitchenForm) => (next: string[]) => edit({ [key]: next[0] ?? "" });
  const many = (key: keyof KitchenForm) => (next: string[]) => edit({ [key]: next });
  const badServings = isOrgAdmin && servings(form.servingsDefault) === null;

  async function save() {
    setSaving(true);
    try {
      await accountApi.saveKitchenProfile(toChanges(form, isOrgAdmin));
      setMessage({ text: "Kitchen profile saved." });
    } catch (err) {
      const refused = err instanceof ApiError && err.hasCode("VALIDATION");
      setMessage({ text: refused ? "Some answers weren't accepted. Check them and save again." : "Couldn't save your kitchen profile. Check your signal and try again.", error: true });
    } finally {
      setSaving(false);
    }
  }

  const skill = options.skill_level.length > 0 ? options.skill_level.map((o) => ({ value: o.optionValue, label: o.optionLabel })) : SKILL_LEVELS;
  const describe = options.skill_level.find((o) => o.optionValue === form.skillLevel)?.optionDescription;

  return (
    <Screen>
      <Text variant="title">Kitchen profile</Text>
      <Text variant="muted">These answers shape every AI conversation and recipe.</Text>

      <Heading>Your skill and style</Heading>
      <OptionChips label="Skill level" options={skill} selected={[form.skillLevel]} onChange={(next) => next[0] && edit({ skillLevel: next[0] })} />
      {describe ? <Text variant="meta">{describe}</Text> : null}

      {isOrgAdmin ? (
        <>
          <OptionChips label="Cuisine preferences" multiple options={byLabel(options.cuisine)} selected={form.cuisinePreferences} onChange={many("cuisinePreferences")} />
          <OptionChips label="Dietary restrictions" multiple options={byLabel(options.dietary)} selected={form.dietaryRestrictions} onChange={many("dietaryRestrictions")} />

          <Heading>Your kitchen</Heading>
          <OptionChips label="Kitchen equipment" multiple options={byLabel(options.equipment)} selected={form.kitchenEquipment} onChange={many("kitchenEquipment")} />
          <TextField label="Default servings" value={form.servingsDefault} keyboardType="number-pad" maxLength={3} onChangeText={(v) => edit({ servingsDefault: v })} />
          {badServings ? <Text variant="error">Default servings is a whole number from 1 to 100.</Text> : null}
          <OptionChips label="Kitchen constraints" multiple options={KITCHEN_CONSTRAINTS_OPTIONS} selected={form.kitchenConstraints} onChange={many("kitchenConstraints")} />

          <Heading>Your restaurant</Heading>
          <TextField label="Restaurant or business name" value={form.restaurantName} maxLength={200} onChangeText={(v) => edit({ restaurantName: v })} />
          <OptionChips label="Type of establishment" options={ESTABLISHMENT_TYPES} selected={[form.establishmentType]} onChange={one("establishmentType")} />
          {form.establishmentType === "other" ? <TextField label="Your type of establishment" value={form.establishmentTypeOther} maxLength={50} onChangeText={(v) => edit({ establishmentTypeOther: v })} /> : null}
          <TextField label="Cuisine identity of your menu" value={form.cuisineIdentity} maxLength={200} multiline onChangeText={(v) => edit({ cuisineIdentity: v })} />
          <TextField label="Your target diner" value={form.targetDiner} maxLength={200} multiline onChangeText={(v) => edit({ targetDiner: v })} />
          <OptionChips label="Price of a main course" options={PRICE_POINTS} selected={[form.pricePoint]} onChange={one("pricePoint")} />
          <TextField label="Your restaurant's voice" value={form.restaurantVoice} maxLength={200} multiline onChangeText={(v) => edit({ restaurantVoice: v })} />

          <Heading>Menu and sourcing</Heading>
          <OptionChips label="Sourcing values" multiple options={SOURCING_VALUES.filter((o) => o.value !== "other")} selected={form.sourcingValues} onChange={many("sourcingValues")} />
          <TextField label="Other sourcing values" value={form.sourcingOther} maxLength={100} onChangeText={(v) => edit({ sourcingOther: v })} />
          <OptionChips label="Plating style" options={PLATING_STYLES} selected={[form.platingStyle]} onChange={one("platingStyle")} />
          <OptionChips label="What your menu needs now" multiple max={3} options={MENU_NEEDS} selected={form.menuNeeds} onChange={many("menuNeeds")} />
        </>
      ) : (
        <Text variant="muted">Your organisation's admin sets the kitchen, restaurant and menu answers.</Text>
      )}

      {message ? (
        <Text variant={message.error ? "error" : "meta"} accessibilityLiveRegion="polite">
          {message.text}
        </Text>
      ) : null}
      <Button label={saving ? "Saving…" : "Save"} disabled={saving || badServings} onPress={() => void save()} />
      <Button kind="quiet" label="Back" onPress={() => router.back()} />
    </Screen>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <View style={{ paddingTop: space.md }}>
      <Text variant="heading">{children}</Text>
    </View>
  );
}

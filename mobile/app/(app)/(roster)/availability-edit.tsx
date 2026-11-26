import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { formatAuDate } from "@culinaire/shared";
import { writeMessage } from "../../../src/api/onlineWrite";
import { useSession } from "../../../src/runtime/appContext";
import { WEEKDAYS, dayName, readForm, type AvailabilityForm } from "../../../src/roster/availabilityView";
import { useAvailability } from "../../../src/roster/RosterProvider";
import { venueToday } from "../../../src/roster/shiftView";
import { Button } from "../../../src/ui/Button";
import { ChoiceChips } from "../../../src/ui/ChoiceChips";
import { Screen } from "../../../src/ui/Screen";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { Text } from "../../../src/ui/Text";
import { TextField } from "../../../src/ui/TextField";
import { maskDate, maskTime, parseTypedDate, typedDate } from "../../../src/ui/typedDate";
import { space } from "../../../src/theme";

/** Add a weekly window, or change one (`?id=`). Saving needs a connection; what was typed stays on the form until it is saved. */
export default function AvailabilityEdit() {
  const { state } = useSession();
  const { store, snap } = useAvailability();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const row = id ? store.find(id) : undefined;
  const [form, setForm] = useState<AvailabilityForm>(() => ({
    day: row ? dayName(row.dayOfWeek) : "Monday",
    from: row?.availableFrom ?? "09:00",
    until: row?.availableUntil ?? "17:00",
    // The venue's today, not the phone's or UTC's.
    startsOn: typedDate(row?.effectiveFrom ?? venueToday(state.phase === "ready" ? state.location.ianaTimezone : undefined, Date.now())),
    endsOn: typedDate(row?.effectiveUntil),
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const change = (next: Partial<AvailabilityForm>) => {
    setForm((f) => ({ ...f, ...next }));
    setError(null);
  };

  async function save() {
    const read = readForm(form, row?.storeLocationId ?? null, snap.rows.filter((r) => r !== row));
    if ("error" in read) return setError(read.error);
    setSaving(true);
    try {
      await (row ? store.change(row.staffAvailabilityId, read.window) : store.add(read.window));
      router.back();
    } catch (err) {
      setError(writeMessage(err, "Saving"));
      setSaving(false);
    }
  }

  // A date in words under its field: 08/07 read the wrong way round is four weeks out.
  const words = (typed: string) => {
    const iso = parseTypedDate(typed);
    return iso ? <Text variant="meta">{formatAuDate(iso)}</Text> : null;
  };

  return (
    <Screen align="top">
      <ScreenHeader label="Roster" title={row ? "Change availability" : "Add availability"} />
      <ChoiceChips label="Day" options={WEEKDAYS} value={form.day} onChange={(day) => day && change({ day })} />
      <View style={{ flexDirection: "row", gap: space.md }}>
        <View style={{ flex: 1 }}>
          <TextField label="From" value={form.from} onChangeText={(t) => change({ from: maskTime(t) })} keyboardType="number-pad" placeholder="09:00" maxLength={5} />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label="Until" value={form.until} onChangeText={(t) => change({ until: maskTime(t) })} keyboardType="number-pad" placeholder="17:00" maxLength={5} />
        </View>
      </View>
      <View style={{ gap: space.xs }}>
        <TextField label="First day" value={form.startsOn} onChangeText={(t) => change({ startsOn: maskDate(t) })} keyboardType="number-pad" placeholder="DD/MM/YYYY" maxLength={10} />
        {words(form.startsOn)}
      </View>
      <View style={{ gap: space.xs }}>
        <TextField label="Last day (optional)" value={form.endsOn} onChangeText={(t) => change({ endsOn: maskDate(t) })} keyboardType="number-pad" placeholder="DD/MM/YYYY" maxLength={10} />
        {words(form.endsOn)}
      </View>
      {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
      <Button label={saving ? "Saving…" : "Save"} disabled={saving} onPress={() => void save()} />
      <Button kind="quiet" label="Cancel" onPress={() => router.back()} />
    </Screen>
  );
}

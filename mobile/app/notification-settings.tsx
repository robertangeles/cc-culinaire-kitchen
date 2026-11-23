import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { useRouter } from "expo-router";
import { QuietHoursSchema, type PushPreferences } from "@culinaire/shared/schemas/push";
import { notificationsApi, push, usePushStatus } from "../src/runtime/appContext";
import { ApiError } from "../src/api/client";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { TextField } from "../src/ui/TextField";
import { SectionLabel } from "../src/ui/SectionLabel";
import { Button } from "../src/ui/Button";
import { Surface, rowDivider } from "../src/ui/Surface";
import { size, space } from "../src/theme";
import { useColors } from "../src/ui/theme";

const PHONE_STATUS: Record<string, string> = {
  checking: "Checking…",
  off: "Off on this phone.",
  on: "On. This phone gets a push for the kinds switched on below.",
  blocked: "Notifications are off for CulinAIre Kitchen in your phone's settings.",
  unavailable: "This version of the app can't receive pushes yet. Your inbox still has everything.",
};

/** Which kinds of notification push to this person's phones, and the hours they stay quiet. The inbox always gets everything. */
export default function NotificationSettings() {
  const router = useRouter();
  const status = usePushStatus();
  const c = useColors();
  const [prefs, setPrefs] = useState<PushPreferences | "failed" | null>(null);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [quiet, setQuiet] = useState({ start: "22:00", end: "07:00" });
  const [quietSaved, setQuietSaved] = useState(false);

  useEffect(() => {
    void notificationsApi.preferences().then(
      (p) => {
        setPrefs(p);
        if (p.quietHours) setQuiet({ start: p.quietHours.start, end: p.quietHours.end });
      },
      () => setPrefs("failed"),
    );
  }, []);

  async function save(update: Parameters<typeof notificationsApi.savePreferences>[0]) {
    setSaving(true);
    setError(undefined);
    try {
      setPrefs(await notificationsApi.savePreferences(update));
      return true;
    } catch (err) {
      setError(err instanceof ApiError && err.code === "bad_request" ? err.message : "Couldn't save. Check your signal and try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const phone = (
    <View style={{ gap: space.sm }}>
      <SectionLabel>This phone</SectionLabel>
      <Text>{PHONE_STATUS[status]}</Text>
      {status === "off" ? <Button label="Turn on" onPress={() => void push.enable()} /> : null}
      {status === "on" ? <Button kind="ghost" label="Turn off on this phone" onPress={() => void push.disable()} /> : null}
      {status === "blocked" ? <Button kind="ghost" label="Open settings" onPress={() => push.openSettings()} /> : null}
    </View>
  );

  if (prefs === null || prefs === "failed") {
    return (
      <Screen>
        <Text variant="title">Notifications</Text>
        {phone}
        {prefs === null ? <Text variant="muted">Loading…</Text> : <Text variant="error">Couldn't load your notification settings. Try again.</Text>}
        <Button kind="quiet" label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  const disabled = prefs.types.filter((t) => !t.enabled).map((t) => t.type);
  const toggle = (type: string, on: boolean) => void save({ disabledTypes: (on ? disabled.filter((d) => d !== type) : [...disabled, type]) as never });
  const quietValid = QuietHoursSchema.safeParse({ ...quiet, timeZone: "UTC" }).success;
  const saveQuiet = async () => {
    // The phone's own zone: the server checks the window in it, so 22:00 means 22:00 where the person is.
    if (await save({ quietHours: { ...quiet, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } })) setQuietSaved(true);
  };

  return (
    <Screen>
      <Text variant="title">Notifications</Text>
      {phone}
      <SectionLabel>What to push</SectionLabel>
      <Text variant="muted">Switched off, it still reaches your inbox; it just doesn't buzz your phone.</Text>
      <Surface>
        {prefs.types.map((t, index) => (
          <View key={t.type} style={[{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: size.tap, paddingHorizontal: space.lg, paddingVertical: space.sm }, rowDivider(index, c.border)]}>
            <Text style={{ flex: 1 }}>{t.label}</Text>
            <Switch accessibilityLabel={t.label} value={t.enabled} disabled={saving} onValueChange={(on) => toggle(t.type, on)} trackColor={{ true: c.buttonFrom, false: c.border }} />
          </View>
        ))}
      </Surface>
      <SectionLabel>Quiet hours</SectionLabel>
      <Text variant="muted">
        {prefs.quietHours ? `No pushes from ${prefs.quietHours.start} to ${prefs.quietHours.end} (${prefs.quietHours.timeZone}). A push in that window is skipped, not saved for later.` : "Pick hours when no push is sent, such as overnight. A push in that window is skipped, not saved for later."}
      </Text>
      <View style={{ flexDirection: "row", gap: space.md }}>
        <View style={{ flex: 1 }}>
          <TextField label="From" value={quiet.start} placeholder="22:00" keyboardType="numbers-and-punctuation" maxLength={5} onChangeText={(start) => (setQuiet((q) => ({ ...q, start })), setQuietSaved(false))} />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label="To" value={quiet.end} placeholder="07:00" keyboardType="numbers-and-punctuation" maxLength={5} onChangeText={(end) => (setQuiet((q) => ({ ...q, end })), setQuietSaved(false))} />
        </View>
      </View>
      {!quietValid ? <Text variant="error">Use 24-hour times such as 22:00 and 07:00, and two different times.</Text> : null}
      {quietSaved ? <Text variant="meta">Quiet hours saved.</Text> : null}
      <Button label={prefs.quietHours ? "Save quiet hours" : "Set quiet hours"} disabled={saving || !quietValid} onPress={() => void saveQuiet()} />
      {prefs.quietHours ? <Button kind="ghost" label="Turn off quiet hours" disabled={saving} onPress={() => void save({ quietHours: null }).then(() => setQuietSaved(false))} /> : null}
      {error ? (
        <Text variant="error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button kind="quiet" label="Back" onPress={() => router.back()} />
    </Screen>
  );
}

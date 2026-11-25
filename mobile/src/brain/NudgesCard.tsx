import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { space } from "../theme";
import { Surface } from "../ui/Surface";
import { Text } from "../ui/Text";
import { useColors } from "../ui/theme";
import { useBrain } from "./BrainProvider";

/** The web's "Proactive nudges" opt-in. `reload` changes when the person pulls the screen down. */
export function NudgesCard({ reload }: { reload: number }) {
  const { api } = useBrain();
  const c = useColors();
  const [optIn, setOptIn] = useState<boolean | "failed" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    api.nudges().then((on) => current && setOptIn(on), () => current && setOptIn((was) => (typeof was === "boolean" ? was : "failed")));
    return () => void (current = false);
  }, [api, reload]);

  async function save(on: boolean) {
    setSaving(true);
    setError(false);
    setOptIn(on);
    try {
      setOptIn(await api.setNudges(on));
    } catch {
      setOptIn(!on);
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  if (optIn === null) return null; // nothing to flash before the choice is known
  return (
    <Surface>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg }}>
        <View style={{ flex: 1, gap: space.xs }}>
          <Text variant="heading">Proactive nudges</Text>
          <Text variant="muted">An occasional suggestion from your kitchen's recent activity, in your Inbox. Off by default; never interrupts.</Text>
          {optIn === "failed" ? <Text variant="meta">Couldn't load this setting. Pull down to try again.</Text> : null}
          {error ? <Text variant="error" accessibilityLiveRegion="polite">Couldn't save that. Check your signal and try again.</Text> : null}
        </View>
        {optIn !== "failed" ? <Switch accessibilityLabel="Proactive nudges" value={optIn} disabled={saving} onValueChange={(on) => void save(on)} trackColor={{ true: c.accentText, false: c.border }} thumbColor={optIn ? c.buttonTo : c.surface} ios_backgroundColor={c.border} /> : null}
      </View>
    </Surface>
  );
}

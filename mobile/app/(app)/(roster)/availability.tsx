import { useCallback, useState } from "react";
import { Alert, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { Availability } from "@culinaire/shared/schemas/roster";
import { writeMessage } from "../../../src/api/onlineWrite";
import { EmptyCard } from "../../../src/orders/ListState";
import { datesText, windowText } from "../../../src/roster/availabilityView";
import { useAvailability } from "../../../src/roster/RosterProvider";
import { Button } from "../../../src/ui/Button";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { ServerPage } from "../../../src/ui/ServerPage";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { Text } from "../../../src/ui/Text";
import { space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** The weekly windows I can work. Changes need a connection; the last list is kept sealed (`lockedCache`) and shown with no signal. */
export default function AvailabilityScreen() {
  const { store, snap } = useAvailability();
  const router = useRouter();
  const c = useColors();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  useFocusEffect(useCallback(() => void store.refresh(), [store]));

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    try {
      await store.remove(id);
    } catch (err) {
      setError({ id, text: writeMessage(err, "Removing it") });
    } finally {
      setBusy(null);
    }
  }
  const ask = (r: Availability) =>
    Alert.alert(`Remove ${windowText(r)}?`, "Managers will no longer see you as available then.", [
      { text: "Keep it", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void remove(r.staffAvailabilityId) },
    ]);

  return (
    <ServerPage
      header={<ScreenHeader label="Roster" title="My availability" />}
      snap={snap}
      loading="Loading your availability…"
      off={{ title: "The roster isn't in use here", text: "Your kitchen hasn't switched the roster on. Ask your manager." }}
      refresh={store.refresh}
    >
      <Text variant="muted">When you're generally free to work, on the venue's clock. Managers see it when they build the roster.</Text>
      {/* Only once the list is here: the form checks a new window against it. */}
      {snap.phase === "ready" ? <Button label="Add availability" onPress={() => router.push("/availability-edit")} /> : null}
      {snap.phase === "ready" && snap.rows.length === 0 ? <EmptyCard title="No availability yet" text="Add the days and times you can usually work." /> : null}
      {snap.rows.length > 0 ? (
        <Surface>
          {snap.rows.map((r, i) => (
            <View key={r.staffAvailabilityId} style={[{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xs, gap: space.xs }, rowDivider(i, c.border)]}>
              <View accessible accessibilityLabel={`${windowText(r)}, ${datesText(r)}`} style={{ gap: space.xs }}>
                <Text variant="heading">{windowText(r)}</Text>
                <Text variant="meta">{datesText(r)}</Text>
              </View>
              {error?.id === r.staffAvailabilityId ? <Text variant="error" accessibilityLiveRegion="polite">{error.text}</Text> : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xl }}>
                <Button kind="quiet" label="Change" disabled={busy !== null} onPress={() => router.push({ pathname: "/availability-edit", params: { id: r.staffAvailabilityId } })} />
                <Button kind="quiet" label={busy === r.staffAvailabilityId ? "Removing…" : "Remove"} disabled={busy !== null} onPress={() => ask(r)} />
              </View>
            </View>
          ))}
        </Surface>
      ) : null}
      <Button kind="quiet" label="Back" onPress={() => router.back()} />
    </ServerPage>
  );
}

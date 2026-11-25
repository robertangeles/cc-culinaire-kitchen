import { useCallback } from "react";
import { Alert, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSession } from "../../../src/runtime/appContext";
import { EmptyCard } from "../../../src/orders/ListState";
import { useRoster } from "../../../src/roster/RosterProvider";
import { dayLabel, hoursLabel, shownSwaps, timeLabel, type ShownSwap } from "../../../src/roster/shiftView";
import { Button } from "../../../src/ui/Button";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { ServerPage } from "../../../src/ui/ServerPage";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { Text } from "../../../src/ui/Text";
import { fontFamily, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** Shifts colleagues have offered for swap. The first person the server lets take one gets it. */
export default function Swaps() {
  const { state } = useSession();
  const { store, snap } = useRoster();
  const router = useRouter();
  const c = useColors();
  useFocusEffect(
    useCallback(() => {
      store.clearNotice();
      void store.refresh();
    }, [store]),
  );
  if (state.phase !== "ready") return null;

  const now = Date.now();
  const { shown, hidden } = shownSwaps(snap.swaps ?? [], state.user.userId, state.locations, snap.shifts, now);
  const claim = (swap: ShownSwap) =>
    Alert.alert("Take this shift?", `${dayLabel(swap)}, ${timeLabel(swap)}. You'll be confirmed for it straight away.`, [{ text: "Not now", style: "cancel" }, { text: "Take it", onPress: () => void store.claim(swap) }]);

  return (
    <ServerPage
      header={<ScreenHeader label="Roster" title="Open swaps" />}
      snap={snap}
      loading="Loading the open swaps…"
      off={{ title: "The roster isn't in use here", text: "Your kitchen hasn't switched the roster on. Ask your manager." }}
      refresh={store.refresh}
    >
      {snap.notice ? (
        <Text variant={snap.notice.bad ? "error" : "body"} accessibilityLiveRegion="polite">
          {snap.notice.text}
        </Text>
      ) : null}
      {snap.phase === "ready" && snap.swaps === null ? <EmptyCard title="Swaps aren't in use here" text="Your kitchen hasn't switched shift swaps on. Ask your manager." /> : null}
      {snap.phase === "ready" && snap.swaps !== null && shown.length === 0 ? <EmptyCard title="No open swaps" text="When a colleague offers a shift, it shows here for anyone who can work it." /> : null}
      {shown.length > 0 ? (
        <Surface>
          {shown.map((swap, i) => (
            <View key={swap.swapRequestId} style={[{ padding: space.lg, gap: space.xs }, rowDivider(i, c.border)]}>
              <Text variant="heading">{dayLabel(swap)}</Text>
              <Text style={{ fontFamily: fontFamily.uiStrong }}>{`${timeLabel(swap)} (${hoursLabel(swap)})`}</Text>
              <Text variant="meta">{[swap.roleName, swap.locationName, swap.fromUserName ? `Offered by ${swap.fromUserName}` : null].filter(Boolean).join(" · ")}</Text>
              <Button kind="ghost" label={snap.busy === swap.swapRequestId ? "Sending…" : `Take ${dayLabel(swap)}`} disabled={snap.busy !== null} onPress={() => claim(swap)} />
            </View>
          ))}
        </Surface>
      ) : null}
      {shown.length > 0 ? <Text variant="meta">Times are the venue's local time.</Text> : null}
      {hidden > 0 ? <Text variant="meta">{hidden === 1 ? "1 more is at a venue you don't work at. See it on the web." : `${hidden} more are at venues you don't work at. See them on the web.`}</Text> : null}
      <Button kind="quiet" label="Back" onPress={() => router.back()} />
    </ServerPage>
  );
}

import { useCallback, useState } from "react";
import { Alert, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSession } from "../../../src/runtime/appContext";
import { EmptyCard } from "../../../src/orders/ListState";
import { useRoster } from "../../../src/roster/RosterProvider";
import { hasStarted, hoursLabel, isOver, longDay, published, timeLabel } from "../../../src/roster/shiftView";
import { Button } from "../../../src/ui/Button";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { SectionLabel } from "../../../src/ui/SectionLabel";
import { ServerPage } from "../../../src/ui/ServerPage";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { Text } from "../../../src/ui/Text";
import { space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** One of my shifts: when and where, my answer, the public-holiday question when one was asked, and offering it for swap. */
export default function ShiftScreen() {
  const { state } = useSession();
  const { store, snap } = useRoster();
  const router = useRouter();
  const c = useColors();
  const params = useLocalSearchParams<{ shiftId: string; from?: string }>();
  useFocusEffect(
    useCallback(() => {
      store.clearNotice();
      void store.refresh();
    }, [store]),
  );
  // A shift given away while this page is open is no longer mine: the page says what happened instead of going blank.
  const [left, setLeft] = useState<string | null>(null);
  if (state.phase !== "ready") return null;

  const now = Date.now();
  const s = published(snap.shifts).find((row) => row.shiftId === params.shiftId);
  const back = () => (params.from === "link" ? router.dismissTo("/(app)/(roster)") : router.back());
  const notice = snap.notice && (s ? snap.notice.about === s.assignmentId : true) ? snap.notice : null;

  if (!s) {
    return (
      <ServerPage header={<ScreenHeader label="Roster" title="Shift" />} snap={snap} loading="Loading the shift…" off={{ title: "The roster isn't in use here", text: "Your kitchen hasn't switched the roster on. Ask your manager." }} refresh={store.refresh}>
        {snap.phase === "ready" ? <EmptyCard title="Not on your roster" text={left ?? notice?.text ?? "This shift was changed, given to someone else, or isn't published."} /> : null}
        <Button kind="quiet" label="Back to my shifts" onPress={back} />
      </ServerPage>
    );
  }

  const busy = snap.busy !== null;
  const over = isOver(s, now);
  const swap = store.mySwap(s.assignmentId);
  const facts = [
    { label: "Time", value: `${timeLabel(s)} (${hoursLabel(s)})` },
    { label: "Role", value: s.roleName },
    { label: "Where", value: s.locationName },
    { label: "Your answer", value: s.assignmentStatus === "Pending" ? "Not given yet" : s.assignmentStatus },
  ].filter((f) => f.value);

  const ask = (title: string, text: string, label: string, run: () => void) => Alert.alert(title, text, [{ text: "Not now", style: "cancel" }, { text: label, style: "destructive", onPress: run }]);
  const decline = () => ask("Decline this shift?", "Your manager will need to find someone else. You can't change this answer on the phone.", "Decline", () => void store.respond(s.assignmentId, "Declined"));
  const offer = () => ask("Offer this shift for swap?", "Anyone in your organisation who is allowed to work it can take it. It stays yours until someone does.", "Offer it", () => void store.offer(s.assignmentId));
  const takeBack = () => void store.cancelOffer(s.assignmentId).then((ok) => !ok && setLeft(store.getSnapshot().notice?.text ?? null));

  return (
    <ServerPage header={<ScreenHeader label={s.locationName || "Roster"} title={longDay(s)} />} snap={snap} loading="" off={{ title: "", text: "" }} refresh={store.refresh}>
      <Surface>
        {facts.map((f, i) => (
          <View key={f.label} accessible accessibilityLabel={`${f.label}: ${f.value}`} style={[{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.xs }, rowDivider(i, c.border)]}>
            <SectionLabel>{f.label}</SectionLabel>
            <Text>{f.value}</Text>
          </View>
        ))}
      </Surface>
      <Text variant="meta">{[over ? "This shift is finished." : null, s.isPublicHoliday ? "This is a public holiday." : null, "Times are the venue's local time."].filter(Boolean).join(" ")}</Text>

      {!over && s.publicHolidayConsent === "Requested" ? (
        <Surface>
          <View style={{ padding: space.lg, gap: space.md }}>
            <Text variant="heading">Would you work this public holiday?</Text>
            <Text variant="muted">You can say no. This is a separate question from confirming the shift.</Text>
            <Button label="Yes, I'll work it" disabled={busy} onPress={() => void store.consent(s.assignmentId, "Accepted")} />
            <Button kind="ghost" label="No" disabled={busy} onPress={() => void store.consent(s.assignmentId, "Declined")} />
          </View>
        </Surface>
      ) : null}
      {s.publicHolidayConsent === "Accepted" ? <Text>You agreed to work this public holiday.</Text> : null}
      {s.publicHolidayConsent === "Declined" ? <Text>You declined this public holiday shift.</Text> : null}

      {notice ? (
        <Text variant={notice.bad ? "error" : "body"} accessibilityLiveRegion="polite">
          {notice.text}
        </Text>
      ) : null}

      {!over && s.assignmentStatus === "Pending" ? (
        <>
          <Button label={busy ? "Sending…" : "Confirm shift"} disabled={busy} onPress={() => void store.respond(s.assignmentId, "Confirmed")} />
          <Button kind="danger" label="Decline" disabled={busy} onPress={decline} />
        </>
      ) : null}
      {snap.swaps && s.assignmentStatus === "Confirmed" && !hasStarted(s, now) ? (
        swap ? (
          <>
            {notice ? null : <Text>You've offered this shift for swap. It stays yours until someone takes it.</Text>}
            <Button kind="ghost" label={busy ? "Sending…" : "Take the offer back"} disabled={busy} onPress={takeBack} />
          </>
        ) : (
          <Button kind="ghost" label={busy ? "Sending…" : "Offer to swap"} disabled={busy} onPress={offer} />
        )
      ) : null}
      <Button kind="quiet" label="Back" onPress={back} />
    </ServerPage>
  );
}

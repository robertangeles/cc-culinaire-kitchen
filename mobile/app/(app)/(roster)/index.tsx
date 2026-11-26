import { useCallback } from "react";
import { Pressable, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSession } from "../../../src/runtime/appContext";
import { EmptyCard } from "../../../src/orders/ListState";
import { useRoster } from "../../../src/roster/RosterProvider";
import { answerNeeded, dayLabel, hiddenConsents, isOver, published, rosterSections, shownSwaps, statusWord, timeLabel } from "../../../src/roster/shiftView";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { SectionLabel } from "../../../src/ui/SectionLabel";
import { ServerPage } from "../../../src/ui/ServerPage";
import { Chip, Surface, rowDivider } from "../../../src/ui/Surface";
import { Text } from "../../../src/ui/Text";
import { fontFamily, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** My shifts: this week, next week and anything further on, each on its venue's clock, with the way to my availability and the open swaps. */
export default function Roster() {
  const { state } = useSession();
  const { store, snap } = useRoster();
  const router = useRouter();
  const c = useColors();
  useFocusEffect(useCallback(() => void store.refresh(), [store]));
  if (state.phase !== "ready") return null;

  const now = Date.now();
  const sections = rosterSections(snap.shifts, now);
  const waiting = published(snap.shifts).filter((s) => answerNeeded(s, now)).length;
  const drafts = hiddenConsents(snap.shifts);
  const open = shownSwaps(snap.swaps ?? [], state.user.userId, state.locations, snap.shifts, now).shown.length;
  const links = [
    { label: "My availability", badge: null, href: "/availability" as const },
    ...(snap.swaps ? [{ label: "Open swaps", badge: open > 0 ? `${open} open` : null, href: "/swaps" as const }] : []),
  ];

  return (
    <ServerPage
      header={<ScreenHeader label={state.location.locationName} title="Roster" />}
      snap={snap}
      loading="Loading your shifts…"
      off={{ title: "The roster isn't in use here", text: "Your kitchen hasn't switched the roster on. Ask your manager." }}
      refresh={store.refresh}
    >
      <Surface>
        {links.map((l, i) => (
          <Pressable
            key={l.href}
            accessibilityRole="button"
            accessibilityLabel={l.badge ? `${l.label}, ${l.badge}` : l.label}
            onPress={() => router.push(l.href)}
            style={({ pressed }) => [{ minHeight: size.tap, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, backgroundColor: pressed ? c.surface : undefined }, rowDivider(i, c.border)]}
          >
            <Text style={{ flex: 1, fontFamily: fontFamily.uiStrong }}>{l.label}</Text>
            {l.badge ? <Chip label={l.badge} /> : null}
            <Text style={{ color: c.accentText, fontSize: 22 }}>›</Text>
          </Pressable>
        ))}
      </Surface>
      {waiting > 0 ? <Text variant="meta" accessibilityLiveRegion="polite">{waiting === 1 ? "1 shift needs your answer" : `${waiting} shifts need your answer`}</Text> : null}
      {drafts > 0 ? <EmptyCard title="A public holiday question" text="Your manager has asked whether you would work a public holiday on a roster that isn't published yet. Answer it on the web, under Roster." /> : null}
      {snap.phase === "ready" && sections.length === 0 ? <EmptyCard title="No shifts yet" text="Your published shifts for this week and next show here." /> : null}
      {sections.map((section) => (
        <View key={section.title} style={{ gap: space.sm }}>
          <SectionLabel>{section.title}</SectionLabel>
          <Surface>
            {section.shifts.map((s, i) => {
              const word = statusWord(s, now);
              return (
                <Pressable
                  key={s.assignmentId}
                  accessibilityRole="button"
                  accessibilityLabel={[dayLabel(s), timeLabel(s), s.roleName, s.locationName, s.isPublicHoliday ? "Public holiday" : null, word].filter(Boolean).join(", ")}
                  onPress={() => router.push({ pathname: "/shift", params: { shiftId: s.shiftId } })}
                  style={({ pressed }) => [{ padding: space.lg, gap: space.xs, opacity: isOver(s, now) ? 0.6 : 1, backgroundColor: pressed ? c.surface : undefined }, rowDivider(i, c.border)]}
                >
                  <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: space.sm }}>
                    <Text variant="heading">{dayLabel(s)}</Text>
                    <Chip label={word} />
                  </View>
                  <Text style={{ fontFamily: fontFamily.uiStrong }}>{timeLabel(s)}</Text>
                  <Text variant="meta">{[s.roleName, s.locationName, s.isPublicHoliday ? "Public holiday" : null].filter(Boolean).join(" · ")}</Text>
                </Pressable>
              );
            })}
          </Surface>
        </View>
      ))}
      {sections.length > 0 ? <Text variant="meta">Times are the venue's local time.</Text> : null}
    </ServerPage>
  );
}

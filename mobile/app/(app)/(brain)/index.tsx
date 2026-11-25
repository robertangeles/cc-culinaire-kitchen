import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Memory } from "@culinaire/shared/schemas/brain";
import { useSession } from "../../../src/runtime/appContext";
import { useBrain } from "../../../src/brain/BrainProvider";
import { NudgesCard } from "../../../src/brain/NudgesCard";
import { canRemove, isLearning, memoryLabel, provenance, SOURCES } from "../../../src/brain/brainView";
import { OfflineBanner } from "../../../src/ui/Banner";
import { Button } from "../../../src/ui/Button";
import { ChoiceChips } from "../../../src/ui/ChoiceChips";
import { Column } from "../../../src/ui/Column";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { Segmented } from "../../../src/ui/Segmented";
import { Chip, Surface, rowDivider } from "../../../src/ui/Surface";
import { Text } from "../../../src/ui/Text";
import { TextField } from "../../../src/ui/TextField";
import { size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

const TIERS = [
  { value: "user" as const, label: "Private to you" },
  { value: "org" as const, label: "Shared" },
];
const SOURCE_LABELS = SOURCES.map((s) => s.label);

/** The web's three empty lists: nothing matches, nothing shared, nothing remembered yet. */
function emptyWords(filtered: boolean, scope: "user" | "org") {
  if (filtered) return { title: "No memories match", text: "Try a different search or clear the filters to see everything CulinAIre remembers." };
  if (scope === "org") return { title: "Your kitchen hasn't shared anything yet", text: "Memories you or your team share on the web show up here, so everyone cooks with the same context." };
  return { title: "Your Brain is warming up", text: "Keep cooking and chatting. CulinAIre starts remembering what matters to your kitchen, so it always has your context." };
}

/** Everything CulinAIre remembers for this person: private or shared with the kitchen, by source, searched, and removed for good. */
export default function YourBrain() {
  const { state } = useSession();
  const { store, snap } = useBrain();
  const c = useColors();
  const [search, setSearch] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pulls, setPulls] = useState(0);
  useFocusEffect(useCallback(() => void store.refresh(), [store]));
  // The server is asked once typing pauses, as on the web.
  useEffect(() => {
    const timer = setTimeout(() => void store.setFilter({ search }), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search, store]);
  if (state.phase !== "ready") return null;
  const { user } = state;
  const filtered = snap.search.trim() !== "" || snap.sourceType !== null;
  // Nothing here at all: no filters over an empty list.
  const nothing = snap.phase === "ready" && snap.items.length === 0 && !filtered && search === "";
  const empty = emptyWords(filtered, snap.scope);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={async () => { setPulling(true); setPulls((n) => n + 1); await store.refresh(); setPulling(false); }} />}
      >
        <Column style={{ gap: space.lg }}>
          <ScreenHeader label="Kitchen AI" title="Your Brain" />
          <Text variant="muted">What CulinAIre remembers, so it always has your context.</Text>
          <Segmented options={TIERS} value={snap.scope} onChange={(scope) => void store.setFilter({ scope })} />
          {nothing ? null : (
            <>
              <TextField label="Search" value={search} onChangeText={setSearch} placeholder="Search your memories" autoCorrect={false} maxLength={200} />
              <ChoiceChips label="From" options={SOURCE_LABELS} value={SOURCES.find((s) => s.value === snap.sourceType)!.label} onChange={(label) => void store.setFilter({ sourceType: SOURCES.find((s) => s.label === label)!.value })} />
            </>
          )}

          {snap.savedAt ? <OfflineBanner text={`Can't reach the server. This is the list from ${new Date(snap.savedAt).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.`} /> : snap.error ? <Text variant="error">{snap.error}</Text> : null}
          {snap.error ? <Button kind="ghost" label="Try again" onPress={() => void store.refresh()} /> : null}
          {snap.phase === "loading" ? <Text variant="muted">Loading your memories…</Text> : null}
          {snap.phase === "ready" && snap.items.length === 0 ? (
            <Surface>
              <View style={{ padding: space.lg, gap: space.xs }}>
                <Text variant="heading">{empty.title}</Text>
                <Text variant="muted">{empty.text}</Text>
              </View>
            </Surface>
          ) : null}
          {snap.phase === "ready" && snap.items.length > 0 ? (
            <View style={{ gap: space.xs }}>
              <Text variant="meta" accessibilityLiveRegion="polite">{snap.total === 1 ? "1 memory" : `${snap.total} memories`}</Text>
              <Surface>
                {snap.items.map((m, index) => (
                  <View key={m.memoryId} style={rowDivider(index, c.border)}>
                    <MemoryRow memory={m} removable={canRemove(user, m)} onRemove={() => store.remove(m.memoryId)} />
                  </View>
                ))}
              </Surface>
              {snap.items.length < snap.total ? <Button kind="ghost" label={snap.more ? "Loading…" : "Load more"} disabled={snap.more} onPress={() => void store.loadMore()} /> : null}
            </View>
          ) : null}

          <NudgesCard reload={pulls} />
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

/** A memory: its name and where it came from; tapped, its text and Remove. */
function MemoryRow({ memory, removable, onRemove }: { memory: Memory; removable: boolean; onRemove: () => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = memoryLabel(memory);
  const from = provenance(memory);

  async function remove() {
    setRemoving(true);
    setError(await onRemove());
    setRemoving(false);
  }
  const confirm = () =>
    Alert.alert(`Remove “${label}”?`, memory.scope === "org" ? "CulinAIre forgets it for good, for your whole kitchen, on the web too." : "CulinAIre forgets it for good, on the web too.", [
      { text: "Keep it", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void remove() },
    ]);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={[label, from, memory.isPinned ? "pinned" : "", isLearning(memory) ? "learning" : ""].filter(Boolean).join(", ")}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => ({ minHeight: size.tap, padding: space.lg, gap: space.xs, opacity: pressed ? 0.6 : 1 })}
      >
        <Text variant="heading">{label}</Text>
        {from ? <Text variant="meta">{from}</Text> : null}
        {memory.isPinned || isLearning(memory) ? (
          <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.xs }}>
            {memory.isPinned ? <Chip label="Pinned" /> : null}
            {isLearning(memory) ? <Chip label="Learning…" /> : null}
          </View>
        ) : null}
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.lg }}>
          <Text>{memory.body}</Text>
          {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
          {removable ? <Button kind="danger" label={removing ? "Removing…" : "Remove"} disabled={removing} onPress={confirm} /> : null}
        </View>
      ) : null}
    </View>
  );
}

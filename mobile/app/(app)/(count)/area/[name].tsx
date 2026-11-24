import { useState } from "react";
import { AccessibilityInfo, Alert, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCount } from "../../../../src/count/CountProvider";
import { firstUncounted, reviewRows, submitCheck, type Answer, type SaveState } from "../../../../src/count/countFlow";
import { limitMessage, parseEntry, press, type Key } from "../../../../src/count/keypad";
import { CardTransition } from "../../../../src/ui/CardTransition";
import { Keypad } from "../../../../src/ui/Keypad";
import { OfflineBanner } from "../../../../src/ui/Banner";
import { Button } from "../../../../src/ui/Button";
import { Text } from "../../../../src/ui/Text";
import { Surface, rowDivider } from "../../../../src/ui/Surface";
import { fontFamily, fontSize, size, space } from "../../../../src/theme";
import { useColors } from "../../../../src/ui/theme";

const SAVE_LABEL: Record<SaveState, string> = {
  saved_on_phone: "Saved on this phone",
  waiting_to_send: "Waiting to send",
  accepted: "Accepted",
  needs_attention: "Needs attention",
};

/** Count one area item by item in shelf order, then review the whole area and submit it. */
export default function AreaCount() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const { store, snap } = useCount();
  const router = useRouter();
  const c = useColors();

  const items = snap.sheets.find((s) => s.categoryName === name)?.items ?? [];
  const answers = store.answers(name);
  const prefill = (i: number) => (answers.get(items[i]?.ingredientId) ? String(answers.get(items[i].ingredientId)!.rawQty) : "");

  const [view, setView] = useState<{ mode: "count" | "review"; index: number }>(() => {
    const first = firstUncounted(items, answers);
    return first === -1 ? { mode: "review", index: 0 } : { mode: "count", index: first };
  });
  const [entry, setEntry] = useState(() => (view.mode === "count" ? prefill(view.index) : ""));
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const goTo = (i: number) => {
    setView({ mode: "count", index: i });
    setEntry(prefill(i));
    setMessage(null);
  };
  // A typed number that was not saved is never dropped silently: ask first.
  const unsaved = view.mode === "count" && entry !== prefill(view.index) && parseEntry(entry) !== null;
  const leave = (action: () => void) => {
    if (!unsaved) return action();
    Alert.alert("Discard the number you typed?", "It has not been saved.", [
      { text: "Keep typing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: action },
    ]);
  };
  const advance = (from: number) => (from + 1 < items.length ? goTo(from + 1) : (setView({ mode: "review", index: 0 }), setMessage(null)));

  if (items.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, padding: space.xl, gap: space.lg }}>
        <Text variant="title">{name}</Text>
        <Text>There is nothing on this area's sheet yet.</Text>
        <Button label="Back to areas" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  if (view.mode === "review") {
    const rows = reviewRows(items, answers);
    const check = submitCheck(rows);
    const blockers = [
      check.gaps > 0 ? `Enter a count (0 if none) for ${check.gaps} shared ${check.gaps === 1 ? "item" : "items"}.` : null,
      check.needsAttention > 0 ? `${check.needsAttention} ${check.needsAttention === 1 ? "count needs" : "counts need"} attention.` : null,
      check.waiting > 0 ? `${check.waiting} ${check.waiting === 1 ? "count is" : "counts are"} still waiting to send.` : null,
    ].filter(Boolean);

    const submit = async () => {
      setBusy(true);
      setMessage(null);
      const result = await store.submit(name);
      setBusy(false);
      if (result.ok) router.replace("/");
      else if (result.reason === "missing") setMessage(`${result.message}`);
      else if (result.reason === "blocked") setMessage("Finish the counts above first.");
      else setMessage(result.message);
    };

    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md }}>
          <Text variant="title">Review {name}</Text>
          {snap.offline ? <OfflineBanner text="You're offline. Counts are saved on this phone." /> : null}
          <Surface>
          {rows.map((r, i) => (
            <Pressable
              key={r.ingredientId}
              accessibilityRole="button"
              accessibilityLabel={`${r.name}: ${rowText(r.kind, r.answer, r.alsoIn)}`}
              onPress={() => goTo(i)}
              style={[{ minHeight: size.tap + 8, justifyContent: "center", paddingVertical: space.sm, paddingHorizontal: space.lg }, rowDivider(i, c.border)]}
            >
              <Text variant="heading">{r.name}</Text>
              <Text variant={r.kind === "needs_attention" || r.kind === "shared_gap" ? "error" : "muted"}>{rowText(r.kind, r.answer, r.alsoIn)}</Text>
            </Pressable>
          ))}
          </Surface>
          {blockers.map((b) => <Text key={b as string} variant="muted">{b}</Text>)}
          {message ? <Text variant="error" accessibilityLiveRegion="polite">{message}</Text> : null}
          <Button label={busy ? "Submitting…" : "Submit area"} disabled={!check.ok || busy} onPress={() => void submit()} />
          <Button kind="quiet" label="Back to areas" onPress={() => router.back()} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const item = items[view.index];
  const current = answers.get(item.ingredientId);
  const value = parseEntry(entry);

  const onKey = (key: Key) => {
    setMessage(limitMessage(entry, key));
    setEntry(press(entry, key));
  };
  const save = async () => {
    if (value === null) return;
    setBusy(true);
    try {
      await store.saveCount(name, { ingredientId: item.ingredientId, ingredientName: item.ingredientName, rawQty: value, countedUnit: item.countUnit });
      AccessibilityInfo.announceForAccessibility("Saved on this phone");
      advance(view.index);
    } catch {
      setMessage("That count wasn't saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <Text variant="meta">{name} · item {view.index + 1} of {items.length}</Text>
        {snap.offline ? <OfflineBanner text="You're offline. Counts are saved on this phone." /> : null}
        <CardTransition itemKey={item.ingredientId}>
          <Text variant="title" style={{ fontSize: fontSize.item }}>{item.ingredientName}</Text>
          {item.alsoIn.length > 0 ? <Text variant="meta">Also in {item.alsoIn.join(", ")}</Text> : null}
          <Text variant="meta">Count in {item.countUnit}</Text>
          <Text
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${item.ingredientName}, ${item.countUnit}, ${entry === "" ? "nothing typed" : entry}`}
            style={{ fontFamily: fontFamily.uiStrong, fontSize: fontSize.number, fontVariant: ["tabular-nums"] }}
          >
            {entry === "" ? "–" : entry}
          </Text>
          {current ? <Text variant={current.saveState === "needs_attention" ? "error" : "muted"}>{SAVE_LABEL[current.saveState]}</Text> : null}
        </CardTransition>
        {message ? <Text variant="error" accessibilityLiveRegion="polite">{message}</Text> : null}

        <Keypad entry={entry} onKey={onKey} />
        <Button label={busy ? "Saving…" : "Save and next"} disabled={value === null || busy} onPress={() => void save()} />
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Button kind="quiet" label="Previous" disabled={view.index === 0} onPress={() => leave(() => goTo(view.index - 1))} />
          <Button kind="quiet" label="Skip" onPress={() => leave(() => advance(view.index))} />
          <Button kind="quiet" label="Review" onPress={() => leave(() => setView({ mode: "review", index: 0 }))} />
        </View>

        {items.slice(view.index + 1, view.index + 3).map((next, i) => (
          <Pressable key={next.ingredientId} accessibilityRole="button" accessibilityLabel={`Jump to ${next.ingredientName}`} onPress={() => leave(() => goTo(view.index + 1 + i))} style={{ minHeight: size.tap, justifyContent: "center" }}>
            <Text variant="muted">{next.ingredientName}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function rowText(kind: "counted" | "not_counted" | "shared_gap" | "needs_attention", answer: Answer | undefined, alsoIn: string[]): string {
  if (kind === "counted" && answer) return `${answer.rawQty} ${answer.countedUnit} · ${SAVE_LABEL[answer.saveState]}`;
  if (kind === "needs_attention" && answer) return `${answer.rawQty} ${answer.countedUnit} · Needs attention`;
  if (kind === "shared_gap") return `Not counted here. Also in ${alsoIn.join(", ")}: enter 0 if none.`;
  return "Not counted";
}

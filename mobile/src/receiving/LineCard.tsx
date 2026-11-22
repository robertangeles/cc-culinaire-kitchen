import { useState } from "react";
import { Pressable, View } from "react-native";
import { Button } from "../ui/Button";
import { Keypad } from "../ui/Keypad";
import { Chip } from "../ui/Surface";
import { Text } from "../ui/Text";
import { TextField } from "../ui/TextField";
import { fontFamily, fontSize, size, space } from "../theme";
import { useColors } from "../ui/theme";
import { limitMessage, press, type Key } from "../count/keypad";
import {
  REJECTION_REASONS,
  STATUS_LABEL,
  allGood,
  formatMoney,
  formatQty,
  lineSummary,
  priceInput,
  rejectInput,
  shortInput,
  type LineInput,
  type ReceivingLine,
  type RejectionReason,
} from "./receivingFlow";

type Panel = "short" | "price" | "reject" | null;

interface Props {
  line: ReceivingLine;
  open: boolean;
  saving: boolean;
  /** The server's reason the last change was refused, shown under the line. */
  error?: string;
  onToggle: () => void;
  /** Resolves true when the server accepted the change. */
  onSubmit: (input: LineInput) => Promise<boolean>;
}

/**
 * One delivery line: collapsed it is a name and one fact (a perfect delivery needs no taps on it);
 * opened it offers the four things a chef can say about it. Every number goes through the count keypad.
 */
export function LineCard({ line, open, saving, error, onToggle, onSubmit }: Props) {
  const c = useColors();
  const [panel, setPanel] = useState<Panel>(null);
  const [entry, setEntry] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [reason, setReason] = useState<RejectionReason>("quality");
  const [note, setNote] = useState("");

  const close = () => {
    setPanel(null);
    setEntry("");
    setHint(null);
    setNote("");
  };
  const send = async (input: LineInput) => {
    if (await onSubmit(input)) {
      close();
      onToggle();
    }
  };
  const submitChecked = (checked: ReturnType<typeof shortInput>) => {
    if (!checked.ok) return setHint(checked.message);
    void send(checked.value);
  };
  const onKey = (key: Key) => {
    setHint(limitMessage(entry, key));
    setEntry(press(entry, key));
  };
  const flagged = line.status !== "RECEIVED";
  const name = line.ingredientName ?? "Unknown item";

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${name}, ${lineSummary(line)}, ${STATUS_LABEL[line.status]}`}
        onPress={() => {
          close();
          onToggle();
        }}
        style={{ minHeight: size.tap + 14, justifyContent: "center", paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.xs }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
          <Text style={{ fontFamily: fontFamily.title, fontSize: 20, flexShrink: 1 }}>{name}</Text>
          <Chip label={saving ? "Saving…" : STATUS_LABEL[line.status]} />
        </View>
        <Text variant={flagged ? "error" : "meta"}>{lineSummary(line)}</Text>
        {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
      </Pressable>

      {open && panel === null ? (
        <View style={{ padding: space.lg, paddingTop: 0, gap: space.sm }}>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}><Button label="All good" kind={flagged ? "primary" : "ghost"} disabled={saving} onPress={() => void send(allGood(line))} /></View>
            <View style={{ flex: 1 }}><Button label="Short" kind="ghost" disabled={saving} onPress={() => setPanel("short")} /></View>
          </View>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}><Button label="Wrong price" kind="ghost" disabled={saving} onPress={() => setPanel("price")} /></View>
            <View style={{ flex: 1 }}><Button label="Reject" kind="ghost" disabled={saving} onPress={() => setPanel("reject")} /></View>
          </View>
        </View>
      ) : null}

      {open && (panel === "short" || panel === "price") ? (
        <View style={{ padding: space.lg, paddingTop: 0, gap: space.md }}>
          <Text variant="meta">
            {panel === "short" ? `How much arrived? You ordered ${formatQty(line.orderedQty)} ${line.orderedUnit}.` : `Price charged per ${line.orderedUnit} (the order says ${formatMoney(line.actualUnitCost ?? 0)}).`}
          </Text>
          <Text
            accessibilityLiveRegion="polite"
            accessibilityLabel={entry === "" ? "Nothing typed" : entry}
            style={{ fontFamily: fontFamily.uiStrong, fontSize: fontSize.number, fontVariant: ["tabular-nums"] }}
          >
            {entry === "" ? "–" : panel === "price" ? `$${entry}` : entry}
          </Text>
          {hint ? <Text variant="error" accessibilityLiveRegion="polite">{hint}</Text> : null}
          <Keypad entry={entry} onKey={onKey} />
          <Button label={saving ? "Saving…" : panel === "short" ? "Mark short" : "Save price"} disabled={saving || entry === ""} onPress={() => submitChecked(panel === "short" ? shortInput(entry, line) : priceInput(entry))} />
          <Button kind="quiet" label="Back" onPress={close} />
        </View>
      ) : null}

      {open && panel === "reject" ? (
        <View style={{ padding: space.lg, paddingTop: 0, gap: space.sm }}>
          <Text variant="meta">Why is it being rejected?</Text>
          {REJECTION_REASONS.map((r) => (
            <Pressable
              key={r.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: reason === r.value }}
              onPress={() => setReason(r.value)}
              style={{ minHeight: size.tap, justifyContent: "center", paddingHorizontal: space.md, borderWidth: 1, borderRadius: 14, borderColor: reason === r.value ? c.buttonFrom : c.border, backgroundColor: c.surface }}
            >
              <Text style={{ fontFamily: reason === r.value ? fontFamily.uiStrong : fontFamily.ui }}>{r.label}</Text>
            </Pressable>
          ))}
          <TextField label="Note (optional)" value={note} onChangeText={setNote} maxLength={500} />
          <Button label={saving ? "Saving…" : "Reject item"} disabled={saving} onPress={() => void send(rejectInput(reason, note))} />
          <Button kind="quiet" label="Back" onPress={close} />
        </View>
      ) : null}
    </View>
  );
}

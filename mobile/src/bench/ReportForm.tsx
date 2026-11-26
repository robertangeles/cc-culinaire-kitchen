import { useState } from "react";
import { View } from "react-native";
import { BENCH_REPORT_REASONS, BENCH_REPORT_REASON_LABELS, type BenchReportRequest } from "@culinaire/shared/schemas/bench";
import { space } from "../theme";
import { Button } from "../ui/Button";
import { ChoiceChips } from "../ui/ChoiceChips";
import { Surface } from "../ui/Surface";
import { Text } from "../ui/Text";
import { TextField } from "../ui/TextField";
import { benchFailure } from "./benchStore";

/** What is reported: one message (with its words, to show) or one person. */
export type ReportTarget = { userId: number; userName: string } & ({ messageId: string; words: string } | { messageId?: undefined });

const LABELS = BENCH_REPORT_REASONS.map((r) => BENCH_REPORT_REASON_LABELS[r]);

/** A reason from the fixed list and an optional note, sent to the moderators. The person reported is never told who reported them. */
export function ReportForm({ target, send, onSent, onCancel }: { target: ReportTarget; send: (report: BenchReportRequest) => Promise<void>; onSent: () => void; onCancel: () => void }) {
  const [label, setLabel] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = BENCH_REPORT_REASONS.find((r) => BENCH_REPORT_REASON_LABELS[r] === label);

  async function submit() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      const about = target.messageId !== undefined ? { messageId: target.messageId } : { userId: target.userId };
      await send({ ...about, reason, ...(note.trim() ? { note: note.trim() } : {}) });
      onSent();
    } catch (err) {
      setError(benchFailure(err));
      setBusy(false);
    }
  }

  return (
    <Surface>
      <View style={{ padding: space.lg, gap: space.md }}>
        <Text variant="heading">{target.messageId !== undefined ? `Report ${target.userName}'s message` : `Report ${target.userName}`}</Text>
        {target.messageId !== undefined ? <Text variant="muted" numberOfLines={3}>{`“${target.words}”`}</Text> : null}
        <ChoiceChips label="What's wrong" options={LABELS} value={label} onChange={setLabel} />
        <TextField label="Anything else the moderators should know (optional)" value={note} onChangeText={setNote} maxLength={500} multiline />
        <Text variant="meta">
          {target.messageId !== undefined
            ? `A moderator reads the reported message, who sent it and when, and nothing else from the conversation. ${target.userName} isn't told who sent the report.`
            : `A moderator reads your report. ${target.userName} isn't told who sent it.`}
        </Text>
        {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
        <Button label={busy ? "Sending…" : "Send report"} disabled={!reason || busy} onPress={() => void submit()} />
        <Button kind="quiet" label="Cancel" onPress={onCancel} />
      </View>
    </Surface>
  );
}

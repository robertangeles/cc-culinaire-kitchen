import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { outbox, runner } from "../runtime/appOutbox";
import type { AttentionReason, OutboxEntry } from "./outbox";
import { Button } from "../ui/Button";
import { Surface, rowDivider } from "../ui/Surface";
import { Text } from "../ui/Text";
import { useColors } from "../ui/theme";
import { space } from "../theme";

/** The entries of these types that are waiting, being sent or stuck, kept current as the queue changes. */
export function useOpenEntries(types: string[]): OutboxEntry<unknown>[] {
  const [entries, setEntries] = useState<OutboxEntry<unknown>[]>([]);
  const key = types.join(",");
  useEffect(() => {
    let live = true;
    const load = () => void outbox.open(key.split(",")).then((e) => live && setEntries(e));
    load();
    const unsubscribe = outbox.subscribe(load);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [key]);
  return entries;
}

/** One plain sentence per reason; the server's own words are used when it said something specific. */
export function attentionSentence(reason: AttentionReason | undefined, serverMessage: string | undefined): string {
  switch (reason) {
    case "signed_out":
      return "You were signed out. Sign in again and this will be sent.";
    case "server_error":
      return "The server couldn't save this after several tries. Try again later.";
    case "unsupported":
      return "This was saved by a newer version of the app. Update the app and it will be sent.";
    case "no_access":
      return serverMessage || "Your account can't do this here. Ask your manager.";
    default:
      return serverMessage || "The server didn't accept this.";
  }
}

/**
 * What is waiting on this phone and what is stuck, for the given command types: a count of what is waiting to send and each stuck
 * command with the server's reason and "Try again" or "Discard". A command is never dropped without being shown here first.
 */
export function QueueStatus({ types }: { types: string[] }) {
  const c = useColors();
  const entries = useOpenEntries(types);
  const waiting = entries.filter((e) => e.status !== "NEEDS_ATTENTION").length;
  const stuck = entries.filter((e) => e.status === "NEEDS_ATTENTION" && outbox.describe(e));
  if (waiting === 0 && stuck.length === 0) return null;

  const discard = (e: OutboxEntry<unknown>) =>
    Alert.alert(`Discard "${outbox.describe(e)}"?`, "It won't be sent. A record of it is kept on this phone.", [
      { text: "Keep it", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => void outbox.discard(e.id) },
    ]);

  return (
    <View style={{ gap: space.sm }}>
      {waiting > 0 ? <Text variant="muted" accessibilityLiveRegion="polite">{waiting} waiting to send</Text> : null}
      {stuck.length > 0 ? (
        <Surface>
          {stuck.map((e, i) => (
            <View key={e.id} style={[{ padding: space.lg, gap: space.sm }, rowDivider(i, c.border)]}>
              <Text>{outbox.describe(e)}</Text>
              <Text variant="error">⚠ {attentionSentence(e.attention?.reason, e.attention?.message)}</Text>
              <Button label="Try again" onPress={() => void outbox.retry(e.id).then(runner.kick)} />
              <Button kind="quiet" label="Discard" onPress={() => discard(e)} />
            </View>
          ))}
        </Surface>
      ) : null}
    </View>
  );
}

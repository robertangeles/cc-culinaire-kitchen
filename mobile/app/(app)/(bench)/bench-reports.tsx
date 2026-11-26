import { useCallback, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { BENCH_REPORT_REASON_LABELS, type BenchReport } from "@culinaire/shared/schemas/bench";
import { ApiError } from "../../../src/api/client";
import { useSession } from "../../../src/runtime/appContext";
import { useBench } from "../../../src/bench/BenchProvider";
import { benchFailure } from "../../../src/bench/benchStore";
import { timeAgo } from "../../../src/notifications/notificationView";
import { hasAnyPermission } from "../../../src/shell/tabs";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { Surface } from "../../../src/ui/Surface";
import { Text } from "../../../src/ui/Text";
import { fontFamily, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

const MODERATE = ["bench:moderate"];

function failure(err: unknown): string {
  if (err instanceof ApiError && err.hasCode("INVALID_STATE")) return "Someone already closed this report.";
  if (err instanceof ApiError && err.code === "forbidden") return "Only moderators can review reports.";
  return benchFailure(err);
}

/** The open reports, for moderators (`bench:moderate`): hide the message or dismiss the report. Resolving with a note is on the web. */
export default function BenchReports() {
  const { state } = useSession();
  const { api } = useBench();
  const router = useRouter();
  const c = useColors();
  const [reports, setReports] = useState<BenchReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const load = useCallback(async () => {
    try {
      setReports(await api.reports());
      setError(null);
    } catch (err) {
      setError(failure(err));
    }
  }, [api]);
  useFocusEffect(useCallback(() => void load(), [load]));
  if (state.phase !== "ready") return null;
  const allowed = hasAnyPermission(state.user, MODERATE);

  async function act(r: BenchReport, action: "hide" | "dismiss") {
    setBusy(r.id);
    let failed: string | null = null;
    try {
      await api.act(r.id, action);
    } catch (err) {
      failed = failure(err);
    }
    await load(); // closed by someone else meanwhile, or not: the list is read again either way
    if (failed) setError(failed);
    setBusy(null);
  }
  const confirmHide = (r: BenchReport) =>
    Alert.alert("Hide this message?", "It goes for everyone, on the web too. It is kept for the record, and every open report about it is closed.", [
      { text: "Cancel", style: "cancel" },
      { text: "Hide", style: "destructive", onPress: () => void act(r, "hide") },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl }}
        refreshControl={allowed ? <RefreshControl refreshing={pulling} onRefresh={async () => { setPulling(true); await load(); setPulling(false); }} /> : undefined}
      >
        <Column style={{ gap: space.lg }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to the Bench" hitSlop={8} onPress={() => router.back()} style={{ minHeight: size.tap, justifyContent: "center", alignSelf: "flex-start" }}>
            <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText }}>‹ The Bench</Text>
          </Pressable>
          <ScreenHeader label="The Bench" title="Reports" />
          {!allowed ? (
            <Text variant="muted">Only moderators can review reports.</Text>
          ) : (
            <>
              {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
              {reports === null && !error ? <Text variant="muted">Loading the reports…</Text> : null}
              {reports?.length === 0 ? (
                <Surface>
                  <View style={{ padding: space.lg, gap: space.xs }}>
                    <Text variant="heading">Nothing to review</Text>
                    <Text variant="muted">New reports show here. Resolving one with a note, and the closed ones, are on the web.</Text>
                  </View>
                </Surface>
              ) : null}
              {reports?.map((r) => (
                <Surface key={r.id}>
                  <View style={{ padding: space.lg, gap: space.sm }}>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: space.sm }}>
                      <Text variant="label">{BENCH_REPORT_REASON_LABELS[r.reason]}</Text>
                      <Text variant="meta">{timeAgo(r.createdAt, Date.now())}</Text>
                    </View>
                    <Text variant="heading">{r.messageBody !== null ? `${r.reportedUserName}'s message` : r.reportedUserName}</Text>
                    <Text variant="meta">{r.messageBody === null ? "A person" : (r.channelName ?? "Direct message")}</Text>
                    {r.messageBody !== null ? <Text>{`“${r.messageBody}”${r.messageGone ? " (no longer shown)" : ""}`}</Text> : null}
                    {r.note ? <Text variant="muted">{`Note: ${r.note}`}</Text> : null}
                    <Text variant="meta">{`Reported by ${r.reporterName}`}</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
                      {r.messageBody !== null && !r.messageGone ? <Button kind="danger" label="Hide message" disabled={busy !== null} onPress={() => confirmHide(r)} /> : null}
                      <Button kind="ghost" label="Dismiss" disabled={busy !== null} onPress={() => void act(r, "dismiss")} />
                    </View>
                  </View>
                </Surface>
              ))}
            </>
          )}
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}

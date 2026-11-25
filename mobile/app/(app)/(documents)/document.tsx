import { useCallback, useState } from "react";
import { Alert, Image, Linking, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { formatAuDate } from "@culinaire/shared";
import { useSession } from "../../../src/runtime/appContext";
import { ApiError } from "../../../src/api/client";
import { writeMessage } from "../../../src/api/onlineWrite";
import { useDocuments } from "../../../src/compliance/DocumentsProvider";
import { canChange, canNudge, expiryLine, statusLabel } from "../../../src/compliance/documentView";
import { EmptyCard } from "../../../src/orders/ListState";
import { venueToday } from "../../../src/roster/shiftView";
import { Button } from "../../../src/ui/Button";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { SectionLabel } from "../../../src/ui/SectionLabel";
import { ServerPage } from "../../../src/ui/ServerPage";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { Text } from "../../../src/ui/Text";
import { space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** One of my certificates: its state, what it says, its file, and what I may still do with it. */
export default function DocumentScreen() {
  const { state } = useSession();
  const { store, snap } = useDocuments();
  const router = useRouter();
  const c = useColors();
  const params = useLocalSearchParams<{ id: string; from?: string }>();
  const [busy, setBusy] = useState<"file" | "delete" | "nudge" | null>(null);
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  const [nudged, setNudged] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  useFocusEffect(useCallback(() => void store.refresh(), [store]));
  if (state.phase !== "ready") return null;

  const now = Date.now();
  const today = venueToday(state.location.ianaTimezone, now);
  const d = snap.docs.find((x) => x.complianceDocumentId === params.id);
  const back = () => (params.from === "link" ? router.dismissTo("/(app)/(documents)") : router.back());
  const off = { title: "Documents aren't in use here", text: "Your kitchen hasn't switched compliance documents on. Ask your manager." };

  if (!d) {
    return (
      <ServerPage header={<ScreenHeader label="My documents" title="Document" />} snap={snap} loading="Loading the document…" off={off} refresh={store.refresh}>
        {snap.phase === "ready" ? <EmptyCard title="Not one of your documents" text="It may have been deleted. A colleague's documents are on the web, for the people who check them." /> : null}
        <Button kind="quiet" label="Back to my documents" onPress={back} />
      </ServerPage>
    );
  }

  const facts = [
    { label: "Status", value: statusLabel(d, today) },
    { label: "Expiry", value: expiryLine(d, today) },
    { label: "Issued", value: d.issueDate ? formatAuDate(d.issueDate.slice(0, 10)) : "—" },
    { label: "Certificate number", value: d.documentNumber ?? "—" },
    { label: "Issuing state", value: d.issuingJurisdiction ?? "—" },
  ];

  async function run(name: "file" | "delete" | "nudge", doing: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    setNotice(null);
    try {
      await work();
    } catch (err) {
      setNotice({ text: writeMessage(err, doing), bad: true });
    } finally {
      setBusy(null);
    }
  }

  const isPhoto = d.storageFormat === "jpg" || d.storageFormat === "png";
  const openFile = () =>
    run("file", "Opening the file", async () => {
      const url = await store.viewUrl(d.complianceDocumentId);
      if (isPhoto) return setImage(await store.readImage(url));
      await Linking.openURL(url).catch(() => {
        throw new ApiError("bad_request", "No app on this phone can open the file. See it on the web.");
      });
    });
  const remove = () =>
    Alert.alert(`Delete this ${d.documentType}?`, "This can't be undone.", [
      { text: "Keep it", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void run("delete", "Deleting", async () => { await store.remove(d.complianceDocumentId); back(); }) },
    ]);
  const nudge = () => run("nudge", "Sending a reminder", async () => { await store.nudge(d.complianceDocumentId); setNudged(true); });

  return (
    <ServerPage header={<ScreenHeader label="My documents" title={d.documentType} />} snap={snap} loading="" off={off} refresh={store.refresh}>
      {d.verificationStatus === "Rejected" && d.rejectionReason ? (
        <Surface>
          <View style={{ padding: space.lg, gap: space.xs }}>
            <Text variant="heading">What to fix</Text>
            <Text>{d.rejectionReason}</Text>
            <Text variant="muted">Correct the details and it goes back to your manager. If the photo is wrong, delete this and add it again.</Text>
          </View>
        </Surface>
      ) : null}
      <Surface>
        {facts.map((f, i) => (
          <View key={f.label} accessible accessibilityLabel={`${f.label}: ${f.value}`} style={[{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.xs }, rowDivider(i, c.border)]}>
            <SectionLabel>{f.label}</SectionLabel>
            <Text>{f.value}</Text>
          </View>
        ))}
      </Surface>
      {d.verificationStatus === "Pending" && d.uploadedAt ? <Text variant="meta">{`With your manager since ${formatAuDate(venueToday(state.location.ianaTimezone, Date.parse(d.uploadedAt)))}.`}</Text> : null}

      {image ? (
        <Image source={{ uri: image }} accessibilityLabel={`Photo of your ${d.documentType}`} resizeMode="contain" style={{ width: "100%", height: 420, borderRadius: 16, backgroundColor: c.field }} />
      ) : (
        <Button kind="ghost" label={busy === "file" ? "Opening…" : isPhoto ? "Show the photo" : "Open the file in your browser"} disabled={busy !== null} onPress={() => void openFile()} />
      )}
      {notice ? (
        <Text variant={notice.bad ? "error" : "body"} accessibilityLiveRegion="polite">
          {notice.text}
        </Text>
      ) : null}
      {nudged ? <Text accessibilityLiveRegion="polite">Reminder sent.</Text> : canNudge(d, now) ? <Button kind="ghost" label={busy === "nudge" ? "Sending…" : "Remind your manager"} disabled={busy !== null} onPress={() => void nudge()} /> : null}
      {canChange(d) ? (
        <>
          <Button kind={d.verificationStatus === "Rejected" ? "primary" : "ghost"} label={d.verificationStatus === "Rejected" ? "Correct the details" : "Change the details"} disabled={busy !== null} onPress={() => router.push({ pathname: "/document-edit", params: { id: d.complianceDocumentId } })} />
          <Button kind="danger" label={busy === "delete" ? "Deleting…" : "Delete"} disabled={busy !== null} onPress={remove} />
        </>
      ) : null}
      <Button kind="quiet" label="Back" onPress={back} />
    </ServerPage>
  );
}

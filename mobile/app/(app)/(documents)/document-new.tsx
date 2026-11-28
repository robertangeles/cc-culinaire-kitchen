import { useRef, useState } from "react";
import { Linking, View } from "react-native";
import { useRouter } from "expo-router";
import { ENGAGEMENT_TYPES, type UploadReply } from "@culinaire/shared/schemas/compliance";
import { writeMessage } from "../../../src/api/onlineWrite";
import { CertificateFields } from "../../../src/compliance/CertificateFields";
import { useDocuments } from "../../../src/compliance/DocumentsProvider";
import { CAMERA_DENIED, OTHER, TOO_BIG, TYPES, UNSUPPORTED, readFields, readType, uploadMessage, type FieldsForm } from "../../../src/compliance/documentView";
import type { Photo } from "../../../src/api/photo";
import { pickDocument } from "../../../src/compliance/pickDocument";
import { Button } from "../../../src/ui/Button";
import { ChoiceChips } from "../../../src/ui/ChoiceChips";
import { Screen } from "../../../src/ui/Screen";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { SectionLabel } from "../../../src/ui/SectionLabel";
import { Surface } from "../../../src/ui/Surface";
import { Text } from "../../../src/ui/Text";
import { TextField } from "../../../src/ui/TextField";
import { typedDate } from "../../../src/ui/typedDate";
import { space } from "../../../src/theme";

const PICK_FAILED = { denied: CAMERA_DENIED, unsupported: UNSUPPORTED, tooBig: TOO_BIG };
const WORKING_AS = ENGAGEMENT_TYPES.map((t) => t.label);

/**
 * Add a certificate: what it is, its photo, then what the server could read off it to check. The photo goes to the server as soon as it is
 * taken (that is how it is read); the record is made by Send for review. Online only: the photo is held in memory while the form is open, never as a file.
 */
export default function DocumentNew() {
  const { store } = useDocuments();
  const router = useRouter();
  const [picked, setPicked] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const [workingAs, setWorkingAs] = useState<string>(WORKING_AS[0]);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [uploaded, setUploaded] = useState<UploadReply | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<{ text: string; settings?: true } | null>(null);
  const [form, setForm] = useState<FieldsForm>({ documentNumber: "", issued: "", expires: "", state: null });
  const [read, setRead] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  // A ref, not the state: two taps in one frame both see the state as it was.
  const busy = useRef(false);

  const type = readType(picked, other);

  async function upload(image: Photo) {
    setUploading(true);
    setPhotoError(null);
    try {
      const reply = await store.upload(image);
      setUploaded(reply);
      const found = { documentNumber: reply.ocr.documentNumber, issueDate: typedDate(reply.ocr.issueDate), expiryDate: typedDate(reply.ocr.expiryDate) };
      setForm((f) => ({ ...f, documentNumber: found.documentNumber || f.documentNumber, issued: found.issueDate || f.issued, expires: found.expiryDate || f.expires }));
      setRead(new Set(Object.entries(found).filter(([, v]) => v).map(([k]) => k)));
    } catch (err) {
      setPhotoError({ text: uploadMessage(err) });
    } finally {
      // Released with the buttons: a tap right after they enable must not be dropped while choose() is still unwinding.
      busy.current = false;
      setUploading(false);
    }
  }

  async function choose(from: "camera" | "library") {
    if (busy.current) return;
    busy.current = true;
    try {
      const result = await pickDocument(from).catch(() => ({ kind: "cancelled" as const }));
      if (result.kind === "cancelled") return;
      if (result.kind !== "picked") return setPhotoError({ text: PICK_FAILED[result.kind], settings: result.kind === "denied" ? true : undefined });
      setPhoto(result.photo);
      setUploaded(null);
      setRead(new Set());
      await upload(result.photo);
    } finally {
      busy.current = false;
    }
  }

  async function send() {
    if (busy.current || !uploaded || !("type" in type)) return;
    const fields = readFields(form);
    if ("error" in fields) return setError(fields.error);
    busy.current = true;
    setSending(true);
    setError(null);
    try {
      await store.send({ documentType: type.type, engagementType: ENGAGEMENT_TYPES.find((t) => t.label === workingAs)!.value, ...fields.fields, storagePublicId: uploaded.storagePublicId, storageFormat: uploaded.storageFormat });
      setDone(true);
    } catch (err) {
      setError(writeMessage(err, "Sending"));
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  if (done) {
    return (
      <Screen align="top">
        <ScreenHeader label="My documents" title="Sent for review" />
        <Text>Your manager will check it against the photo. You'll see the result in My documents.</Text>
        <Button label="Back to my documents" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen align="top">
      <ScreenHeader label="My documents" title="Add a certificate" />
      <ChoiceChips label="What is it?" options={TYPES} value={picked as (typeof TYPES)[number] | null} onChange={setPicked} />
      {picked === OTHER ? <TextField label="Name of the document" value={other} onChangeText={setOther} maxLength={40} /> : null}
      {"error" in type && type.error ? <Text variant="error">{type.error}</Text> : null}
      <ChoiceChips label="I'm working here as" options={WORKING_AS} value={workingAs} onChange={(v) => v && setWorkingAs(v)} />

      <View style={{ gap: space.sm }}>
        <SectionLabel>Photo</SectionLabel>
        <Surface>
          <View style={{ padding: space.lg, gap: space.md }}>
            <Text variant="muted">The whole certificate, flat and sharp. The camera is used only for this photo, and only you and the people who check documents can see it.</Text>
            {uploading ? <Text accessibilityLiveRegion="polite">Sending the photo and reading it…</Text> : null}
            {uploaded ? <Text accessibilityLiveRegion="polite">✓ Photo added</Text> : null}
            {photoError ? (
              <Text variant="error" accessibilityLiveRegion="polite">
                {photoError.text}
              </Text>
            ) : null}
            {photoError?.settings ? <Button kind="quiet" label="Open settings" onPress={() => void Linking.openSettings().catch(() => undefined)} /> : null}
            {photo && !uploaded && !uploading ? <Button label="Send the photo again" onPress={() => void upload(photo)} /> : null}
            <Button kind="ghost" label={uploaded ? "Take it again" : "Take a photo"} disabled={uploading || sending} onPress={() => void choose("camera")} />
            <Button kind="ghost" label={uploaded ? "Choose another photo" : "Choose a photo"} disabled={uploading || sending} onPress={() => void choose("library")} />
            <Text variant="meta">JPEG or PNG, up to 10 MB. A PDF can be added on the web.</Text>
          </View>
        </Surface>
      </View>

      <CertificateFields form={form} onChange={(next) => (setForm((f) => ({ ...f, ...next })), setError(null))} read={read} />
      {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
      {!("type" in type) || !uploaded ? <Text variant="meta">{!("type" in type) ? "Choose what it is to send it." : "Add a photo to send it."}</Text> : null}
      <Button label={sending ? "Sending…" : "Send for review"} disabled={sending || uploading || !uploaded || !("type" in type)} onPress={() => void send()} />
      <Button kind="quiet" label="Cancel" onPress={() => router.back()} />
    </Screen>
  );
}

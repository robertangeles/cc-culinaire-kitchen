import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { writeMessage } from "../../../src/api/onlineWrite";
import { CertificateFields } from "../../../src/compliance/CertificateFields";
import { useDocuments } from "../../../src/compliance/DocumentsProvider";
import { canChange, readFields, type FieldsForm } from "../../../src/compliance/documentView";
import { EmptyCard } from "../../../src/orders/ListState";
import { Button } from "../../../src/ui/Button";
import { Screen } from "../../../src/ui/Screen";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { Text } from "../../../src/ui/Text";
import { typedDate } from "../../../src/ui/typedDate";

/** Correct a certificate's details while no manager has signed it off. One that was not accepted goes back to the manager. */
export default function DocumentEdit() {
  const { store, snap } = useDocuments();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const doc = snap.docs.find((d) => d.complianceDocumentId === id);
  const [form, setForm] = useState<FieldsForm>(() => ({ documentNumber: doc?.documentNumber ?? "", issued: typedDate(doc?.issueDate), expires: typedDate(doc?.expiryDate), state: doc?.issuingJurisdiction ?? null }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const read = readFields(form);
    if ("error" in read) return setError(read.error);
    setSaving(true);
    setError(null);
    try {
      await store.update(id, read.fields);
      router.back();
    } catch (err) {
      setError(writeMessage(err, "Saving"));
      setSaving(false);
    }
  }

  return (
    <Screen align="top">
      <ScreenHeader label="My documents" title={doc?.documentType ?? "Document"} />
      {doc && canChange(doc) ? (
        <>
          <CertificateFields form={form} onChange={(next) => (setForm((f) => ({ ...f, ...next })), setError(null))} />
          {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
          <Button label={saving ? "Saving…" : doc.verificationStatus === "Rejected" ? "Send for review again" : "Save"} disabled={saving} onPress={() => void save()} />
        </>
      ) : (
        <EmptyCard title="This can't be changed" text="It was checked by your manager or deleted. Open it again from My documents." />
      )}
      <Button kind="quiet" label="Cancel" onPress={() => router.back()} />
    </Screen>
  );
}

import { View } from "react-native";
import { formatAuDate } from "@culinaire/shared";
import { AU_STATES } from "@culinaire/shared/schemas/compliance";
import { ChoiceChips } from "../ui/ChoiceChips";
import { Text } from "../ui/Text";
import { TextField } from "../ui/TextField";
import { maskDate, parseTypedDate } from "../ui/typedDate";
import { space } from "../theme";
import { NO_STATE, type FieldsForm } from "./documentView";

/** Number, dates and issuing state, on the add and change forms. `read` names the fields the server read off the photo; every one can be corrected. */
export function CertificateFields({ form, onChange, read }: { form: FieldsForm; onChange: (next: Partial<FieldsForm>) => void; read?: ReadonlySet<string> }) {
  const note = (key: string) => (read?.has(key) ? <Text variant="meta">Read from the photo. Check it.</Text> : null);
  // A date in words under its field: 08/07 read the wrong way round is four weeks out.
  const words = (typed: string) => {
    const iso = parseTypedDate(typed);
    return iso ? <Text variant="meta">{formatAuDate(iso)}</Text> : null;
  };
  return (
    <>
      <View style={{ gap: space.xs }}>
        <TextField label="Certificate number" value={form.documentNumber} onChangeText={(documentNumber) => onChange({ documentNumber })} maxLength={100} autoCapitalize="characters" autoCorrect={false} />
        {note("documentNumber")}
      </View>
      <View style={{ gap: space.xs }}>
        <TextField label="Issued" value={form.issued} onChangeText={(t) => onChange({ issued: maskDate(t) })} keyboardType="number-pad" placeholder="DD/MM/YYYY" maxLength={10} />
        {words(form.issued)}
        {note("issueDate")}
      </View>
      <View style={{ gap: space.xs }}>
        <TextField label="Expires" value={form.expires} onChangeText={(t) => onChange({ expires: maskDate(t) })} keyboardType="number-pad" placeholder="DD/MM/YYYY" maxLength={10} />
        {words(form.expires)}
        {note("expiryDate")}
      </View>
      <ChoiceChips label="Issuing state" options={[NO_STATE, ...AU_STATES]} value={form.state ?? NO_STATE} onChange={(state) => onChange({ state: state === NO_STATE ? null : state })} />
    </>
  );
}

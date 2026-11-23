import { useState } from "react";
import { session, useSession } from "../src/runtime/appContext";
import { Brand } from "../src/ui/Brand";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { TextField } from "../src/ui/TextField";
import { Button } from "../src/ui/Button";

/** A signed-in person with no location yet: join the organisation by its key, then a location by its key. Both keys come from the manager. */
export default function FirstRun() {
  const { state, busy } = useSession();
  const [key, setKey] = useState("");
  if (state.phase !== "firstRun") return null;
  const needsOrganisation = state.organisationId === null;
  const submit = () => void (needsOrganisation ? session.joinOrganisation(key) : session.joinLocation(key));
  const canSubmit = key.trim().length > 0 && !busy;

  return (
    <Screen>
      <Brand size={140} />
      <Text variant="title">{needsOrganisation ? "Join your kitchen" : "Join your location"}</Text>
      <Text variant="muted">
        {needsOrganisation
          ? "Ask your manager for your organisation's join key, then enter it here."
          : "You're in the organisation. Now enter your location's key; your manager has it. If you run this organisation and have not added a location yet, do that on the web first."}
      </Text>
      <TextField
        key={needsOrganisation ? "organisation" : "location"}
        label={needsOrganisation ? "Join key" : "Location key"}
        value={key}
        onChangeText={(v) => setKey(v)}
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="go"
        onSubmitEditing={() => canSubmit && submit()}
      />
      {state.error ? (
        <Text variant="error" accessibilityLiveRegion="polite">
          {state.error}
        </Text>
      ) : null}
      <Button label={busy ? "Joining…" : "Join"} disabled={!canSubmit} onPress={submit} />
      <Button kind="quiet" label="Sign out" onPress={() => void session.signOut()} />
    </Screen>
  );
}

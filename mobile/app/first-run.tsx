import { useState } from "react";
import { session, useSession } from "../src/runtime/appContext";
import { Brand } from "../src/ui/Brand";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { TextField } from "../src/ui/TextField";
import { Button } from "../src/ui/Button";
import { Surface } from "../src/ui/Surface";
import { LegalLinks } from "../src/ui/LegalLinks";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { fontFamily, space } from "../src/theme";

/** A signed-in person with no location yet: join the organisation by its key, then a location by its key. Both keys come from the manager. */
export default function FirstRun() {
  const { state } = useSession();
  if (state.phase !== "firstRun") return null;
  const needsOrganisation = state.organisationId === null;
  return <JoinStep key={needsOrganisation ? "organisation" : "location"} needsOrganisation={needsOrganisation} error={state.error} email={state.user.userEmail} />;
}

/** The web's "Run the Kitchen" screen for someone with no location: a key to enter, and what to do without one. Never empty tabs. */
function JoinStep({ needsOrganisation, error, email }: { needsOrganisation: boolean; error?: string; email: string }) {
  const { busy } = useSession();
  const router = useRouter();
  const [key, setKey] = useState("");
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
        label={needsOrganisation ? "Join key" : "Location key"}
        value={key}
        onChangeText={(v) => setKey(v)}
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="go"
        onSubmitEditing={() => canSubmit && submit()}
      />
      {error ? (
        <Text variant="error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button label={busy ? "Joining…" : "Join"} disabled={!canSubmit} onPress={submit} />
      <Surface>
        <View style={{ padding: space.lg, gap: space.xs }}>
          <Text style={{ fontFamily: fontFamily.title, fontSize: 18 }}>No key?</Text>
          <Text variant="muted">
            {needsOrganisation
              ? "Your manager can also invite you from the organisation's settings on the web."
              : "Your organisation's admin can add you to a location directly from the organisation's settings on the web. No key needed."}
          </Text>
        </View>
      </Surface>
      {email ? <Text variant="meta">Signed in as {email}</Text> : null}
      <Button kind="quiet" label="Sign out" onPress={() => void session.signOut()} />
      <LegalLinks />
      <Button kind="danger" label="Delete my account" onPress={() => router.push("/delete-account")} />
    </Screen>
  );
}

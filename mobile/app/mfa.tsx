import { useState } from "react";
import { session, useSession } from "../src/runtime/appContext";
import { Brand } from "../src/ui/Brand";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { TextField } from "../src/ui/TextField";
import { Button } from "../src/ui/Button";

export default function Mfa() {
  const { state, busy } = useSession();
  const [code, setCode] = useState("");
  const error = state.phase === "mfa" ? state.error : undefined;
  const canSubmit = code.length === 6 && !busy;

  return (
    <Screen>
      <Brand size={140} />
      <Text variant="title">Enter your 6-digit code</Text>
      <Text variant="muted">Open your authenticator app and type the code for CulinAIre Kitchen.</Text>
      <TextField label="Code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} returnKeyType="go" onSubmitEditing={() => canSubmit && void session.submitCode(code)} />
      {error ? (
        <Text variant="error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button label={busy ? "Checking…" : "Verify"} disabled={!canSubmit} onPress={() => void session.submitCode(code)} />
      <Button kind="quiet" label="Use a different account" onPress={() => void session.signOut()} />
    </Screen>
  );
}

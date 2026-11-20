import { useState } from "react";
import { useRouter } from "expo-router";
import { authApi } from "../src/runtime/appContext";
import { Brand } from "../src/ui/Brand";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { TextField } from "../src/ui/TextField";
import { Button } from "../src/ui/Button";

export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const canSubmit = email.trim().length > 0 && !busy;

  async function send() {
    setBusy(true);
    setError(undefined);
    try {
      await authApi.forgotPassword(email.trim());
      router.push({ pathname: "/check-email", params: { kind: "reset", email: email.trim() } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the email. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Brand size={140} />
      <Text variant="title">Reset your password</Text>
      <Text variant="muted">Enter your email and we'll send you a link to choose a new one.</Text>
      <TextField label="Email" placeholder="chef@kitchen.co" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" autoCorrect={false} keyboardType="email-address" textContentType="username" returnKeyType="go" onSubmitEditing={() => canSubmit && void send()} />
      {error ? (
        <Text variant="error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button label={busy ? "Sending…" : "Send reset link"} disabled={!canSubmit} onPress={() => void send()} />
      <Button kind="quiet" label="Back to sign in" onPress={() => router.back()} />
    </Screen>
  );
}

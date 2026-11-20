import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { authApi } from "../src/runtime/appContext";
import { Brand } from "../src/ui/Brand";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { Button } from "../src/ui/Button";

/** Where registration and password reset end on the phone: the link in the email opens in the browser, then the person signs in here. */
export default function CheckEmail() {
  const router = useRouter();
  const { kind, email = "" } = useLocalSearchParams<{ kind?: string; email?: string }>();
  const verifying = kind === "verify";
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; isError: boolean }>();

  async function resend() {
    setBusy(true);
    setNote(undefined);
    try {
      await authApi.resendVerification(email);
      setNote({ text: "Sent again.", isError: false });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : "Couldn't send it again. Try again.", isError: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Brand size={140} />
      <Text variant="title">Check your email</Text>
      {verifying ? (
        <Text variant="muted">We sent a link to {email}. Open it to verify your account, then come back here and sign in.</Text>
      ) : (
        <Text variant="muted">If there is an account for {email}, we sent a link to reset your password. Open it, choose a new password, then come back here and sign in.</Text>
      )}
      {note ? (
        <Text variant={note.isError ? "error" : "muted"} accessibilityLiveRegion="polite">
          {note.text}
        </Text>
      ) : null}
      {verifying ? <Button kind="quiet" label="Send it again" disabled={busy} onPress={() => void resend()} /> : null}
      <Button label="Back to sign in" onPress={() => router.replace("/sign-in")} />
    </Screen>
  );
}

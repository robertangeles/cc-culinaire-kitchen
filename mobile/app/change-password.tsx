import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { accountApi } from "../src/runtime/appContext";
import { passwordChangeMessage, type AccountFacts } from "../src/api/account";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { TextField } from "../src/ui/TextField";
import { Button } from "../src/ui/Button";

/** The server's minimum (`ChangePasswordSchema`), checked here first so the person is told before sending. */
const MIN_LENGTH = 8;

/** Change password (the web's Profile > Security). This phone stays signed in; every other sign-in ends. */
export default function ChangePassword() {
  const router = useRouter();
  const [facts, setFacts] = useState<AccountFacts | "failed" | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    void accountApi.facts().then(setFacts, () => setFacts("failed"));
  }, [attempt]);

  if (facts === null) return <Screen><Text variant="muted">Loading…</Text></Screen>;
  if (facts === "failed" || !facts.hasPassword || done) {
    return (
      <Screen>
        <Text variant="title">Password</Text>
        {facts === "failed" ? <Text variant="error">Couldn't load your account. Check your signal and try again.</Text> : null}
        {facts !== "failed" && !facts.hasPassword ? <Text>Your account signs in with Google or Apple, so it has no password to change.</Text> : null}
        {done ? <Text>Password changed. You're still signed in here; your other devices will need to sign in again.</Text> : null}
        {facts === "failed" ? <Button kind="ghost" label="Try again" onPress={() => (setFacts(null), setAttempt((a) => a + 1))} /> : null}
        <Button kind="quiet" label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await accountApi.changePassword(current, next);
      setDone(true);
    } catch (err) {
      setError(passwordChangeMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const toggle = <Button kind="quiet" label={show ? "HIDE" : "SHOW"} onPress={() => setShow(!show)} />;

  return (
    <Screen>
      <Text variant="title">Change password</Text>
      <TextField label="Current password" value={current} onChangeText={setCurrent} secureTextEntry={!show} autoComplete="current-password" textContentType="password" autoCapitalize="none" trailing={toggle} />
      <TextField label="New password" value={next} onChangeText={setNext} secureTextEntry={!show} autoComplete="new-password" textContentType="newPassword" autoCapitalize="none" />
      <Text variant={tooShort ? "error" : "muted"}>At least {MIN_LENGTH} characters.</Text>
      {error ? (
        <Text variant="error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button label={busy ? "Changing…" : "Change password"} disabled={busy || !current || next.length < MIN_LENGTH} onPress={() => void submit()} />
      <Button kind="quiet" label="Cancel" onPress={() => router.back()} />
    </Screen>
  );
}

import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { accountApi, appleCredential, authApi, session } from "../src/runtime/appContext";
import { linkAppleMessage, type LinkFailure } from "../src/api/auth";
import type { AccountFacts } from "../src/api/account";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { TextField } from "../src/ui/TextField";
import { Button } from "../src/ui/Button";

/**
 * Adds Sign in with Apple to the signed-in account (iPhone and iPad only; the account screen offers it nowhere else). The same proof as the web
 * asks to change two-factor settings: the password, and an authenticator code when MFA is on. The server decides what is allowed.
 * Joining the Apple ID by its stable id is what keeps a person who registered by email and hides their email with Apple to one account.
 */
export default function LinkApple() {
  const router = useRouter();
  const [facts, setFacts] = useState<AccountFacts | "failed" | null>(null);
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [serverWantsMfa, setServerWantsMfa] = useState(false);
  const [failure, setFailure] = useState<LinkFailure>();
  const [busy, setBusy] = useState(false);
  const [linked, setLinked] = useState(false);

  useEffect(() => {
    void accountApi.facts().then(setFacts, () => setFacts("failed"));
  }, []);

  if (facts === null) return <Screen><Text variant="muted">Loading…</Text></Screen>;
  if (facts === "failed") {
    return (
      <Screen>
        <Text variant="title">Add Sign in with Apple</Text>
        <Text variant="error">Couldn't load your account. Try again.</Text>
        <Button kind="quiet" label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }
  if (facts.hasApple || linked) {
    return (
      <Screen>
        <Text variant="title">Add Sign in with Apple</Text>
        <Text>{linked ? "Sign in with Apple is now on your account." : "Sign in with Apple is already on your account."}</Text>
        <Text variant="muted">Next time you can sign in with Apple. It opens this same account, whatever email Apple shows.</Text>
        <Button label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  const account = facts;
  const asksMfa = facts.mfaEnabled || serverWantsMfa;
  const canSubmit = !busy && (!facts.hasPassword || password.length > 0) && (!asksMfa || mfaCode.trim().length > 0);

  async function link() {
    setBusy(true);
    setFailure(undefined);
    try {
      let credential;
      try {
        credential = await appleCredential();
      } catch {
        setFailure({ text: "Apple sign-in didn't work. Try again." });
        return;
      }
      if (credential === null) return; // closed the sheet: nothing changed, nothing to say
      await authApi.linkApple(credential, { ...(account.hasPassword ? { password } : {}), ...(asksMfa ? { mfaCode: mfaCode.trim() } : {}) });
      setLinked(true);
    } catch (err) {
      const next = linkAppleMessage(err);
      if (next.needsMfa) setServerWantsMfa(true);
      setFailure(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text variant="title">Add Sign in with Apple</Text>
      <Text variant="muted">
        Sign in to this account with your Apple ID as well. If you choose Hide My Email, Apple shows us a private address instead of yours: that is fine. It joins this account, not a second one.
      </Text>
      {facts.hasPassword ? (
        <TextField label="Your password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" returnKeyType="go" />
      ) : null}
      {asksMfa ? <TextField label="Authenticator code" value={mfaCode} onChangeText={setMfaCode} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" /> : null}
      {failure ? (
        <Text variant="error" accessibilityLiveRegion="polite">
          {failure.text}
        </Text>
      ) : null}
      {failure?.needsFreshSignIn ? <Button kind="ghost" label="Sign out" onPress={() => void session.signOut()} /> : null}
      <Button label={busy ? "Adding…" : "Add Sign in with Apple"} disabled={!canSubmit} onPress={() => void link()} />
      <Button kind="quiet" label="Cancel" disabled={busy} onPress={() => router.back()} />
    </Screen>
  );
}

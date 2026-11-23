import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { accountApi, session } from "../src/runtime/appContext";
import { deleteAccountMessage, type AccountFacts, type DeleteFailure } from "../src/api/account";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { TextField } from "../src/ui/TextField";
import { Button } from "../src/ui/Button";

/**
 * Self-service account deletion (App Store 5.1.1(v), Google Play). The same proof the web asks for: the password, or the email typed
 * back for an account with no password, and an authenticator code when MFA is on. The server decides what is allowed.
 */
export default function DeleteAccount() {
  const router = useRouter();
  const [facts, setFacts] = useState<AccountFacts | "failed" | null>(null);
  const [password, setPassword] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [serverWantsMfa, setServerWantsMfa] = useState(false);
  const [failure, setFailure] = useState<DeleteFailure>();
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    void accountApi.facts().then(setFacts, () => setFacts("failed"));
  }, []);

  if (facts === null) return <Screen><Text variant="muted">Loading…</Text></Screen>;
  if (facts === "failed") {
    return (
      <Screen>
        <Text variant="title">Delete your account</Text>
        <Text variant="error">Couldn't load your account. Try again.</Text>
        <Button kind="quiet" label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  const asksMfa = facts.mfaEnabled || serverWantsMfa;
  const canSubmit = !deleting && (facts.hasPassword ? password.length > 0 : confirmEmail.trim().length > 0) && (!asksMfa || mfaCode.trim().length > 0);

  async function remove() {
    if (typeof facts === "string" || facts === null) return;
    setDeleting(true);
    setFailure(undefined);
    try {
      await accountApi.deleteAccount({ ...(facts.hasPassword ? { password } : { confirmEmail: confirmEmail.trim() }), ...(asksMfa ? { mfaCode: mfaCode.trim() } : {}) });
    } catch (err) {
      const next = deleteAccountMessage(err, facts.hasPassword);
      if (next.needsMfa) setServerWantsMfa(true);
      setFailure(next);
      setDeleting(false);
      return;
    }
    // Gone on the server. The session clears the phone and swaps this screen for the result.
    await session.accountDeleted();
  }

  return (
    <Screen>
      <Text variant="title">Delete your account?</Text>
      <Text variant="muted">
        This cannot be undone. Your name and email are removed and you are signed out straight away. Your chats, saved recipes and preferences are deleted, and any paid plan you have on the web is cancelled. Anything saved on this phone and not yet sent is erased too.
        Business records such as orders and stock history stay, with no name attached.
      </Text>
      {facts.hasPassword ? (
        <TextField label="Your password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" returnKeyType="go" />
      ) : (
        <TextField label="Your email" placeholder={facts.email} value={confirmEmail} onChangeText={setConfirmEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="off" returnKeyType="go" />
      )}
      {!facts.hasPassword ? <Text variant="meta">Type your email address ({facts.email}) to confirm.</Text> : null}
      {asksMfa ? <TextField label="Authenticator code" value={mfaCode} onChangeText={setMfaCode} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" /> : null}
      {failure ? (
        <Text variant="error" accessibilityLiveRegion="polite">
          {failure.text}
        </Text>
      ) : null}
      {failure?.needsFreshSignIn ? <Button kind="ghost" label="Sign out" onPress={() => void session.signOut()} /> : null}
      <Button kind="danger" label={deleting ? "Deleting…" : "Delete my account"} disabled={!canSubmit} onPress={() => void remove()} />
      <Button kind="quiet" label="Cancel" disabled={deleting} onPress={() => router.back()} />
    </Screen>
  );
}

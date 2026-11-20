import { useState } from "react";
import { session, useSession } from "../src/app/appContext";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { TextField } from "../src/ui/TextField";
import { Button } from "../src/ui/Button";

export default function SignIn() {
  const { state, busy } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const error = state.phase === "signedOut" ? state.error : undefined;
  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  return (
    <Screen>
      <Text variant="title">CulinAIre Kitchen</Text>
      <Text variant="muted">Count stock and receive deliveries.</Text>
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" autoCorrect={false} keyboardType="email-address" textContentType="username" returnKeyType="next" />
      <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={() => canSubmit && void session.signIn(email.trim(), password)} />
      {error ? (
        <Text variant="error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button label={busy ? "Signing in…" : "Sign in"} disabled={!canSubmit} onPress={() => void session.signIn(email.trim(), password)} />
    </Screen>
  );
}

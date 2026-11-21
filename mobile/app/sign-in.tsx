import { useState } from "react";
import { Pressable } from "react-native";
import { session, useSession } from "../src/runtime/appContext";
import { Brand } from "../src/ui/Brand";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { TextField } from "../src/ui/TextField";
import { Button } from "../src/ui/Button";

export default function SignIn() {
  const { state, busy } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const error = state.phase === "signedOut" ? state.error : undefined;
  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  return (
    <Screen>
      <Brand />
      <Text style={{ fontFamily: "Fraunces_400Regular", textAlign: "center" }}>Welcome back to the line.</Text>
      <TextField label="Email" placeholder="chef@kitchen.co" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" autoCorrect={false} keyboardType="email-address" textContentType="username" returnKeyType="next" />
      <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoCorrect={false} spellCheck={false} keyboardType={showPassword ? "visible-password" : "default"} trailing={<Pressable accessibilityRole="button" accessibilityLabel={showPassword ? "Hide password" : "Show password"} hitSlop={8} onPress={() => setShowPassword((v) => !v)}><Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, letterSpacing: 1.4, textTransform: "uppercase", color: "#696D74" }} accessibilityElementsHidden>{showPassword ? "Hide" : "Show"}</Text></Pressable>} autoCapitalize="none" autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={() => canSubmit && void session.signIn(email.trim(), password)} />
      {error ? (
        <Text variant="error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button label={busy ? "Signing in…" : "Sign in"} disabled={!canSubmit} onPress={() => void session.signIn(email.trim(), password)} />
    </Screen>
  );
}

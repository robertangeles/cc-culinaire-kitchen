import { useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { authApi, googleEnabled, session, useSession } from "../src/runtime/appContext";
import { Brand } from "../src/ui/Brand";
import { GoogleMark } from "../src/ui/GoogleMark";
import { Screen } from "../src/ui/Screen";
import { Segmented } from "../src/ui/Segmented";
import { Text } from "../src/ui/Text";
import { TextField } from "../src/ui/TextField";
import { Button } from "../src/ui/Button";
import { useColors } from "../src/ui/theme";

type Mode = "signin" | "register";

export default function SignIn() {
  const router = useRouter();
  const c = useColors();
  const { state, busy: signingIn } = useSession();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string>();
  const register = mode === "register";
  const busy = register ? registering : signingIn;
  const error = register ? registerError : state.phase === "signedOut" ? state.error : undefined;
  const canSubmit = email.trim().length > 0 && password.length > 0 && (!register || name.trim().length > 0) && !busy;

  async function createAccount() {
    setRegistering(true);
    setRegisterError(undefined);
    try {
      await authApi.register(name.trim(), email.trim(), password);
      router.push({ pathname: "/check-email", params: { kind: "verify", email: email.trim() } });
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : "Couldn't create the account. Try again.");
    } finally {
      setRegistering(false);
    }
  }

  const submit = () => (register ? void createAccount() : void session.signIn(email.trim(), password));

  return (
    <Screen>
      <Brand />
      <Text style={{ fontFamily: "Fraunces_400Regular", textAlign: "center" }}>{register ? "Join the line." : "Welcome back to the line."}</Text>
      <Segmented
        options={[
          { value: "signin", label: "Sign in" },
          { value: "register", label: "Register" },
        ]}
        value={mode}
        onChange={setMode}
      />
      {register ? <TextField label="Name" placeholder="Your name" value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" textContentType="name" returnKeyType="next" /> : null}
      <TextField label="Email" placeholder="chef@kitchen.co" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" autoCorrect={false} keyboardType="email-address" textContentType="username" returnKeyType="next" />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry={!showPassword}
        autoCorrect={false}
        spellCheck={false}
        keyboardType={showPassword ? "visible-password" : "default"}
        trailing={
          <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? "Hide password" : "Show password"} hitSlop={8} onPress={() => setShowPassword((v) => !v)}>
            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, letterSpacing: 1.4, textTransform: "uppercase", color: c.textMuted }} accessibilityElementsHidden>
              {showPassword ? "Hide" : "Show"}
            </Text>
          </Pressable>
        }
        autoCapitalize="none"
        autoComplete={register ? "new-password" : "current-password"}
        textContentType={register ? "newPassword" : "password"}
        returnKeyType="go"
        onSubmitEditing={() => canSubmit && submit()}
      />
      {!register ? (
        <Pressable accessibilityRole="link" accessibilityLabel="Forgot password" onPress={() => router.push("/forgot-password")} style={{ alignSelf: "flex-end", minHeight: 44, justifyContent: "center" }}>
          <Text style={{ fontFamily: "Inter_600SemiBold", color: c.accentText }}>Forgot password</Text>
        </Pressable>
      ) : null}
      {error ? (
        <Text variant="error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button label={register ? (busy ? "Creating…" : "Create account") : busy ? "Signing in…" : "Sign in"} disabled={!canSubmit} onPress={submit} />
      {googleEnabled ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, letterSpacing: 1.8, color: c.textMuted }}>OR</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
          </View>
          <Button kind="ghost" label="Continue with Google" leading={<GoogleMark />} disabled={signingIn} onPress={() => void session.signInWithGoogle()} />
        </>
      ) : null}
    </Screen>
  );
}

import { useEffect, useState } from "react";
import { Image, Linking, View } from "react-native";
import { useRouter } from "expo-router";
import { accountApi, session } from "../src/runtime/appContext";
import { authenticatorLink, mfaMessage, type AccountFacts } from "../src/api/account";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { TextField } from "../src/ui/TextField";
import { Button } from "../src/ui/Button";
import { Surface } from "../src/ui/Surface";
import { fontFamily, space } from "../src/theme";

type Step = { kind: "idle" } | { kind: "proof"; action: "setup" | "disable" } | { kind: "scan"; secret: string; qr: string };

const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

/**
 * Two-step verification (the web's Profile > Security > Two-Factor Authentication). Setting up asks for the password (accounts that have one),
 * then shows the key: on this phone it opens the authenticator app directly, and the QR is there for an authenticator on another device.
 * Turning it off asks for the password and a current code. The server decides what proof it needs.
 */
export default function TwoStep() {
  const router = useRouter();
  const [facts, setFacts] = useState<AccountFacts | "failed" | null>(null);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [serverWantsCode, setServerWantsCode] = useState(false);
  const [failure, setFailure] = useState<ReturnType<typeof mfaMessage>>();
  const [success, setSuccess] = useState<string>();
  const [busy, setBusy] = useState(false);

  const [load, setLoad] = useState(0);
  useEffect(() => {
    void accountApi.facts().then(setFacts, () => setFacts("failed"));
  }, [load]);

  if (facts === null) return <Screen align="top"><Text variant="muted">Loading…</Text></Screen>;
  if (facts === "failed") {
    return (
      <Screen align="top">
        <Text variant="title">Two-step verification</Text>
        <Text variant="error">Couldn't load your account. Check your signal and try again.</Text>
        {facts === "failed" ? <Button kind="ghost" label="Try again" onPress={() => (setFacts(null), setLoad((n) => n + 1))} /> : null}
        <Button kind="quiet" label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  const account = facts;
  const reset = (next: Step) => {
    setStep(next);
    setPassword("");
    setCode("");
    setFailure(undefined);
    setServerWantsCode(false);
  };
  async function attempt(work: () => Promise<void>) {
    setBusy(true);
    setFailure(undefined);
    setSuccess(undefined);
    try {
      await work();
    } catch (err) {
      const f = mfaMessage(err);
      if (f.needsMfa) setServerWantsCode(true);
      setFailure(f);
    } finally {
      setBusy(false);
    }
  }
  const start = () =>
    attempt(async () => {
      const { secret, qrCodeDataUrl } = await accountApi.mfaSetup({ password: password || undefined, mfaCode: code || undefined });
      reset({ kind: "scan", secret, qr: qrCodeDataUrl });
    });
  const finish = () =>
    attempt(async () => {
      await accountApi.mfaEnable(code);
      setFacts({ ...account, mfaEnabled: true });
      reset({ kind: "idle" });
      setSuccess("Two-step verification is on. You'll be asked for a code when you sign in.");
      void session.refreshUser();
    });
  const turnOff = () =>
    attempt(async () => {
      await accountApi.mfaDisable({ password: password || undefined, mfaCode: code });
      setFacts({ ...account, mfaEnabled: false });
      reset({ kind: "idle" });
      setSuccess("Two-step verification is off.");
      void session.refreshUser();
    });

  const passwordField = account.hasPassword ? <TextField label="Your password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" autoCapitalize="none" /> : null;
  const codeField = (label: string) => <TextField label={label} value={code} onChangeText={(v) => setCode(digits(v))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} placeholder="000000" />;
  const errorLine = failure ? (
    <Text variant="error" accessibilityLiveRegion="polite">
      {failure.text}
    </Text>
  ) : null;

  return (
    <Screen align="top">
      <Text variant="title">Two-step verification</Text>
      <Text variant="muted">A code from an authenticator app (such as Google Authenticator or Authy) as well as your password when you sign in.</Text>
      <Surface>
        <View style={{ padding: space.lg }}>
          <Text style={{ fontFamily: fontFamily.uiStrong }}>{account.mfaEnabled ? "On for your account" : "Off"}</Text>
        </View>
      </Surface>
      {success ? <Text variant="meta" accessibilityLiveRegion="polite">{success}</Text> : null}

      {step.kind === "idle" && !account.mfaEnabled ? <Button label="Set up" disabled={busy} onPress={() => (account.hasPassword ? reset({ kind: "proof", action: "setup" }) : void start())} /> : null}
      {step.kind === "idle" && account.mfaEnabled ? <Button kind="danger" label="Turn off" onPress={() => reset({ kind: "proof", action: "disable" })} /> : null}
      {step.kind === "idle" ? errorLine : null}

      {step.kind === "proof" ? (
        <>
          {passwordField}
          {step.action === "disable" || serverWantsCode ? codeField("Authenticator code") : null}
          {errorLine}
          {step.action === "setup" ? (
            <Button label={busy ? "Checking…" : "Continue"} disabled={busy || (account.hasPassword && !password)} onPress={() => void start()} />
          ) : (
            <Button kind="danger" label={busy ? "Turning off…" : "Turn off two-step verification"} disabled={busy || code.length !== 6 || (account.hasPassword && !password)} onPress={() => void turnOff()} />
          )}
          <Button kind="quiet" label="Cancel" disabled={busy} onPress={() => reset({ kind: "idle" })} />
        </>
      ) : null}

      {step.kind === "scan" ? (
        <>
          <Text variant="heading">1. Add it to your authenticator</Text>
          <Button kind="ghost" label="Open in authenticator app" onPress={() => void Linking.openURL(authenticatorLink(step.secret, account.email)).catch(() => setFailure({ text: "No authenticator app took the link. Type the key below into it instead." }))} />
          <Text variant="muted">Or type this key into it:</Text>
          <Text selectable style={{ fontFamily: fontFamily.uiStrong, fontSize: 18, letterSpacing: 2 }}>
            {step.secret}
          </Text>
          {step.qr ? (
            <View style={{ alignItems: "center", gap: space.xs }}>
              <Image accessibilityLabel="QR code for your authenticator app" source={{ uri: step.qr }} style={{ width: 200, height: 200 }} />
              <Text variant="meta">To use an authenticator on another device, scan this.</Text>
            </View>
          ) : null}
          <Text variant="heading">2. Enter the code it shows</Text>
          {codeField("6-digit code")}
          {errorLine}
          <Button label={busy ? "Turning on…" : "Turn on"} disabled={busy || code.length !== 6} onPress={() => void finish()} />
          <Button kind="quiet" label="Cancel" disabled={busy} onPress={() => reset({ kind: "idle" })} />
        </>
      ) : null}
      {failure?.needsFreshSignIn ? <Button kind="ghost" label="Sign out" onPress={() => void session.signOut()} /> : null}
      {step.kind === "idle" ? <Button kind="quiet" label="Back" onPress={() => router.back()} /> : null}
    </Screen>
  );
}

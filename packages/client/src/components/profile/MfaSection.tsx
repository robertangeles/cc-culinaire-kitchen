/**
 * @module components/profile/MfaSection
 *
 * Two-Factor Authentication controls, rendered inline inside the
 * Profile → Security tab. Lets an authenticated user set up, enable,
 * or disable TOTP MFA. On enable/disable it refreshes the app-wide
 * auth user so `user.mfaEnabled` stays in sync everywhere.
 *
 * The server decides what is allowed; this only collects the proof it asks for: the password
 * (accounts that have one) to start setup, and the password plus a current authenticator code
 * to turn MFA off.
 */

import { useState, useEffect, type FormEvent } from "react";
import { ShieldCheck, ShieldOff, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext.js";

export function MfaSection() {
  const { refreshUser } = useAuth();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [hasPassword, setHasPassword] = useState(true);
  const [asking, setAsking] = useState<"setup" | "disable" | null>(null);
  const [password, setPassword] = useState("");
  const [isChecking, setIsChecking] = useState(true);

  // Check current MFA status and whether the account has a password on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/users/profile", { credentials: "include" });
        if (res.ok) {
          const { profile } = await res.json();
          setMfaEnabled(profile.mfaEnabledInd);
          setHasPassword(profile.hasPassword);
        }
      } catch {
        // ignore
      } finally {
        setIsChecking(false);
      }
    })();
  }, []);

  function closeProofForm() {
    setAsking(null);
    setPassword("");
    setCode("");
    setError("");
  }

  async function handleSetup(e?: FormEvent) {
    e?.preventDefault();
    setError("");
    setSuccess("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/mfa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Setup failed");
      setQrDataUrl(data.qrCodeDataUrl);
      setSecret(data.secret);
      setAsking(null);
      setPassword("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleEnable(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/mfa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Enable failed");
      setMfaEnabled(true);
      setQrDataUrl(null);
      setSecret(null);
      setCode("");
      setSuccess("MFA has been enabled successfully.");
      await refreshUser();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Enable failed");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDisable(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password, mfaCode: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Disable failed");
      setMfaEnabled(false);
      setAsking(null);
      setPassword("");
      setCode("");
      setSuccess("MFA has been disabled.");
      await refreshUser();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Disable failed");
    } finally {
      setIsLoading(false);
    }
  }

  const passwordField = hasPassword && (
    <div>
      <label htmlFor="mfaPassword" className="block text-sm font-medium text-[#E5E5E5] mb-1">
        Your password
      </label>
      <input
        id="mfaPassword"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoFocus
        className="w-full rounded-lg border border-dark-200 px-3 py-2 text-sm text-[#FAFAFA] bg-dark focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-transparent"
      />
    </div>
  );

  function openProofForm(which: "setup" | "disable") {
    setError("");
    setSuccess("");
    setAsking(which);
  }

  return (
    <div className="bg-dark-50 rounded-2xl border border-dark-200 p-6 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-gold" />
        <h3 className="text-sm font-semibold text-[#E5E5E5]">Two-Factor Authentication</h3>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="size-4 flex-shrink-0" /> {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
          <CheckCircle2 className="size-4 flex-shrink-0" /> {success}
        </div>
      )}

      {isChecking ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="size-5 animate-spin text-dark-600" />
        </div>
      ) : mfaEnabled ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <ShieldCheck className="size-4 flex-shrink-0" />
            MFA is currently enabled on your account.
          </div>
          {asking === "disable" ? (
            <form onSubmit={handleDisable} className="space-y-3">
              {passwordField}
              <div>
                <label htmlFor="mfaDisableCode" className="block text-sm font-medium text-[#E5E5E5] mb-1">
                  Authenticator code
                </label>
                <input
                  id="mfaDisableCode"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  required
                  autoFocus={!hasPassword}
                  className="w-full rounded-lg border border-dark-200 px-3 py-2 text-sm text-[#FAFAFA] text-center tracking-[0.5em] font-mono bg-dark focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-transparent"
                  placeholder="000000"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isLoading || code.length !== 6 || (hasPassword && !password)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-400 bg-red-900/30 rounded-lg hover:bg-red-900/40 disabled:opacity-50 transition-colors"
                >
                  {isLoading ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />}
                  Turn off MFA
                </button>
                <button
                  type="button"
                  onClick={closeProofForm}
                  disabled={isLoading}
                  className="px-4 py-2 text-sm font-medium text-[#E5E5E5] rounded-lg hover:bg-dark-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => openProofForm("disable")}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-400 bg-red-900/30 rounded-lg hover:bg-red-900/40 transition-colors"
            >
              <ShieldOff className="size-4" />
              Disable MFA
            </button>
          )}
        </div>
      ) : qrDataUrl ? (
        <form onSubmit={handleEnable} className="space-y-4">
          <p className="text-sm text-[#E5E5E5]">
            Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.):
          </p>
          <div className="flex justify-center">
            <img src={qrDataUrl} alt="MFA QR Code" className="w-48 h-48" />
          </div>
          <div className="text-center">
            <p className="text-xs text-dark-600 mb-1">Or enter this key manually:</p>
            <code className="text-xs bg-dark-100 px-2 py-1 rounded font-mono select-all">{secret}</code>
          </div>
          <div>
            <label htmlFor="mfaCode" className="block text-sm font-medium text-[#E5E5E5] mb-1">
              Enter the 6-digit code to verify
            </label>
            <input
              id="mfaCode"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
              autoFocus
              className="w-full rounded-lg border border-dark-200 px-3 py-2 text-sm text-[#FAFAFA] text-center tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-transparent"
              placeholder="000000"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || code.length !== 6}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-white bg-gold rounded-lg hover:bg-gold-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading && <Loader2 className="size-4 animate-spin" />}
            Enable MFA
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-[#E5E5E5]">
            Add an extra layer of security to your account by enabling two-factor authentication.
            You'll need an authenticator app like Google Authenticator or Authy.
          </p>
          {asking === "setup" ? (
            <form onSubmit={handleSetup} className="space-y-3">
              {passwordField}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isLoading || !password}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gold rounded-lg hover:bg-gold-hover disabled:opacity-50 transition-colors"
                >
                  {isLoading ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                  Continue
                </button>
                <button
                  type="button"
                  onClick={closeProofForm}
                  disabled={isLoading}
                  className="px-4 py-2 text-sm font-medium text-[#E5E5E5] rounded-lg hover:bg-dark-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => (hasPassword ? openProofForm("setup") : handleSetup())}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gold rounded-lg hover:bg-gold-hover disabled:opacity-50 transition-colors"
            >
              {isLoading ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              Set Up MFA
            </button>
          )}
        </div>
      )}
    </div>
  );
}

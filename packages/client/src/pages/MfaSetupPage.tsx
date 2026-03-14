/**
 * @module pages/MfaSetupPage
 *
 * Allows authenticated users to set up, enable, or disable TOTP MFA.
 * Displays a QR code for scanning with an authenticator app.
 */

import { useState, useEffect, type FormEvent } from "react";
import { ShieldCheck, ShieldOff, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

export function MfaSetupPage() {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  // Check current MFA status on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setMfaEnabled(data.user.mfaEnabled);
        }
      } catch {
        // ignore
      } finally {
        setIsChecking(false);
      }
    })();
  }, []);

  async function handleSetup() {
    setError("");
    setSuccess("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/mfa/setup", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Setup failed");
      setQrDataUrl(data.qrDataUrl);
      setSecret(data.secret);
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
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Enable failed");
      setMfaEnabled(true);
      setQrDataUrl(null);
      setSecret(null);
      setCode("");
      setSuccess("MFA has been enabled successfully.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Enable failed");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDisable() {
    setError("");
    setSuccess("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/mfa/disable", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Disable failed");
      setMfaEnabled(false);
      setSuccess("MFA has been disabled.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Disable failed");
    } finally {
      setIsLoading(false);
    }
  }

  if (isChecking) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="size-6 animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-8 px-4">
      <h1 className="text-xl font-bold text-stone-800 mb-6 flex items-center gap-2">
        <ShieldCheck className="size-5" />
        Two-Factor Authentication
      </h1>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
          <AlertCircle className="size-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-4">
          <CheckCircle2 className="size-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {mfaEnabled ? (
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            <ShieldCheck className="size-4 flex-shrink-0" />
            MFA is currently enabled on your account.
          </div>
          <button
            onClick={handleDisable}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
          >
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />}
            Disable MFA
          </button>
        </div>
      ) : qrDataUrl ? (
        <form onSubmit={handleEnable} className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-4">
          <p className="text-sm text-stone-600">
            Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.):
          </p>
          <div className="flex justify-center">
            <img src={qrDataUrl} alt="MFA QR Code" className="w-48 h-48" />
          </div>
          <div className="text-center">
            <p className="text-xs text-stone-400 mb-1">Or enter this key manually:</p>
            <code className="text-xs bg-stone-100 px-2 py-1 rounded font-mono select-all">{secret}</code>
          </div>
          <div>
            <label htmlFor="mfaCode" className="block text-sm font-medium text-stone-700 mb-1">
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
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 text-center tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              placeholder="000000"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || code.length !== 6}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading && <Loader2 className="size-4 animate-spin" />}
            Enable MFA
          </button>
        </form>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-4">
          <p className="text-sm text-stone-600">
            Add an extra layer of security to your account by enabling two-factor authentication.
            You'll need an authenticator app like Google Authenticator or Authy.
          </p>
          <button
            onClick={handleSetup}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Set Up MFA
          </button>
        </div>
      )}
    </div>
  );
}

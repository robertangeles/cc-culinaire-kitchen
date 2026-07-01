/**
 * @module components/profile/MfaSection
 *
 * Two-Factor Authentication controls, rendered inline inside the
 * Profile → Security tab. Lets an authenticated user set up, enable,
 * or disable TOTP MFA. On enable/disable it refreshes the app-wide
 * auth user so `user.mfaEnabled` stays in sync everywhere.
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
      setQrDataUrl(data.qrCodeDataUrl);
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
      await refreshUser();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Disable failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="bg-[#161616] rounded-2xl border border-[#2A2A2A] p-6 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-[#D4A574]" />
        <h3 className="text-sm font-semibold text-[#E5E5E5]">Two-Factor Authentication</h3>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
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
          <Loader2 className="size-5 animate-spin text-[#999999]" />
        </div>
      ) : mfaEnabled ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <ShieldCheck className="size-4 flex-shrink-0" />
            MFA is currently enabled on your account.
          </div>
          <button
            onClick={handleDisable}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-400 bg-red-900/30 rounded-lg hover:bg-red-900/40 disabled:opacity-50 transition-colors"
          >
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />}
            Disable MFA
          </button>
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
            <p className="text-xs text-[#999999] mb-1">Or enter this key manually:</p>
            <code className="text-xs bg-[#1E1E1E] px-2 py-1 rounded font-mono select-all">{secret}</code>
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
              className="w-full rounded-lg border border-[#2A2A2A] px-3 py-2 text-sm text-[#FAFAFA] text-center tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent"
              placeholder="000000"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || code.length !== 6}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
          <button
            onClick={handleSetup}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] disabled:opacity-50 transition-colors"
          >
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Set Up MFA
          </button>
        </div>
      )}
    </div>
  );
}

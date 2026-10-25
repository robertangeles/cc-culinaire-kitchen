import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, Loader2, AlertCircle, Trash2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext.js";

const inputClass =
  "w-full rounded-xl border border-dark-200 px-3 py-2 text-sm text-white bg-dark placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-transparent";

interface AccountFacts {
  hasPassword: boolean;
  mfaEnabled: boolean;
  userEmail: string;
}

/**
 * Self-service account deletion (Profile → Security). The server decides what is allowed;
 * this only collects the proof it asks for: the password (or the typed email for Google-only
 * accounts) and an authenticator code when MFA is on.
 */
export function DeleteAccountSection() {
  const { logout } = useAuth();
  const [facts, setFacts] = useState<AccountFacts | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/users/profile", { credentials: "include" });
        if (!res.ok) return;
        const { profile } = await res.json();
        setFacts({ hasPassword: profile.hasPassword, mfaEnabled: profile.mfaEnabledInd, userEmail: profile.userEmail });
      } catch {
        // The button stays hidden; nothing else on the page depends on this.
      }
    })();
  }, []);

  useEffect(() => {
    if (open) firstField.current?.focus();
  }, [open]);

  function close() {
    if (deleting) return;
    setOpen(false);
    setPassword("");
    setConfirmEmail("");
    setMfaCode("");
    setError("");
  }

  async function handleDelete(e: FormEvent) {
    e.preventDefault();
    if (!facts) return;
    setError("");
    setDeleting(true);
    try {
      const res = await fetch("/api/users/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...(facts.hasPassword ? { password } : { confirmEmail }),
          ...(facts.mfaEnabled ? { mfaCode } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not delete the account.");
      await logout();
      window.location.assign("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete the account.");
      setDeleting(false);
    }
  }

  if (!facts) return null;

  return (
    <>
      <section
        aria-labelledby="delete-account-heading"
        className="bg-red-500/5 backdrop-blur rounded-2xl border border-red-500/20 p-6 space-y-3"
      >
        <div className="flex items-center gap-2">
          <Trash2 className="size-4 text-red-400" />
          <h3 id="delete-account-heading" className="text-sm font-semibold text-[#E5E5E5]">Delete account</h3>
        </div>
        <p className="text-sm text-dark-400">
          Permanently delete your account and personal data. Your name and email are removed and you are signed out
          straight away. Business records such as orders and stock history stay, with no name attached.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-4 py-2 text-sm font-medium text-red-300 border border-red-500/40 rounded-xl hover:bg-red-500/10 hover:shadow-[0_0_12px_rgba(239,68,68,0.15)] transition-all"
        >
          Delete my account
        </button>
      </section>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onKeyDown={(e) => e.key === "Escape" && close()}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            onSubmit={handleDelete}
            className="w-full max-w-md bg-dark-50/90 backdrop-blur rounded-2xl border border-red-500/30 shadow-[0_0_24px_rgba(239,68,68,0.15)] p-6 space-y-4"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-red-400" />
              <h2 id="delete-dialog-title" className="text-base font-semibold text-white">Delete your account?</h2>
            </div>
            <p className="text-sm text-dark-400">
              This cannot be undone. Your chats, saved recipes and preferences are deleted, any subscription is
              cancelled, and you will not be able to sign in again.
            </p>

            {error && (
              <div role="alert" className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="size-4 flex-shrink-0 mt-0.5" /> {error}
              </div>
            )}

            {facts.hasPassword ? (
              <div>
                <label htmlFor="delete-password" className="block text-sm font-medium text-[#E5E5E5] mb-1">Your password</label>
                <input id="delete-password" ref={firstField} type="password" autoComplete="current-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} required className={inputClass} />
              </div>
            ) : (
              <div>
                <label htmlFor="delete-email" className="block text-sm font-medium text-[#E5E5E5] mb-1">
                  Type your email address ({facts.userEmail}) to confirm
                </label>
                <input id="delete-email" ref={firstField} type="email" autoComplete="off" value={confirmEmail}
                  onChange={(e) => setConfirmEmail(e.target.value)} required className={inputClass} />
              </div>
            )}

            {facts.mfaEnabled && (
              <div>
                <label htmlFor="delete-mfa" className="block text-sm font-medium text-[#E5E5E5] mb-1">Authenticator code</label>
                <input id="delete-mfa" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} required className={inputClass} />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={close} disabled={deleting}
                className="px-4 py-2 text-sm text-[#E5E5E5] rounded-xl hover:bg-dark-100 transition-colors disabled:opacity-50">
                Cancel <kbd className="ml-1 text-xs text-dark-400">Esc</kbd>
              </button>
              <button type="submit" disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-red-600 to-red-500 rounded-xl hover:shadow-[0_0_12px_rgba(239,68,68,0.3)] disabled:opacity-50 transition-all">
                {deleting && <Loader2 className="size-4 animate-spin inline mr-1" />}
                Delete my account
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

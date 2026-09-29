import { useState, type FormEvent } from "react";
import { Key, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { MfaSection } from "./MfaSection.js";

const inputClass =
  "w-full rounded-xl border border-dark-200 px-3 py-2 text-sm text-white bg-dark placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-transparent";

export function SecurityTab() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordMsg("");
    setPasswordError("");
    setSavingPassword(true);
    try {
      const res = await fetch("/api/users/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to change password");
      setPasswordMsg("Password changed.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err: unknown) {
      setPasswordError(err instanceof Error ? err.message : "Change failed");
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div role="tabpanel" id="profile-tabpanel-security" aria-labelledby="profile-tab-security" className="space-y-4">
      <form onSubmit={handleChangePassword} className="bg-dark-50 rounded-2xl border border-dark-200 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Key className="size-4 text-gold" />
          <h3 className="text-sm font-semibold text-[#E5E5E5]">Change Password</h3>
        </div>

        {passwordMsg && (
          <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="size-4 flex-shrink-0" /> {passwordMsg}
          </div>
        )}
        {passwordError && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertCircle className="size-4 flex-shrink-0" /> {passwordError}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Current Password</label>
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required className={inputClass} />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#E5E5E5] mb-1">New Password</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} className={inputClass} placeholder="Min 8 chars" />
        </div>

        <button
          type="submit"
          disabled={savingPassword}
          className="px-4 py-2 text-sm font-medium text-dark bg-gold rounded-xl hover:bg-gold-hover disabled:opacity-50 transition-colors"
        >
          {savingPassword && <Loader2 className="size-4 animate-spin inline mr-1" />}
          Change Password
        </button>
      </form>

      <MfaSection />
    </div>
  );
}

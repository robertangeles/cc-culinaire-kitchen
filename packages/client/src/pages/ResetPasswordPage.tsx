/**
 * @module pages/ResetPasswordPage
 *
 * Allows users to set a new password using a reset token from a
 * password-reset email. Validates that both password fields match
 * before submitting.
 */

import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { KeyRound, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

export function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Something went wrong. Please try again.");
      }

      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center rounded-2xl mb-4 overflow-hidden"
            style={{ width: 80, height: 80 }}
          >
            <div className="size-full bg-[#C4956A] flex items-center justify-center">
              <KeyRound className="size-10 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-[#FAFAFA]">Reset Password</h1>
          <p className="text-[#999999] mt-1">Enter your new password below</p>
        </div>

        {!token ? (
          <div className="bg-[#161616] rounded-2xl shadow-lg shadow-black/20 border border-[#2A2A2A] p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/30 border border-red-700/40 rounded-lg px-3 py-2">
              <AlertCircle className="size-4 flex-shrink-0" />
              Invalid reset link.
            </div>

            <Link
              to="/login"
              className="block w-full text-center py-2.5 text-sm font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] transition-colors"
            >
              Back to Login
            </Link>
          </div>
        ) : success ? (
          <div className="bg-[#161616] rounded-2xl shadow-lg shadow-black/20 border border-[#2A2A2A] p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm text-green-400 bg-green-900/30 border border-green-700/40 rounded-lg px-3 py-2">
              <CheckCircle2 className="size-4 flex-shrink-0" />
              Password reset successfully!
            </div>

            <Link
              to="/login"
              className="block w-full text-center py-2.5 text-sm font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] transition-colors"
            >
              Back to Login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-[#161616] rounded-2xl shadow-lg shadow-black/20 border border-[#2A2A2A] p-6 space-y-4">
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/30 border border-red-700/40 rounded-lg px-3 py-2">
                <AlertCircle className="size-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium text-[#E5E5E5] mb-1">
                New Password
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-lg border border-[#2A2A2A] px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent"
                placeholder="Enter new password"
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-[#E5E5E5] mb-1">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-lg border border-[#2A2A2A] px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent"
                placeholder="Confirm new password"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              Reset Password
            </button>
          </form>
        )}

        <p className="text-center text-sm text-[#999999] mt-4">
          <Link to="/login" className="text-[#D4A574] hover:text-[#D4A574] font-medium">
            Back to Login
          </Link>
        </p>
      </div>
    </div>
  );
}

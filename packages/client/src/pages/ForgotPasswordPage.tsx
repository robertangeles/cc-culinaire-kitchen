/**
 * @module pages/ForgotPasswordPage
 *
 * Allows users to request a password-reset email by entering their
 * registered email address. Shows a confirmation message on success.
 */

import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Mail, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
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
              <Mail className="size-10 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-[#FAFAFA]">Forgot Password</h1>
          <p className="text-[#999999] mt-1">Enter your email and we'll send you a reset link</p>
        </div>

        {success ? (
          <div className="bg-[#161616] rounded-2xl shadow-lg shadow-black/20 border border-[#2A2A2A] p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm text-green-400 bg-green-900/30 border border-green-700/40 rounded-lg px-3 py-2">
              <CheckCircle2 className="size-4 flex-shrink-0" />
              If that email is registered, a reset link has been sent.
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
              <label htmlFor="email" className="block text-sm font-medium text-[#E5E5E5] mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full rounded-lg border border-[#2A2A2A] px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent"
                placeholder="you@example.com"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              Send Reset Link
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

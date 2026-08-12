/**
 * @module pages/ForgotPasswordPage
 *
 * Allows users to request a password-reset email by entering their
 * registered email address. Shows a confirmation message on success.
 */

import { useState, useRef, type FormEvent } from "react";
import { Link } from "react-router";
import { Mail, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { TurnstileWidget, type TurnstileHandle } from "../components/auth/TurnstileWidget.js";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Turnstile (bot protection)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!turnstileToken) {
      setError("Please complete the security check.");
      return;
    }
    setError("");
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Something went wrong. Please try again.");
      }

      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      // Turnstile tokens are single-use — reset so the user can retry.
      turnstileRef.current?.reset();
      setTurnstileToken(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center rounded-2xl mb-4 overflow-hidden"
            style={{ width: 80, height: 80 }}
          >
            <div className="size-full bg-gold-hover flex items-center justify-center">
              <Mail className="size-10 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-[#FAFAFA]">Forgot Password</h1>
          <p className="text-dark-600 mt-1">Enter your email and we'll send you a reset link</p>
        </div>

        {success ? (
          <div className="bg-dark-50 rounded-2xl shadow-lg shadow-black/20 border border-dark-200 p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm text-green-400 bg-green-900/30 border border-green-700/40 rounded-lg px-3 py-2">
              <CheckCircle2 className="size-4 flex-shrink-0" />
              If that email is registered, a reset link has been sent.
            </div>

            <Link
              to="/login"
              className="block w-full text-center py-2.5 text-sm font-medium text-white bg-gold rounded-lg hover:bg-gold-hover transition-colors"
            >
              Back to Login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-dark-50 rounded-2xl shadow-lg shadow-black/20 border border-dark-200 p-6 space-y-4">
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
                className="w-full rounded-lg border border-dark-200 px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-transparent"
                placeholder="you@example.com"
              />
            </div>

            <TurnstileWidget ref={turnstileRef} onToken={setTurnstileToken} />

            <button
              type="submit"
              disabled={isSubmitting || !turnstileToken}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-white bg-gold rounded-lg hover:bg-gold-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              Send Reset Link
            </button>
          </form>
        )}

        <p className="text-center text-sm text-dark-600 mt-4">
          <Link to="/login" className="text-gold hover:text-gold font-medium">
            Back to Login
          </Link>
        </p>
      </div>
    </div>
  );
}

/**
 * @module pages/LoginPage
 *
 * Login form with email + password fields. On success, redirects
 * to the chat page. Links to registration for new users.
 */

import { useState, useRef, type FormEvent } from "react";
import { Link, useNavigate, useLocation } from "react-router";
import { ChefHat, Loader2, AlertCircle, ShieldCheck, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { useAuth } from "../context/AuthContext.js";
import { useSettings } from "../context/SettingsContext.js";
import { OAuthButtons } from "../components/auth/OAuthButtons.js";
import { TurnstileWidget, type TurnstileHandle } from "../components/auth/TurnstileWidget.js";
import { computeLandingRoute } from "../lib/landing.js";

export function LoginPage() {
  const { login, completeMfaLogin } = useAuth();
  const { settings, isLoading: settingsLoading } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();

  const registrationMessage = (location.state as { registrationSuccess?: string } | null)?.registrationSuccess;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Turnstile (bot protection)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  // MFA state
  const [mfaSessionToken, setMfaSessionToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  const pageTitle = settings.page_title || "CulinAIre Kitchen";
  const logoPath = settings.logo_path;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!turnstileToken) {
      setError("Please complete the security check.");
      return;
    }
    setError("");
    setIsSubmitting(true);

    try {
      const result = await login(email, password, turnstileToken);
      if (result.requiresMfa) {
        setMfaSessionToken(result.mfaSessionToken);
      } else {
        navigate(computeLandingRoute(result.user));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
      // Turnstile tokens are single-use — reset so the user can retry.
      turnstileRef.current?.reset();
      setTurnstileToken(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMfaSubmit(e: FormEvent) {
    e.preventDefault();
    if (!mfaSessionToken) return;
    setError("");
    setIsSubmitting(true);

    try {
      const verifiedUser = await completeMfaLogin(mfaSessionToken, mfaCode);
      navigate(computeLandingRoute(verifiedUser));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "MFA verification failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark px-4">
      <div className="w-full max-w-md animate-fade-in-up">
        {/* Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center rounded-2xl mb-4 overflow-hidden drop-shadow-[0_0_30px_var(--color-gold-muted)]"
            style={{ width: 120, height: 120 }}
          >
            {settingsLoading ? (
              <div className="size-full bg-dark-100 animate-pulse rounded-2xl" />
            ) : logoPath ? (
              <img src={logoPath} alt={pageTitle} className="size-full object-contain" />
            ) : (
              <div className="size-full bg-gold flex items-center justify-center">
                <ChefHat className="size-14 text-dark" />
              </div>
            )}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#FAFAFA]">{pageTitle}</h1>
          <p className="text-dark-500 text-sm mt-1">Sign in to your account</p>
        </div>

        {mfaSessionToken ? (
          /* MFA Verification Step */
          <form onSubmit={handleMfaSubmit} className="bg-dark-50 rounded-2xl shadow-2xl shadow-black/50 border border-dark-200 p-8 space-y-5">
            <div className="flex items-center gap-2 text-sm text-gold bg-gold/10 border border-gold/20 rounded-xl px-4 py-3">
              <ShieldCheck className="size-4 flex-shrink-0" />
              Enter the 6-digit code from your authenticator app.
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                <AlertCircle className="size-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <div>
              <label htmlFor="mfaCode" className="block text-sm font-medium text-dark-600 mb-2">
                Verification Code
              </label>
              <input
                id="mfaCode"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                required
                autoFocus
                autoComplete="one-time-code"
                className="w-full rounded-xl border border-dark-200 bg-dark px-4 py-3 text-white text-center tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold placeholder-dark-400 transition-colors"
                placeholder="000000"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || mfaCode.length !== 6}
              className="w-full flex items-center justify-center gap-2 py-3 text-base font-semibold text-dark bg-gold rounded-xl hover:bg-gold-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              Verify
            </button>

            <button
              type="button"
              onClick={() => { setMfaSessionToken(null); setMfaCode(""); setError(""); }}
              className="w-full text-sm text-dark-500 hover:text-gold transition-colors"
            >
              Back to login
            </button>
          </form>
        ) : (
          /* Login Form */
          <form onSubmit={handleSubmit} className="bg-dark-50 rounded-2xl shadow-2xl shadow-black/50 border border-dark-200 p-8 space-y-5">
            {registrationMessage && !error && (
              <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
                <CheckCircle2 className="size-4 flex-shrink-0" />
                {registrationMessage}
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                <AlertCircle className="size-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-dark-600 mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full rounded-xl border border-dark-200 bg-dark px-4 py-3 text-white placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold transition-colors"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-dark-600 mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-dark-200 bg-dark px-4 py-3 pr-11 text-white placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold transition-colors"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-dark-500 hover:text-dark-600"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <Link to="/forgot-password" className="text-sm text-dark-500 hover:text-gold transition-colors">
                Forgot password?
              </Link>
            </div>

            <TurnstileWidget ref={turnstileRef} onToken={setTurnstileToken} />

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => navigate("/")}
                className="flex-1 py-3 text-sm font-medium text-[#E5E5E5] bg-dark-100 border border-dark-200 rounded-xl hover:bg-[#252525] transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !turnstileToken}
                className="flex-1 flex items-center justify-center gap-2 py-3 text-base font-semibold text-dark bg-gold rounded-xl hover:bg-gold-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                Sign In
              </button>
            </div>

            <OAuthButtons />
          </form>
        )}

        {!mfaSessionToken && (
          <p className="text-center text-sm text-dark-500 mt-6">
            Don't have an account?{" "}
            <Link to="/register" className="text-gold hover:text-gold-hover font-medium transition-colors">
              Create one
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

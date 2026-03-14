/**
 * @module pages/RegisterPage
 *
 * Registration form with name, email, password, and confirm password.
 * On success, shows a message prompting user to verify their email.
 */

import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ChefHat, Loader2, AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { useAuth } from "../context/AuthContext.js";
import { useSettings } from "../context/SettingsContext.js";
import { OAuthButtons } from "../components/auth/OAuthButtons.js";
import {
  PasswordRequirements,
  isPasswordValid,
} from "../components/auth/PasswordRequirements.js";

export function RegisterPage() {
  const { register } = useAuth();
  const { settings, isLoading: settingsLoading } = useSettings();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const pageTitle = settings.page_title || "CulinAIre Kitchen";
  const logoPath = settings.logo_path;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!isPasswordValid(password)) {
      setError("Password does not meet the requirements.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await register(name, email, password);
      setSuccess(result.message + " Redirecting to login...");
      setTimeout(() => {
        navigate("/login", { state: { registrationSuccess: result.message } });
      }, 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center rounded-2xl mb-4 overflow-hidden"
            style={{ width: 80, height: 80 }}
          >
            {settingsLoading ? (
              <div className="size-full bg-stone-200 animate-pulse rounded-2xl" />
            ) : logoPath ? (
              <img src={logoPath} alt={pageTitle} className="size-full object-contain" />
            ) : (
              <div className="size-full bg-amber-700 flex items-center justify-center">
                <ChefHat className="size-10 text-white" />
              </div>
            )}
          </div>
          <h1 className="text-2xl font-bold text-stone-800">{pageTitle}</h1>
          <p className="text-stone-500 mt-1">Create your account</p>
        </div>

        {/* Registration Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="size-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <CheckCircle2 className="size-4 flex-shrink-0" />
              {success}
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-stone-700 mb-1">
              Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              placeholder="Your full name"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-stone-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-stone-700 mb-1">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full rounded-lg border border-stone-300 px-3 py-2 pr-10 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                placeholder="Enter a strong password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-stone-400 hover:text-stone-600"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <PasswordRequirements password={password} />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-stone-700 mb-1">
              Confirm Password
            </label>
            <div className="relative">
              <input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full rounded-lg border border-stone-300 px-3 py-2 pr-10 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                placeholder="Re-enter your password"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-stone-400 hover:text-stone-600"
                tabIndex={-1}
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              >
                {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {confirmPassword && password !== confirmPassword && (
              <p className="mt-1.5 text-xs text-red-500 flex items-center gap-1.5">
                <AlertCircle className="size-3 flex-shrink-0" />
                Passwords do not match
              </p>
            )}
            {confirmPassword && password === confirmPassword && (
              <p className="mt-1.5 text-xs text-green-600 flex items-center gap-1.5">
                <CheckCircle2 className="size-3 flex-shrink-0" />
                Passwords match
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={
              isSubmitting ||
              !!success ||
              !isPasswordValid(password) ||
              password !== confirmPassword
            }
            className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Create Account
          </button>

          <OAuthButtons />
        </form>

        <p className="text-center text-sm text-stone-500 mt-4">
          Already have an account?{" "}
          <Link to="/login" className="text-amber-600 hover:text-amber-700 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

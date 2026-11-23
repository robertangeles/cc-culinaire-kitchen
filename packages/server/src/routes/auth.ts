/**
 * @module routes/auth
 *
 * Express router for authentication endpoints:
 * registration, login, logout, token refresh, current-user retrieval,
 * email verification, and OAuth providers.
 */

import { Router } from "express";
import {
  handleRegister,
  handleLogin,
  handleLogout,
  handleRefresh,
  handleGetMe,
  handleVerifyEmail,
  handleResendVerification,
  handleGoogleRedirect,
  handleGoogleCallback,
  handleGoogleIdToken,
  handleMfaSetup,
  handleMfaEnable,
  handleMfaDisable,
  handleMfaVerify,
  handleForgotPassword,
  handleResetPassword,
  handleTurnstileConfig,
} from "../controllers/authController.js";
import { handleAppleIdToken, handleAppleLink } from "../controllers/appleAuthController.js";
import { authenticate } from "../middleware/auth.js";
import {
  mfaVerifyRateLimit,
  mfaAccountRateLimit,
  loginRateLimit,
  registerRateLimit,
  forgotPasswordRateLimit,
  resetPasswordRateLimit,
  resendVerificationRateLimit,
  verifyEmailRateLimit,
  googleIdTokenRateLimit,
  appleIdTokenRateLimit,
  appleLinkRateLimit,
  logoutRateLimit,
  refreshRateLimit,
  refreshTokenRateLimit,
} from "../middleware/rateLimiter.js";
import { requireSupportedMobileVersion } from "../middleware/mobileVersionPolicy.js";

const router = Router();

// Public: site key for the browser-side Turnstile widget.
router.get("/turnstile-config", handleTurnstileConfig);

// Each public endpoint has its own rate-limit bucket (see rateLimiter.ts): they are the abuse backstop
// for the non-browser path, since Turnstile is enforced only for browser requests.
router.post("/register", registerRateLimit, handleRegister);
router.post("/login", loginRateLimit, requireSupportedMobileVersion(), handleLogin);
router.post("/logout", logoutRateLimit, handleLogout);
router.post("/refresh", refreshRateLimit, refreshTokenRateLimit, handleRefresh);
router.get("/me", authenticate, handleGetMe);
router.get("/verify-email", verifyEmailRateLimit, handleVerifyEmail);
router.post("/resend-verification", resendVerificationRateLimit, handleResendVerification);
router.post("/forgot-password", forgotPasswordRateLimit, handleForgotPassword);
router.post("/reset-password", resetPasswordRateLimit, handleResetPassword);

// OAuth
router.get("/google", handleGoogleRedirect);
router.get("/google/callback", handleGoogleCallback);
// Mobile native Google Sign-In: accepts an ID token from
// @react-native-google-signin/google-signin and issues our JWTs.
router.post("/google/idtoken", googleIdTokenRateLimit, handleGoogleIdToken);
// Mobile native Sign in with Apple: accepts the identity token iOS returns and issues our JWTs.
router.post("/apple/idtoken", appleIdTokenRateLimit, requireSupportedMobileVersion(), handleAppleIdToken);
// A signed-in person adds Apple to their account. Wrong passwords or codes count against the per-account MFA limit.
router.post("/apple/link", authenticate, appleLinkRateLimit, mfaAccountRateLimit, handleAppleLink);

// MFA
router.post("/mfa/setup", authenticate, mfaAccountRateLimit, handleMfaSetup);
router.post("/mfa/enable", authenticate, mfaAccountRateLimit, handleMfaEnable);
router.post("/mfa/disable", authenticate, mfaAccountRateLimit, handleMfaDisable);
router.post("/mfa/verify", mfaVerifyRateLimit, mfaAccountRateLimit, requireSupportedMobileVersion(), handleMfaVerify);

export default router;

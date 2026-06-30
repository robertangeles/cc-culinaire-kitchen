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
import { authenticate } from "../middleware/auth.js";
import { authRateLimit } from "../middleware/rateLimiter.js";

const router = Router();

// Public: site key for the browser-side Turnstile widget.
router.get("/turnstile-config", handleTurnstileConfig);

// authRateLimit is the abuse backstop for the non-browser path: Turnstile is
// enforced only for browser requests, so native/scripted clients are throttled
// here instead (20/min per IP).
router.post("/register", authRateLimit, handleRegister);
router.post("/login", authRateLimit, handleLogin);
router.post("/logout", handleLogout);
router.post("/refresh", handleRefresh);
router.get("/me", authenticate, handleGetMe);
router.get("/verify-email", handleVerifyEmail);
router.post("/resend-verification", handleResendVerification);
router.post("/forgot-password", authRateLimit, handleForgotPassword);
router.post("/reset-password", handleResetPassword);

// OAuth
router.get("/google", handleGoogleRedirect);
router.get("/google/callback", handleGoogleCallback);
// Mobile native Google Sign-In: accepts an ID token from
// @react-native-google-signin/google-signin and issues our JWTs.
router.post("/google/idtoken", handleGoogleIdToken);

// MFA
router.post("/mfa/setup", authenticate, handleMfaSetup);
router.post("/mfa/enable", authenticate, handleMfaEnable);
router.post("/mfa/disable", authenticate, handleMfaDisable);
router.post("/mfa/verify", handleMfaVerify);

export default router;

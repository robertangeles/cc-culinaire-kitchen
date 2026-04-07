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
  handleMfaSetup,
  handleMfaEnable,
  handleMfaDisable,
  handleMfaVerify,
  handleForgotPassword,
  handleResetPassword,
} from "../controllers/authController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.post("/register", handleRegister);
router.post("/login", handleLogin);
router.post("/logout", handleLogout);
router.post("/refresh", handleRefresh);
router.get("/me", authenticate, handleGetMe);
router.get("/verify-email", handleVerifyEmail);
router.post("/resend-verification", handleResendVerification);
router.post("/forgot-password", handleForgotPassword);
router.post("/reset-password", handleResetPassword);

// OAuth
router.get("/google", handleGoogleRedirect);
router.get("/google/callback", handleGoogleCallback);

// MFA
router.post("/mfa/setup", authenticate, handleMfaSetup);
router.post("/mfa/enable", authenticate, handleMfaEnable);
router.post("/mfa/disable", authenticate, handleMfaDisable);
router.post("/mfa/verify", handleMfaVerify);

export default router;

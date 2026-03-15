/**
 * @module controllers/authController
 *
 * Express request handlers for authentication endpoints:
 * register, login, logout, token refresh, and current-user retrieval.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import {
  registerUser,
  loginUser,
  generateTokens,
  refreshAccessToken,
  revokeRefreshToken,
  getUserWithRolesAndPermissions,
  verifyEmail,
  resendVerification,
  getGoogleAuthUrl,
  getMicrosoftAuthUrl,
  handleOAuthCallback,
  generateMfaSecret,
  enableMfa,
  disableMfa,
  completeMfaLogin,
  requestPasswordReset,
  resetPassword,
} from "../services/authService.js";
import { linkGuestConversations } from "../services/guestService.js";

const logger = pino({ name: "authController" });

const IS_PROD = process.env.NODE_ENV === "production";

/** Zod schema for registration requests. */
const RegisterSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  guestToken: z.string().uuid().optional(),
});

/** Zod schema for login requests. */
const LoginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

/** Sets access and refresh token cookies on the response. */
function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshTokenValue: string,
) {
  res.cookie("access_token", accessToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    maxAge: 60 * 60 * 1000, // 1 hour
    path: "/",
  });

  res.cookie("refresh_token", refreshTokenValue, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/",
  });
}

/** Clears auth cookies from the response. */
function clearAuthCookies(res: Response) {
  res.clearCookie("access_token", { path: "/" });
  res.clearCookie("refresh_token", { path: "/" });
}

/**
 * POST /api/auth/register
 *
 * Creates a new user account with hashed password.
 * Does NOT log the user in — they must verify email first.
 */
export async function handleRegister(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map((e) => e.message).join(". ");
      res.status(400).json({ error: messages });
      return;
    }

    const { name, email, password, guestToken } = parsed.data;
    const userId = await registerUser(name, email, password);

    // Link guest conversations to the new user account if a guest token was provided
    if (guestToken) {
      try {
        await linkGuestConversations(guestToken, userId);
        logger.info({ userId, guestToken }, "Guest conversations linked to new user");
      } catch (err) {
        logger.warn(err, "Failed to link guest conversations (non-fatal)");
      }
    }

    const autoVerified = !process.env.RESEND_API_KEY;
    logger.info({ userId, email, autoVerified }, "User registered");
    res.status(201).json({
      message: autoVerified
        ? "Registration successful. You can now log in."
        : "Registration successful. Please verify your email to log in.",
      userId,
      autoVerified,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "EMAIL_EXISTS") {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }
    logger.error(err, "Registration failed");
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred";
    res.status(500).json({ error: `Registration failed: ${message}` });
  }
}

/**
 * POST /api/auth/login
 *
 * Authenticates user with email + password, sets JWT cookies.
 */
export async function handleLogin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map((e) => e.message).join(". ");
      res.status(400).json({ error: messages });
      return;
    }

    const { email, password } = parsed.data;
    const result = await loginUser(email, password);

    if (result.requiresMfa) {
      res.json({ requiresMfa: true, mfaSessionToken: result.mfaSessionToken });
      return;
    }

    const tokens = await generateTokens(result.user);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    logger.info({ userId: result.user.userId }, "User logged in");
    res.json({ user: result.user });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "INVALID_CREDENTIALS":
          res.status(401).json({ error: "Invalid email or password." });
          return;
        case "EMAIL_NOT_VERIFIED":
          res.status(403).json({ error: "Please verify your email before logging in." });
          return;
        case "ACCOUNT_SUSPENDED":
          res.status(403).json({ error: "Your account has been suspended." });
          return;
        case "ACCOUNT_CANCELLED":
          res.status(403).json({ error: "Your account has been cancelled." });
          return;
      }
    }
    logger.error(err, "Login error");
    next(err);
  }
}

/**
 * POST /api/auth/logout
 *
 * Revokes the refresh token and clears auth cookies.
 */
export async function handleLogout(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const rawRefreshToken = req.cookies?.refresh_token;
    if (rawRefreshToken) {
      await revokeRefreshToken(rawRefreshToken);
    }
    clearAuthCookies(res);
    res.json({ message: "Logged out successfully." });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/refresh
 *
 * Uses the refresh token cookie to issue a new access token.
 */
export async function handleRefresh(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const rawRefreshToken = req.cookies?.refresh_token;
    if (!rawRefreshToken) {
      res.status(401).json({ error: "No refresh token provided." });
      return;
    }

    const { accessToken, user: authUser } = await refreshAccessToken(rawRefreshToken);

    setAuthCookies(res, accessToken, rawRefreshToken);

    res.json({ user: authUser });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (
        err.message === "INVALID_REFRESH_TOKEN" ||
        err.message === "REFRESH_TOKEN_EXPIRED"
      ) {
        // Do NOT clear cookies here — the access_token may still be valid
        // and the client needs it for the verification call to /api/auth/me.
        // Cookies expire naturally via maxAge. Only explicit logout clears them.
        res.status(401).json({ error: "Session expired. Please log in again." });
        return;
      }
    }
    next(err);
  }
}

/**
 * GET /api/auth/me
 *
 * Returns the current authenticated user. Requires the `authenticate`
 * middleware to have already populated `req.user`.
 */
export async function handleGetMe(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tokenUser = (req as any).user;
    if (!tokenUser) {
      res.status(401).json({ error: "Not authenticated." });
      return;
    }

    const authUser = await getUserWithRolesAndPermissions(tokenUser.sub);
    res.json({ user: authUser });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/auth/verify-email?token=xxx
 *
 * Verifies the user's email address using the token from the verification link.
 */
export async function handleVerifyEmail(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const token = req.query.token;
    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "Verification token is required." });
      return;
    }

    await verifyEmail(token);
    res.json({ message: "Email verified successfully. You can now log in." });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "INVALID_TOKEN":
          res.status(400).json({ error: "Invalid verification token." });
          return;
        case "TOKEN_ALREADY_USED":
          res.status(400).json({ error: "This verification link has already been used." });
          return;
        case "TOKEN_EXPIRED":
          res.status(400).json({ error: "This verification link has expired. Please request a new one." });
          return;
      }
    }
    next(err);
  }
}

/**
 * POST /api/auth/resend-verification
 *
 * Resends a verification email to the specified address.
 */
export async function handleResendVerification(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "Email is required." });
      return;
    }

    await resendVerification(email);
    // Always return success to avoid revealing whether the email exists
    res.json({ message: "If an account exists with this email, a verification link has been sent." });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "ALREADY_VERIFIED") {
      res.status(400).json({ error: "This email is already verified." });
      return;
    }
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Password Reset handlers
// ---------------------------------------------------------------------------

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

/**
 * POST /api/auth/forgot-password
 *
 * Initiates a password reset flow. Always returns success to prevent
 * email enumeration.
 */
export async function handleForgotPassword(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = ForgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map((e) => e.message).join(". ");
      res.status(400).json({ error: messages });
      return;
    }

    await requestPasswordReset(parsed.data.email);
    res.json({ success: true, message: "If that email is registered, a reset link has been sent." });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/reset-password
 *
 * Resets the user's password using a valid reset token.
 */
export async function handleResetPassword(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = ResetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map((e) => e.message).join(". ");
      res.status(400).json({ error: messages });
      return;
    }

    await resetPassword(parsed.data.token, parsed.data.newPassword);
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Invalid or expired reset token") {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// ---------------------------------------------------------------------------
// OAuth handlers
// ---------------------------------------------------------------------------

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

/** GET /api/auth/google — Redirects to Google OAuth consent screen. */
export function handleGoogleRedirect(_req: Request, res: Response) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    res.redirect(`${CLIENT_URL}/login?error=oauth_not_configured`);
    return;
  }
  res.redirect(getGoogleAuthUrl());
}

/** GET /api/auth/google/callback — Handles Google OAuth callback. */
export async function handleGoogleCallback(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const code = req.query.code;
    if (!code || typeof code !== "string") {
      res.redirect(`${CLIENT_URL}/login?error=oauth_failed`);
      return;
    }

    const authUser = await handleOAuthCallback("google", code);
    const tokens = await generateTokens(authUser);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    logger.info({ userId: authUser.userId }, "User logged in via Google");
    res.redirect(`${CLIENT_URL}/chat/new`);
  } catch (err) {
    logger.error(err, "Google OAuth callback failed");
    res.redirect(`${CLIENT_URL}/login?error=oauth_failed`);
  }
}

/** GET /api/auth/microsoft — Redirects to Microsoft OAuth authorization. */
export function handleMicrosoftRedirect(_req: Request, res: Response) {
  if (!process.env.MICROSOFT_CLIENT_ID) {
    res.redirect(`${CLIENT_URL}/login?error=oauth_not_configured`);
    return;
  }
  res.redirect(getMicrosoftAuthUrl());
}

/** GET /api/auth/microsoft/callback — Handles Microsoft OAuth callback. */
export async function handleMicrosoftCallback(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const code = req.query.code;
    if (!code || typeof code !== "string") {
      res.redirect(`${CLIENT_URL}/login?error=oauth_failed`);
      return;
    }

    const authUser = await handleOAuthCallback("microsoft", code);
    const tokens = await generateTokens(authUser);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    logger.info({ userId: authUser.userId }, "User logged in via Microsoft");
    res.redirect(`${CLIENT_URL}/chat/new`);
  } catch (err) {
    logger.error(err, "Microsoft OAuth callback failed");
    res.redirect(`${CLIENT_URL}/login?error=oauth_failed`);
  }
}

// ---------------------------------------------------------------------------
// MFA handlers
// ---------------------------------------------------------------------------

/** POST /api/auth/mfa/setup — Generates a TOTP secret and QR code. */
export async function handleMfaSetup(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.user?.sub;
    if (!userId) { res.status(401).json({ error: "Not authenticated." }); return; }

    const result = await generateMfaSecret(userId);
    res.json({ secret: result.secret, qrCodeDataUrl: result.qrCodeDataUrl });
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/mfa/enable — Verifies first TOTP code and enables MFA. */
export async function handleMfaEnable(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.user?.sub;
    if (!userId) { res.status(401).json({ error: "Not authenticated." }); return; }

    const { token } = req.body;
    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "TOTP code is required." });
      return;
    }

    await enableMfa(userId, token);
    res.json({ message: "MFA enabled successfully." });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "INVALID_MFA_CODE") {
      res.status(400).json({ error: "Invalid code. Please try again." });
      return;
    }
    next(err);
  }
}

/** POST /api/auth/mfa/disable — Disables MFA for the current user. */
export async function handleMfaDisable(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.user?.sub;
    if (!userId) { res.status(401).json({ error: "Not authenticated." }); return; }

    await disableMfa(userId);
    res.json({ message: "MFA disabled." });
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/mfa/verify — Completes MFA verification during login. */
export async function handleMfaVerify(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { mfaSessionToken, code } = req.body;
    if (!mfaSessionToken || !code) {
      res.status(400).json({ error: "MFA session token and code are required." });
      return;
    }

    const authUser = await completeMfaLogin(mfaSessionToken, code);
    const tokens = await generateTokens(authUser);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    logger.info({ userId: authUser.userId }, "User completed MFA login");
    res.json({ user: authUser });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "INVALID_MFA_SESSION") {
        res.status(401).json({ error: "MFA session expired. Please log in again." });
        return;
      }
      if (err.message === "INVALID_MFA_CODE") {
        res.status(400).json({ error: "Invalid code. Please try again." });
        return;
      }
    }
    next(err);
  }
}

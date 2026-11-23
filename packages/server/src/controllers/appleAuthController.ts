/**
 * @module controllers/appleAuthController
 *
 * Sign in with Apple, native flow only: the phone gets an identity token from iOS and posts it here. Every
 * failure answers `{ error, code }` (the shared ApiErrorBody) so the phone branches on the code.
 */

import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import pino from "pino";
import { AuthError, generateTokens, getSignInTime, type MfaChangeProof } from "../services/authService.js";
import { linkAppleToUser, signInWithApple } from "../services/appleSignInService.js";
import { setAuthCookies } from "./authController.js";
import { presentedRefreshToken } from "../utils/presentedRefreshToken.js";

const logger = pino({ name: "appleAuthController" });

const AppleBodySchema = z.object({
  identityToken: z.string().min(1).max(4096),
  nonce: z.string().min(16).max(256),
  authorizationCode: z.string().min(1).max(2048).optional(),
  givenName: z.string().max(100).optional(),
  familyName: z.string().max(100).optional(),
});

const LinkBodySchema = AppleBodySchema.extend({
  password: z.string().max(1000).optional(),
  mfaCode: z.string().max(20).optional(),
});

// ESM module mocks can make `instanceof` fail for genuine instances, so the name is checked as well
// (the same reason authController does).
const isAuthError = (err: unknown): err is AuthError =>
  err instanceof AuthError || (err instanceof Error && err.name === "AuthError");

function sendError(res: Response, status: number, error: string, code: string) {
  res.status(status).json({ error, code });
}

function handleFailure(err: unknown, res: Response, next: NextFunction, what: string) {
  if (isAuthError(err)) {
    sendError(res, err.statusCode, err.message, err.code);
    return;
  }
  logger.error(err, `${what} failed`);
  next(err);
}

/**
 * POST /api/auth/apple/idtoken
 *
 * Request: { identityToken, nonce, authorizationCode?, givenName?, familyName? }
 * Response: { user, tokens: { accessToken, refreshToken } } — the same shape as `/login` and `/google/idtoken`.
 */
export async function handleAppleIdToken(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = AppleBodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, parsed.error.errors.map((e) => e.message).join(". "), "VALIDATION");
      return;
    }

    const authUser = await signInWithApple(parsed.data);
    const tokens = await generateTokens(authUser);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    logger.info({ userId: authUser.userId }, "User logged in via Apple");
    res.json({ user: authUser, tokens: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken } });
  } catch (err) {
    handleFailure(err, res, next, "Apple sign-in");
  }
}

/**
 * POST /api/auth/apple/link — a signed-in person adds Sign in with Apple to their account.
 * Request: the sign-in body plus `password` (accounts that have one) and `mfaCode` (accounts with MFA on).
 */
export async function handleAppleLink(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      sendError(res, 401, "Not authenticated.", "UNAUTHENTICATED");
      return;
    }
    const parsed = LinkBodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, parsed.error.errors.map((e) => e.message).join(". "), "VALIDATION");
      return;
    }

    const { password, mfaCode, ...apple } = parsed.data;
    const proof: MfaChangeProof = { password, mfaCode };
    const signedInAt = await getSignInTime(presentedRefreshToken(req), userId);
    await linkAppleToUser(userId, apple, proof, signedInAt);

    logger.info({ userId }, "Apple sign-in linked to account");
    res.json({ linked: true });
  } catch (err) {
    handleFailure(err, res, next, "Apple link");
  }
}

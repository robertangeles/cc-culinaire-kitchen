/**
 * @module services/authService
 *
 * Core authentication service handling user registration, login,
 * JWT token generation/verification, and session management.
 */

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { generateSecret as otpGenerateSecret, generateURI, verify as otpVerify } from "otplib";
import QRCode from "qrcode";
import { eq, and, or } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  user,
  role,
  userRole,
  permission,
  rolePermission,
  refreshToken,
  emailVerification,
  oauthAccount,
  passwordReset,
} from "../db/schema.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "./emailService.js";
import { encryptUserPii, decryptUserPii, hashForLookup } from "./piiService.js";
import { getAllSettings } from "./settingsService.js";

const DEFAULT_REGISTERED_SESSIONS = 10;

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? "12", 10);
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "dev-access-secret";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret";
const ACCESS_EXPIRY = "1h";
const REFRESH_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MFA_SESSION_SECRET = process.env.JWT_ACCESS_SECRET ?? "dev-mfa-secret";

/** Shape of the JWT access token payload. */
export interface TokenPayload {
  sub: number;
  roles: string[];
  permissions: string[];
}

/** User data returned to the client after login / getMe. */
export interface AuthUser {
  userId: number;
  userName: string;
  userEmail: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  userPhotoPath: string | null;
  freeSessions: number;
  subscriptionStatus: string;
  subscriptionTier: string;
  userStatus: string;
  roles: string[];
  permissions: string[];
}

/**
 * Registers a new user with hashed password and assigns the Subscriber role.
 * Returns the new user's ID.
 */
export async function registerUser(
  name: string,
  email: string,
  password: string,
): Promise<number> {
  // Check for existing email
  const existing = await db
    .select({ userId: user.userId })
    .from(user)
    .where(eq(user.userEmail, email.toLowerCase()));

  if (existing.length > 0) {
    throw new Error("EMAIL_EXISTS");
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Read default free sessions from site settings
  let defaultFreeSessions = DEFAULT_REGISTERED_SESSIONS;
  try {
    const settings = await getAllSettings();
    const val = parseInt(settings.default_registered_sessions ?? "", 10);
    if (Number.isFinite(val) && val > 0) defaultFreeSessions = val;
  } catch { /* use hardcoded default */ }

  const piiData = encryptUserPii({
    userName: name,
    userEmail: email.toLowerCase(),
  });

  const [newUser] = await db
    .insert(user)
    .values({
      userName: name,
      userEmail: email.toLowerCase(),
      userPasswordHash: passwordHash,
      freeSessions: defaultFreeSessions,
      ...piiData,
    })
    .returning({ userId: user.userId });

  // Assign default Subscriber role
  const [subscriberRole] = await db
    .select({ roleId: role.roleId })
    .from(role)
    .where(eq(role.roleName, "Subscriber"));

  if (subscriberRole) {
    await db.insert(userRole).values({
      userId: newUser.userId,
      roleId: subscriberRole.roleId,
    });
  }

  // Auto-verify in development when email service is not configured
  if (!process.env.RESEND_API_KEY) {
    await db
      .update(user)
      .set({ emailVerifiedInd: true, updatedDttm: new Date() })
      .where(eq(user.userId, newUser.userId));

    return newUser.userId;
  }

  // Generate verification token and send email
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await db.insert(emailVerification).values({
    userId: newUser.userId,
    verificationToken: token,
    expiresAtDttm: expiresAt,
  });

  try {
    await sendVerificationEmail(email, name, token);
  } catch {
    // Don't fail registration if email sending fails
    // User can resend verification later
  }

  return newUser.userId;
}

/** Result of loginUser: either a full user or an MFA challenge. */
export type LoginResult =
  | { requiresMfa: false; user: AuthUser }
  | { requiresMfa: true; mfaSessionToken: string };

/**
 * Validates credentials and returns the authenticated user with roles
 * and permissions, or an MFA challenge if MFA is enabled.
 */
export async function loginUser(
  email: string,
  password: string,
): Promise<LoginResult> {
  // Use hash-based lookup if hash column is populated, fall back to plaintext
  const emailHash = hashForLookup(email);
  const [row] = await db
    .select()
    .from(user)
    .where(
      or(
        eq(user.userEmailHash, emailHash),
        eq(user.userEmail, email.toLowerCase()),
      ),
    );

  if (!row || !row.userPasswordHash) {
    throw new Error("INVALID_CREDENTIALS");
  }

  const passwordValid = await bcrypt.compare(password, row.userPasswordHash);
  if (!passwordValid) {
    throw new Error("INVALID_CREDENTIALS");
  }

  if (!row.emailVerifiedInd) {
    throw new Error("EMAIL_NOT_VERIFIED");
  }

  if (row.userStatus === "suspended") {
    throw new Error("ACCOUNT_SUSPENDED");
  }

  if (row.userStatus === "cancelled") {
    throw new Error("ACCOUNT_CANCELLED");
  }

  // If MFA is enabled, return a temporary session token instead of full auth
  if (row.mfaEnabledInd) {
    const mfaSessionToken = jwt.sign(
      { sub: row.userId, purpose: "mfa" },
      MFA_SESSION_SECRET,
      { expiresIn: "5m" },
    );
    return { requiresMfa: true, mfaSessionToken };
  }

  const authUser = await getUserWithRolesAndPermissions(row.userId);
  return { requiresMfa: false, user: authUser };
}

/**
 * Fetches a user record with their roles and permissions populated.
 */
export async function getUserWithRolesAndPermissions(
  userId: number,
): Promise<AuthUser> {
  const [row] = await db
    .select({
      userId: user.userId,
      userName: user.userName,
      userEmail: user.userEmail,
      emailVerifiedInd: user.emailVerifiedInd,
      mfaEnabledInd: user.mfaEnabledInd,
      userPhotoPath: user.userPhotoPath,
      freeSessions: user.freeSessions,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionTier: user.subscriptionTier,
      userStatus: user.userStatus,
      userNameEnc: user.userNameEnc,
      userNameIv: user.userNameIv,
      userNameTag: user.userNameTag,
      userEmailEnc: user.userEmailEnc,
      userEmailIv: user.userEmailIv,
      userEmailTag: user.userEmailTag,
    })
    .from(user)
    .where(eq(user.userId, userId));
  if (!row) throw new Error("USER_NOT_FOUND");

  // Decrypt PII fields (falls back to plaintext if encrypted values not yet populated)
  const pii = decryptUserPii(row as unknown as Record<string, unknown>);

  // Fetch roles
  const userRoles = await db
    .select({ roleName: role.roleName })
    .from(userRole)
    .innerJoin(role, eq(userRole.roleId, role.roleId))
    .where(eq(userRole.userId, userId));

  const roleNames = userRoles.map((r) => r.roleName);

  // Fetch permissions via roles
  const roleIds = await db
    .select({ roleId: userRole.roleId })
    .from(userRole)
    .where(eq(userRole.userId, userId));

  let permKeys: string[] = [];
  if (roleIds.length > 0) {
    const perms = await db
      .select({ permissionKey: permission.permissionKey })
      .from(rolePermission)
      .innerJoin(permission, eq(rolePermission.permissionId, permission.permissionId))
      .where(
        // drizzle-orm inArray would be cleaner but we keep it simple
        eq(rolePermission.roleId, roleIds[0].roleId),
      );

    // If user has multiple roles, fetch all permissions
    if (roleIds.length > 1) {
      for (let i = 1; i < roleIds.length; i++) {
        const morePerms = await db
          .select({ permissionKey: permission.permissionKey })
          .from(rolePermission)
          .innerJoin(permission, eq(rolePermission.permissionId, permission.permissionId))
          .where(eq(rolePermission.roleId, roleIds[i].roleId));
        perms.push(...morePerms);
      }
    }

    permKeys = [...new Set(perms.map((p) => p.permissionKey))];
  }

  return {
    userId: row.userId,
    userName: pii.userName,
    userEmail: pii.userEmail,
    emailVerified: row.emailVerifiedInd,
    mfaEnabled: row.mfaEnabledInd,
    userPhotoPath: row.userPhotoPath,
    freeSessions: row.freeSessions,
    subscriptionStatus: row.subscriptionStatus,
    subscriptionTier: row.subscriptionTier,
    userStatus: row.userStatus,
    roles: roleNames,
    permissions: permKeys,
  };
}

/**
 * Generates a JWT access token and a refresh token.
 * The refresh token hash is stored in the database for revocation support.
 */
export async function generateTokens(authUser: AuthUser) {
  const payload: TokenPayload = {
    sub: authUser.userId,
    roles: authUser.roles,
    permissions: authUser.permissions,
  };

  const accessToken = jwt.sign(payload, ACCESS_SECRET, {
    expiresIn: ACCESS_EXPIRY,
  });

  const rawRefreshToken = crypto.randomBytes(64).toString("hex");
  const tokenHash = crypto
    .createHash("sha256")
    .update(rawRefreshToken)
    .digest("hex");

  const expiresAt = new Date(Date.now() + REFRESH_EXPIRY_MS);

  await db.insert(refreshToken).values({
    userId: authUser.userId,
    tokenHash,
    expiresAtDttm: expiresAt,
  });

  return { accessToken, refreshToken: rawRefreshToken };
}

/**
 * Verifies a refresh token and issues a new access token.
 * Returns the new access token and the auth user data.
 */
export async function refreshAccessToken(rawToken: string) {
  const tokenHash = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  const [stored] = await db
    .select()
    .from(refreshToken)
    .where(eq(refreshToken.tokenHash, tokenHash));

  if (!stored) {
    throw new Error("INVALID_REFRESH_TOKEN");
  }

  if (stored.expiresAtDttm < new Date()) {
    // Clean up expired token
    await db
      .delete(refreshToken)
      .where(eq(refreshToken.refreshTokenId, stored.refreshTokenId));
    throw new Error("REFRESH_TOKEN_EXPIRED");
  }

  const authUser = await getUserWithRolesAndPermissions(stored.userId);

  const payload: TokenPayload = {
    sub: authUser.userId,
    roles: authUser.roles,
    permissions: authUser.permissions,
  };

  const accessToken = jwt.sign(payload, ACCESS_SECRET, {
    expiresIn: ACCESS_EXPIRY,
  });

  return { accessToken, user: authUser };
}

/**
 * Revokes a refresh token by deleting its hash from the database.
 */
export async function revokeRefreshToken(rawToken: string) {
  const tokenHash = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  await db.delete(refreshToken).where(eq(refreshToken.tokenHash, tokenHash));
}

/**
 * Verifies a JWT access token and returns the decoded payload.
 */
export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as unknown as TokenPayload;
}

/**
 * Verifies a user's email using the verification token.
 * Marks the token as used and sets emailVerifiedInd = true.
 */
export async function verifyEmail(token: string): Promise<void> {
  const [row] = await db
    .select()
    .from(emailVerification)
    .where(eq(emailVerification.verificationToken, token));

  if (!row) {
    throw new Error("INVALID_TOKEN");
  }

  if (row.usedInd) {
    throw new Error("TOKEN_ALREADY_USED");
  }

  if (row.expiresAtDttm < new Date()) {
    throw new Error("TOKEN_EXPIRED");
  }

  // Mark token as used
  await db
    .update(emailVerification)
    .set({ usedInd: true })
    .where(eq(emailVerification.emailVerificationId, row.emailVerificationId));

  // Mark user as verified
  await db
    .update(user)
    .set({ emailVerifiedInd: true, updatedDttm: new Date() })
    .where(eq(user.userId, row.userId));
}

/**
 * Resends a verification email to a user who hasn't verified yet.
 */
export async function resendVerification(email: string): Promise<void> {
  const [row] = await db
    .select()
    .from(user)
    .where(eq(user.userEmail, email.toLowerCase()));

  if (!row) {
    // Don't reveal whether email exists
    return;
  }

  if (row.emailVerifiedInd) {
    throw new Error("ALREADY_VERIFIED");
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db.insert(emailVerification).values({
    userId: row.userId,
    verificationToken: token,
    expiresAtDttm: expiresAt,
  });

  await sendVerificationEmail(email, row.userName, token);
}

// ---------------------------------------------------------------------------
// Password Reset
// ---------------------------------------------------------------------------

/**
 * Initiates a password reset flow by generating a token and sending an email.
 * Silently returns if the email is not found (to prevent email enumeration).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const [row] = await db
    .select()
    .from(user)
    .where(eq(user.userEmail, email.toLowerCase()));

  if (!row) return;

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db.insert(passwordReset).values({
    userId: row.userId,
    resetToken: token,
    expiresAtDttm: expiresAt,
  });

  try {
    await sendPasswordResetEmail(email, row.userName, token);
  } catch {
    // Don't fail the request if email sending fails
  }
}

/**
 * Resets a user's password using a valid reset token.
 * Invalidates all refresh tokens to force re-login on other devices.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<void> {
  const [row] = await db
    .select()
    .from(passwordReset)
    .where(eq(passwordReset.resetToken, token));

  if (!row || row.usedInd || row.expiresAtDttm < new Date()) {
    throw new Error("Invalid or expired reset token");
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  await db
    .update(user)
    .set({ userPasswordHash: passwordHash, updatedDttm: new Date() })
    .where(eq(user.userId, row.userId));

  await db
    .update(passwordReset)
    .set({ usedInd: true })
    .where(eq(passwordReset.passwordResetId, row.passwordResetId));

  await db
    .delete(refreshToken)
    .where(eq(refreshToken.userId, row.userId));
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

// Lazy getters so that DB-hydrated process.env values are picked up at call
// time rather than module-load time (when they may not yet be set).
function getGoogleClientId() { return process.env.GOOGLE_CLIENT_ID ?? ""; }
function getGoogleClientSecret() { return process.env.GOOGLE_CLIENT_SECRET ?? ""; }
function getGoogleCallbackUrl() { return process.env.GOOGLE_CALLBACK_URL ?? "http://localhost:3009/api/auth/google/callback"; }
/** Builds the Google OAuth consent URL. */
export function getGoogleAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    redirect_uri: getGoogleCallbackUrl(),
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

interface OAuthUserInfo {
  providerId: string;
  email: string;
  name: string;
  photo?: string;
}

/**
 * Exchanges a Google OAuth code for user info.
 */
async function getGoogleUserInfo(code: string): Promise<OAuthUserInfo> {
  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: getGoogleClientId(),
      client_secret: getGoogleClientSecret(),
      redirect_uri: getGoogleCallbackUrl(),
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokens.access_token) throw new Error("OAUTH_TOKEN_FAILED");

  // Fetch user profile
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await profileRes.json();

  return {
    providerId: profile.id,
    email: profile.email,
    name: profile.name ?? profile.email,
    photo: profile.picture,
  };
}

/**
 * Handles OAuth callback: finds or creates the user, links the OAuth
 * provider, and returns the AuthUser for token generation.
 *
 * Web flow only — accepts the OAuth `code` from the browser redirect,
 * exchanges it for a profile via {@link getGoogleUserInfo}, then delegates
 * to {@link findOrCreateOAuthUser} (shared with the mobile ID token flow).
 */
export async function handleOAuthCallback(
  provider: "google",
  code: string,
): Promise<AuthUser> {
  const info = await getGoogleUserInfo(code);
  return findOrCreateOAuthUser(provider, info);
}

/**
 * Finds an existing OAuth-linked user (by provider+providerId or email)
 * or creates a new one with the OAuth account linked. Used by both the
 * web OAuth code-exchange flow ({@link handleOAuthCallback}) and the
 * mobile native ID token flow ({@link verifyGoogleIdToken} +
 * `handleGoogleIdToken` controller).
 *
 * @param provider OAuth provider identifier (currently only "google")
 * @param info Profile info already verified by the caller
 * @returns The full AuthUser ready for token generation
 */
export async function findOrCreateOAuthUser(
  provider: "google",
  info: OAuthUserInfo,
): Promise<AuthUser> {
  // Check if OAuth account already linked
  const [existingOAuth] = await db
    .select()
    .from(oauthAccount)
    .where(
      and(
        eq(oauthAccount.oauthProvider, provider),
        eq(oauthAccount.oauthProviderId, info.providerId),
      ),
    );

  if (existingOAuth) {
    // Existing OAuth user — just return their profile
    return getUserWithRolesAndPermissions(existingOAuth.userId);
  }

  // Check if a user with this email already exists (hash-based or plaintext)
  const oauthEmailHash = hashForLookup(info.email);
  const [existingUser] = await db
    .select()
    .from(user)
    .where(
      or(
        eq(user.userEmailHash, oauthEmailHash),
        eq(user.userEmail, info.email.toLowerCase()),
      ),
    );

  let userId: number;

  if (existingUser) {
    // Link OAuth to existing account
    userId = existingUser.userId;

    // Mark email as verified since OAuth provider confirmed it
    if (!existingUser.emailVerifiedInd) {
      await db
        .update(user)
        .set({ emailVerifiedInd: true, updatedDttm: new Date() })
        .where(eq(user.userId, userId));
    }
  } else {
    // Create new user (no password, email auto-verified)
    const oauthPiiData = encryptUserPii({
      userName: info.name,
      userEmail: info.email.toLowerCase(),
    });

    const [newUser] = await db
      .insert(user)
      .values({
        userName: info.name,
        userEmail: info.email.toLowerCase(),
        emailVerifiedInd: true,
        userPhotoPath: info.photo ?? null,
        ...oauthPiiData,
      })
      .returning({ userId: user.userId });

    userId = newUser.userId;

    // Assign Subscriber role
    const [subscriberRole] = await db
      .select({ roleId: role.roleId })
      .from(role)
      .where(eq(role.roleName, "Subscriber"));

    if (subscriberRole) {
      await db.insert(userRole).values({
        userId,
        roleId: subscriberRole.roleId,
      });
    }
  }

  // Link OAuth account
  await db.insert(oauthAccount).values({
    userId,
    oauthProvider: provider,
    oauthProviderId: info.providerId,
  });

  return getUserWithRolesAndPermissions(userId);
}

// ---------------------------------------------------------------------------
// Google native ID token verification (mobile sign-in flow)
// ---------------------------------------------------------------------------

// Audience values for Google ID token verification.
//
// Android: tokens from `@react-native-google-signin/google-signin` carry
//   aud = the WEB client ID (when configured with `webClientId` in
//   `GoogleSignin.configure()`). The Android-type OAuth client ID exists
//   in Google Cloud Console only — it authorises the app to call Google
//   Play Services, but is NEVER the audience of any ID token. So we do
//   not include `GOOGLE_ANDROID_CLIENT_ID` here.
//
// iOS: tokens carry aud = the iOS client ID when `iosClientId` is
//   configured. So `GOOGLE_IOS_CLIENT_ID` IS a valid audience.
//
// Web: the existing browser OAuth code-exchange flow continues to use
//   `GOOGLE_CLIENT_ID` (the same value as the audience for Android
//   tokens above).
//
// IMPORTANT: read these via getter functions, not module-level consts.
// `hydrateEnvFromCredentials()` (called from index.ts at startup) populates
// `process.env` from the encrypted DB AFTER all imports have resolved. A
// const captured at module-load time would be `undefined` forever, even
// after env is later populated. The existing `getGoogleClientId()` helper
// at the top of this file uses the same pattern for the same reason.
function getGoogleWebClientId() { return process.env.GOOGLE_CLIENT_ID; }
function getGoogleIosClientId() { return process.env.GOOGLE_IOS_CLIENT_ID; }

const googleIdTokenClient = new OAuth2Client();

/**
 * Verifies a Google ID token (from a native mobile Google Sign-In SDK)
 * and returns the user profile in the same shape `findOrCreateOAuthUser`
 * expects.
 *
 * @throws Error("OAUTH_NOT_CONFIGURED") if no Google client IDs are set
 * @throws Error("INVALID_ID_TOKEN") if the token fails verification
 * @throws Error("EMAIL_NOT_VERIFIED_BY_GOOGLE") if Google reports the
 *   account email is not verified
 */
export async function verifyGoogleIdToken(idToken: string): Promise<OAuthUserInfo> {
  const audience = [
    getGoogleWebClientId(), // Android tokens use this as their aud
    getGoogleIosClientId(), // iOS tokens use this as their aud
  ].filter((x): x is string => Boolean(x));

  if (audience.length === 0) {
    throw new Error("OAUTH_NOT_CONFIGURED");
  }

  let ticket;
  try {
    ticket = await googleIdTokenClient.verifyIdToken({ idToken, audience });
  } catch {
    throw new Error("INVALID_ID_TOKEN");
  }

  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new Error("INVALID_ID_TOKEN");
  }
  if (payload.email_verified === false) {
    throw new Error("EMAIL_NOT_VERIFIED_BY_GOOGLE");
  }

  return {
    providerId: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email,
    photo: payload.picture,
  };
}

// ---------------------------------------------------------------------------
// MFA / TOTP
// ---------------------------------------------------------------------------

/**
 * Generates a new TOTP secret for MFA setup. Returns the secret,
 * the otpauth URL, and a data URL for the QR code image.
 */
export async function generateMfaSecret(userId: number) {
  const [row] = await db.select().from(user).where(eq(user.userId, userId));
  if (!row) throw new Error("USER_NOT_FOUND");

  const secret = otpGenerateSecret();
  const otpauthUrl = generateURI({ secret, issuer: "CulinAIre Kitchen", label: row.userEmail });
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  // Store secret temporarily (not yet enabled)
  await db
    .update(user)
    .set({ mfaSecret: secret, updatedDttm: new Date() })
    .where(eq(user.userId, userId));

  return { secret, otpauthUrl, qrCodeDataUrl };
}

/**
 * Verifies a TOTP code against the user's stored MFA secret.
 */
export async function verifyMfaToken(userId: number, token: string): Promise<boolean> {
  const [row] = await db.select().from(user).where(eq(user.userId, userId));
  if (!row || !row.mfaSecret) return false;
  const result = await otpVerify({ token, secret: row.mfaSecret });
  return result.valid;
}

/**
 * Enables MFA after verifying the first TOTP code.
 */
export async function enableMfa(userId: number, token: string): Promise<void> {
  const valid = await verifyMfaToken(userId, token);
  if (!valid) throw new Error("INVALID_MFA_CODE");

  await db
    .update(user)
    .set({ mfaEnabledInd: true, updatedDttm: new Date() })
    .where(eq(user.userId, userId));
}

/**
 * Disables MFA and clears the stored secret.
 */
export async function disableMfa(userId: number): Promise<void> {
  await db
    .update(user)
    .set({ mfaEnabledInd: false, mfaSecret: null, updatedDttm: new Date() })
    .where(eq(user.userId, userId));
}

/**
 * Completes MFA verification during login.
 * Validates the TOTP code against the mfaSessionToken, then returns
 * the full AuthUser for token generation.
 */
export async function completeMfaLogin(
  mfaSessionToken: string,
  totpCode: string,
): Promise<AuthUser> {
  let decoded: { sub: number; purpose: string };
  try {
    decoded = jwt.verify(mfaSessionToken, MFA_SESSION_SECRET) as unknown as typeof decoded;
  } catch {
    throw new Error("INVALID_MFA_SESSION");
  }

  if (decoded.purpose !== "mfa") throw new Error("INVALID_MFA_SESSION");

  const valid = await verifyMfaToken(decoded.sub, totpCode);
  if (!valid) throw new Error("INVALID_MFA_CODE");

  return getUserWithRolesAndPermissions(decoded.sub);
}

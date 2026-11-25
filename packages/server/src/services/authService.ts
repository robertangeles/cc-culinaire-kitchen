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
import { eq, and, or, lt, sql, desc, asc } from "drizzle-orm";
import { db } from "../db/index.js";
import { ADVISORY_LOCK_KEYS } from "../db/advisoryLockKeys.js";
import type { DbOrTx } from "./auditService.js";
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
import { removeSignedOutDeviceTokens } from "./pushDeviceService.js";
import { takeStep } from "./mfaUsedSteps.js";

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

const DEFAULT_REGISTERED_SESSIONS = 10;

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? "12", 10);

// JWT secrets MUST be read at call time, never captured at module load. ESM
// evaluates this module before index.ts runs applyEnvPrefix(), so a top-level
// `const X = process.env.JWT_ACCESS_SECRET` would capture the "dev-*" fallback
// and silently ignore DEV_JWT_ACCESS_SECRET from .env in local dev. (Prod is
// unaffected — Render injects the unprefixed var into the environment before
// node boots.) See tasks/lessons.md #53 and wiki/decisions/single-env-file.md.
function accessSecret(): string {
  return process.env.JWT_ACCESS_SECRET ?? "dev-access-secret";
}
/**
 * Key for the 5-minute "password right, code still to come" token. Derived from the access secret
 * with a label, never the access secret itself: a token signed with the access secret would pass for
 * an access token on any route that only checks `authenticate`.
 */
function mfaSessionSecret(): string {
  return crypto.createHmac("sha256", accessSecret()).update("mfa-session-v1").digest("hex");
}
/** Key that derives a refresh token's successor from the token itself, so a retried refresh gets the same answer. */
function refreshChildSecret(): string {
  return crypto.createHmac("sha256", accessSecret()).update("refresh-child-v1").digest("hex");
}
// NB: refresh tokens are random bytes hashed in the DB (see generateTokens),
// NOT JWTs — there is intentionally no JWT_REFRESH_SECRET in use here.
const ACCESS_EXPIRY = "1h";
/** Sliding: every refresh hands out a token that lives this long from now (owner decision: 30 days). */
const REFRESH_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
/** Refresh tokens issued before rotation lived 7 days; used to date their sign-in. */
const LEGACY_REFRESH_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
/** A spent token is still honoured this long after it was spent: a reply lost on kitchen wifi, a second browser tab. */
const REFRESH_GRACE_MS = 60 * 1000;
/**
 * A spent token whose successor has not been used yet is honoured this long (a reply lost on a poor
 * connection, retried later). Past it, a spent token is a replay whatever its successor's state.
 */
const REFRESH_UNUSED_SUCCESSOR_MS = 10 * 60 * 1000;

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
    throw new AuthError("EMAIL_EXISTS", "EMAIL_EXISTS", 409);
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
    throw new AuthError("INVALID_CREDENTIALS", "INVALID_CREDENTIALS", 401);
  }

  const passwordValid = await bcrypt.compare(password, row.userPasswordHash);
  if (!passwordValid) {
    throw new AuthError("INVALID_CREDENTIALS", "INVALID_CREDENTIALS", 401);
  }

  if (!row.emailVerifiedInd) {
    throw new AuthError("EMAIL_NOT_VERIFIED", "EMAIL_NOT_VERIFIED", 403);
  }

  if (row.userStatus === "suspended") {
    throw new AuthError("ACCOUNT_SUSPENDED", "ACCOUNT_SUSPENDED", 403);
  }

  if (row.userStatus === "cancelled") {
    throw new AuthError("ACCOUNT_CANCELLED", "ACCOUNT_CANCELLED", 403);
  }

  // If MFA is enabled, return a temporary session token instead of full auth
  if (row.mfaEnabledInd) {
    return { requiresMfa: true, mfaSessionToken: createMfaSessionToken(row.userId) };
  }

  const authUser = await getUserWithRolesAndPermissions(row.userId);
  return { requiresMfa: false, user: authUser };
}

/** The 5-minute "first factor passed, code still to come" token that `/mfa/verify` exchanges for a session. */
export function createMfaSessionToken(userId: number): string {
  return jwt.sign({ sub: userId, purpose: "mfa" }, mfaSessionSecret(), { expiresIn: "5m" });
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
  if (!row) throw new AuthError("USER_NOT_FOUND", "USER_NOT_FOUND", 404);

  // Decrypt PII fields (falls back to plaintext if encrypted values not yet populated)
  const pii = decryptUserPii(row as unknown as Record<string, unknown>);

  // Fetch roles, most-privileged first (by how many permissions each role
  // actually grants — not name-based, so a newly created custom role sorts
  // correctly with no hardcoded rank list to maintain). roles[0] is relied
  // on elsewhere (e.g. UserMenu's role badge) as "this user's primary role",
  // so the order here is load-bearing, not cosmetic. Alphabetical role name
  // is only a tiebreaker for two roles with an equal permission count.
  const userRoles = await db
    .select({ roleName: role.roleName })
    .from(userRole)
    .innerJoin(role, eq(userRole.roleId, role.roleId))
    .leftJoin(rolePermission, eq(rolePermission.roleId, role.roleId))
    .where(eq(userRole.userId, userId))
    .groupBy(role.roleId, role.roleName)
    .orderBy(desc(sql`count(${rolePermission.permissionId})`), asc(role.roleName));

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

const sha256 = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

/**
 * One refresh-token writer per user at a time. Without it a revoke (reuse, suspend, logout) can miss a
 * token that a concurrent refresh commits a moment later, leaving a session alive that was meant to die.
 */
async function lockUserTokens(tx: DbOrTx, userId: number): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEYS.refreshTokenUser}::int, ${userId}::int)`);
}

/** When the user actually signed in, for a token row (tokens from before rotation carry no such column). */
function signInTimeOf(row: { signedInAtDttm: Date | null; expiresAtDttm: Date }): Date {
  return row.signedInAtDttm ?? new Date(row.expiresAtDttm.getTime() - LEGACY_REFRESH_EXPIRY_MS);
}

/**
 * Generates a JWT access token and a refresh token: a new sign-in, so a new token family.
 * The refresh token hash is stored in the database for revocation support.
 * `signedInAt` and `familyId` are for re-minting inside an existing session: without resetting "recently signed in",
 * and as the same sign-in, so what is tied to it (a push device token) stays tied.
 */
export async function generateTokens(authUser: AuthUser, opts: { signedInAt?: Date; familyId?: string } = {}) {
  const payload: TokenPayload = {
    sub: authUser.userId,
    roles: authUser.roles,
    permissions: authUser.permissions,
  };

  const accessToken = jwt.sign(payload, accessSecret(), {
    expiresIn: ACCESS_EXPIRY,
  });

  const rawRefreshToken = crypto.randomBytes(64).toString("hex");
  const now = new Date();

  await db.transaction(async (tx) => {
    await lockUserTokens(tx, authUser.userId);
    await tx.insert(refreshToken).values({
      userId: authUser.userId,
      tokenHash: sha256(rawRefreshToken),
      expiresAtDttm: new Date(now.getTime() + REFRESH_EXPIRY_MS),
      signedInAtDttm: opts.signedInAt ?? now,
      familyId: opts.familyId,
    });
    await tx.delete(refreshToken).where(and(eq(refreshToken.userId, authUser.userId), lt(refreshToken.expiresAtDttm, now)));
  });
  await removeSignedOutDeviceTokens(authUser.userId);

  return { accessToken, refreshToken: rawRefreshToken };
}

type RefreshVerdict =
  | { kind: "ok"; userId: number; refreshToken: string }
  | { kind: "invalid" | "expired" | "reused" | "suspended" | "cancelled" };

/**
 * Exchanges a refresh token for a new access token AND a new refresh token (rotation, 30-day sliding).
 *
 * The successor is derived from the presented token (HMAC), so the same token always yields the same
 * successor: a refresh whose reply was lost, or two browser tabs refreshing at once, converge on one chain
 * instead of forking it. A spent token is honoured for a short grace window, or a few minutes while its
 * successor is unused; after that it is a replay, and the whole sign-in (token family) is revoked.
 */
export async function refreshAccessToken(rawToken: string) {
  const tokenHash = sha256(rawToken);

  // Whose rows are we about to touch? Read once to know whom to lock, then re-read under the lock.
  const [peek] = await db.select({ userId: refreshToken.userId }).from(refreshToken).where(eq(refreshToken.tokenHash, tokenHash));
  if (!peek) throw new AuthError("INVALID_REFRESH_TOKEN", "INVALID_REFRESH_TOKEN", 401);

  // The verdict is returned, not thrown, so what the transaction deleted (an expired row, a revoked
  // family) is committed rather than rolled back with the error.
  const verdict: RefreshVerdict = await db.transaction(async (tx): Promise<RefreshVerdict> => {
    await lockUserTokens(tx, peek.userId);
    const now = new Date();

    const [stored] = await tx.select().from(refreshToken).where(eq(refreshToken.tokenHash, tokenHash));
    if (!stored) return { kind: "invalid" };

    if (stored.expiresAtDttm < now) {
      await tx.delete(refreshToken).where(eq(refreshToken.refreshTokenId, stored.refreshTokenId));
      return { kind: "expired" };
    }

    const [account] = await tx.select({ status: user.userStatus }).from(user).where(eq(user.userId, stored.userId));
    if (account?.status === "suspended" || account?.status === "cancelled") {
      await tx.delete(refreshToken).where(eq(refreshToken.userId, stored.userId));
      return { kind: account.status };
    }

    const childRaw = crypto.createHmac("sha256", refreshChildSecret()).update(rawToken).digest("hex");
    const childHash = sha256(childRaw);

    if (stored.rotatedAtDttm === null) {
      await tx.update(refreshToken).set({ rotatedAtDttm: now }).where(eq(refreshToken.refreshTokenId, stored.refreshTokenId));
      await tx.insert(refreshToken).values({
        userId: stored.userId,
        tokenHash: childHash,
        expiresAtDttm: new Date(now.getTime() + REFRESH_EXPIRY_MS),
        familyId: stored.familyId,
        signedInAtDttm: signInTimeOf(stored),
      });
      await tx.delete(refreshToken).where(and(eq(refreshToken.userId, stored.userId), lt(refreshToken.expiresAtDttm, now)));
      return { kind: "ok", userId: stored.userId, refreshToken: childRaw };
    }

    // A spent token: a retry (reply lost, second tab) or a replay.
    const [child] = await tx.select().from(refreshToken).where(eq(refreshToken.tokenHash, childHash));
    const sinceSpent = now.getTime() - stored.rotatedAtDttm.getTime();
    if (child && (sinceSpent <= REFRESH_GRACE_MS || (child.rotatedAtDttm === null && sinceSpent <= REFRESH_UNUSED_SUCCESSOR_MS))) {
      return { kind: "ok", userId: stored.userId, refreshToken: childRaw };
    }

    await tx.delete(refreshToken).where(eq(refreshToken.familyId, stored.familyId));
    return { kind: "reused" };
  });
  await removeSignedOutDeviceTokens(peek.userId);

  switch (verdict.kind) {
    case "invalid":
      throw new AuthError("INVALID_REFRESH_TOKEN", "INVALID_REFRESH_TOKEN", 401);
    case "expired":
      throw new AuthError("REFRESH_TOKEN_EXPIRED", "REFRESH_TOKEN_EXPIRED", 401);
    case "reused":
      throw new AuthError("REFRESH_TOKEN_REUSED", "REFRESH_TOKEN_REUSED", 401);
    case "suspended":
      throw new AuthError("ACCOUNT_SUSPENDED", "ACCOUNT_SUSPENDED", 403);
    case "cancelled":
      throw new AuthError("ACCOUNT_CANCELLED", "ACCOUNT_CANCELLED", 403);
  }

  const authUser = await getUserWithRolesAndPermissions(verdict.userId);

  const payload: TokenPayload = {
    sub: authUser.userId,
    roles: authUser.roles,
    permissions: authUser.permissions,
  };

  const accessToken = jwt.sign(payload, accessSecret(), {
    expiresIn: ACCESS_EXPIRY,
  });

  return { accessToken, refreshToken: verdict.refreshToken, user: authUser };
}

/**
 * When the sign-in that created this refresh token happened, or null if the token is
 * unknown or belongs to another user. Unlike an access token's `iat` (which resets on every silent
 * refresh) and the token's own age (rotation replaces it), this is carried unchanged along the family.
 */
export async function getSignInTime(rawToken: string | undefined, userId: number): Promise<Date | null> {
  if (!rawToken) return null;
  const [stored] = await db
    .select({ userId: refreshToken.userId, expiresAtDttm: refreshToken.expiresAtDttm, signedInAtDttm: refreshToken.signedInAtDttm })
    .from(refreshToken)
    .where(eq(refreshToken.tokenHash, sha256(rawToken)));
  if (!stored || stored.userId !== userId) return null;
  return signInTimeOf(stored);
}

/** How recently the user must have signed in when nothing but a session proves who they are. */
export const RECENT_SIGN_IN_MS = 10 * 60 * 1000;

export function isRecentSignIn(signedInAt: Date | null, now: Date = new Date()): boolean {
  return signedInAt !== null && now.getTime() - signedInAt.getTime() <= RECENT_SIGN_IN_MS;
}

/**
 * Ends the sign-in a refresh token belongs to (logout): every token of its family, not just this one,
 * so an earlier copy of the token (another tab, a stolen one) dies with it. The token only has to match a
 * stored row, expired or spent included. Returns whose sign-in it was, or undefined when no row matches.
 */
export async function revokeRefreshToken(rawToken: string): Promise<number | undefined> {
  const tokenHash = sha256(rawToken);
  const [stored] = await db
    .select({ userId: refreshToken.userId, familyId: refreshToken.familyId })
    .from(refreshToken)
    .where(eq(refreshToken.tokenHash, tokenHash));
  if (!stored) return undefined;
  await db.transaction(async (tx) => {
    await lockUserTokens(tx, stored.userId);
    await tx.delete(refreshToken).where(eq(refreshToken.familyId, stored.familyId));
  });
  return stored.userId;
}

/**
 * Ends every sign-in of a user (suspend, cancel, password reset, password change).
 * `keepFamilyId` spares the caller's own sign-in, but only its live token: spent copies of it, which
 * another holder may have, go too. Pass `tx` to make it part of the caller's transaction.
 * The push device tokens of the sign-ins that ended go once the revoke has committed; a caller that passes `tx`
 * calls `removeSignedOutDeviceTokens` itself after its transaction commits.
 */
export async function revokeAllRefreshTokens(userId: number, keepFamilyId?: string, tx?: DbOrTx) {
  const run = async (t: DbOrTx) => {
    await lockUserTokens(t, userId);
    await t
      .delete(refreshToken)
      .where(
        keepFamilyId
          ? and(eq(refreshToken.userId, userId), sql`NOT (${refreshToken.familyId} = ${keepFamilyId} AND ${refreshToken.rotatedAtDttm} IS NULL)`)
          : eq(refreshToken.userId, userId),
      );
  };
  if (tx) return run(tx);
  await db.transaction(run);
  await removeSignedOutDeviceTokens(userId);
}

/** The family of a refresh token that belongs to this user, if any. */
export async function refreshTokenFamily(rawToken: string | undefined, userId: number): Promise<string | undefined> {
  if (!rawToken) return undefined;
  const [stored] = await db
    .select({ userId: refreshToken.userId, familyId: refreshToken.familyId })
    .from(refreshToken)
    .where(eq(refreshToken.tokenHash, sha256(rawToken)));
  return stored && stored.userId === userId ? stored.familyId : undefined;
}

/**
 * Verifies a JWT access token and returns the decoded payload.
 */
export function verifyAccessToken(token: string): TokenPayload {
  const payload = jwt.verify(token, accessSecret()) as unknown as TokenPayload & { purpose?: string };
  // A token with a purpose (the MFA-pending one, in versions that signed it with this secret) is not a session.
  if (payload.purpose !== undefined) throw new jwt.JsonWebTokenError("not an access token");
  return payload;
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
    throw new AuthError("INVALID_TOKEN", "INVALID_TOKEN", 400);
  }

  if (row.usedInd) {
    throw new AuthError("TOKEN_ALREADY_USED", "TOKEN_ALREADY_USED", 400);
  }

  if (row.expiresAtDttm < new Date()) {
    throw new AuthError("TOKEN_EXPIRED", "TOKEN_EXPIRED", 400);
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
    throw new AuthError("ALREADY_VERIFIED", "ALREADY_VERIFIED", 400);
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
    throw new AuthError("Invalid or expired reset token", "INVALID_RESET_TOKEN", 400);
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

  await revokeAllRefreshTokens(row.userId);
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
  if (!tokens.access_token) throw new AuthError("OAUTH_TOKEN_FAILED", "OAUTH_TOKEN_FAILED", 502);

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
    throw new AuthError("OAUTH_NOT_CONFIGURED", "OAUTH_NOT_CONFIGURED", 503);
  }

  let ticket;
  try {
    ticket = await googleIdTokenClient.verifyIdToken({ idToken, audience });
  } catch {
    throw new AuthError("INVALID_ID_TOKEN", "INVALID_ID_TOKEN", 401);
  }

  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new AuthError("INVALID_ID_TOKEN", "INVALID_ID_TOKEN", 401);
  }
  if (payload.email_verified === false) {
    throw new AuthError("EMAIL_NOT_VERIFIED_BY_GOOGLE", "EMAIL_NOT_VERIFIED_BY_GOOGLE", 403);
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

/** What the caller must show to change two-factor settings. */
export interface MfaChangeProof {
  password?: string;
  mfaCode?: string;
}

/**
 * Two-factor settings are an account-takeover lever: a new secret locks the owner out and
 * switching MFA off removes the second factor. A session alone is therefore not enough.
 * Password accounts give their password; Google-only accounts, which have none, must have
 * signed in within the last 10 minutes; an account with MFA on also gives a current code.
 * Linking another sign-in method (Sign in with Apple) is the same kind of lever and asks for the same proof.
 */
export async function requireProofToChangeMfa(
  row: typeof user.$inferSelect,
  proof: MfaChangeProof,
  signedInAt: Date | null,
): Promise<void> {
  if (row.userPasswordHash) {
    const ok = proof.password ? await bcrypt.compare(proof.password, row.userPasswordHash) : false;
    if (!ok) throw new AuthError("Incorrect password.", "INVALID_CREDENTIALS", 403);
  } else if (!isRecentSignIn(signedInAt)) {
    throw new AuthError(
      "For your security, sign out, sign back in, and then change your two-factor settings.",
      "RECENT_SIGN_IN_REQUIRED",
      403,
    );
  }
  if (row.mfaEnabledInd) {
    if (!proof.mfaCode) throw new AuthError("Enter your authenticator code.", "MFA_REQUIRED", 403);
    if (!(await verifyMfaToken(row.userId, proof.mfaCode))) {
      throw new AuthError("That authenticator code is not valid.", "INVALID_MFA_CODE", 403);
    }
  }
}

/**
 * Generates a new TOTP secret for MFA setup. Returns the secret,
 * the otpauth URL, and a data URL for the QR code image.
 *
 * @throws {AuthError} 409 when MFA is already on (the secret is never replaced under a live
 *   account), 403 when the proof is missing or wrong.
 */
export async function generateMfaSecret(userId: number, proof: MfaChangeProof, signedInAt: Date | null) {
  const [row] = await db.select().from(user).where(eq(user.userId, userId));
  if (!row) throw new AuthError("USER_NOT_FOUND", "USER_NOT_FOUND", 404);
  if (row.mfaEnabledInd) {
    throw new AuthError(
      "Two-factor authentication is already on. Turn it off first if you want to set it up again.",
      "MFA_ALREADY_ENABLED",
      409,
    );
  }
  await requireProofToChangeMfa(row, proof, signedInAt);

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
 * Verifies a TOTP code against the user's stored MFA secret. The one check behind sign-in, changing two-factor
 * settings, linking a sign-in method and deleting an account.
 *
 * Accepts the code of the current 30-second step and of the one before it, for a code typed as the step changes or a
 * phone whose clock is a little slow. Never a future step, and never a step at or before the last one accepted from this
 * user: a code works once (`mfaUsedSteps`). Calling this with a code that is accepted uses it up.
 */
export async function verifyMfaToken(userId: number, token: string): Promise<boolean> {
  // A request body may hold anything here, and otplib throws on a malformed code.
  if (typeof token !== "string" || !/^\d{6}$/.test(token)) return false;
  const [row] = await db.select().from(user).where(eq(user.userId, userId));
  if (!row || !row.mfaSecret) return false;
  const result = await otpVerify({ token, secret: row.mfaSecret, epochTolerance: [30, 0] });
  return result.valid && "timeStep" in result && takeStep(userId, result.timeStep);
}

/**
 * Enables MFA after verifying the first TOTP code.
 */
export async function enableMfa(userId: number, token: string): Promise<void> {
  const valid = await verifyMfaToken(userId, token);
  if (!valid) throw new AuthError("INVALID_MFA_CODE", "INVALID_MFA_CODE", 401);

  await db
    .update(user)
    .set({ mfaEnabledInd: true, updatedDttm: new Date() })
    .where(eq(user.userId, userId));
}

/**
 * Disables MFA and clears the stored secret.
 *
 * @throws {AuthError} 403 when the proof is missing or wrong.
 */
export async function disableMfa(userId: number, proof: MfaChangeProof, signedInAt: Date | null): Promise<void> {
  const [row] = await db.select().from(user).where(eq(user.userId, userId));
  if (!row) throw new AuthError("USER_NOT_FOUND", "USER_NOT_FOUND", 404);
  await requireProofToChangeMfa(row, proof, signedInAt);

  await db
    .update(user)
    .set({ mfaEnabledInd: false, mfaSecret: null, updatedDttm: new Date() })
    .where(eq(user.userId, userId));
}

/**
 * The user an MFA session token belongs to, or null if it is missing, forged or expired. Only a
 * verified token may name an account: the rate limiter keys on this, and an unverified `sub`
 * would let anyone burn another user's attempts.
 */
export function mfaSessionUserId(mfaSessionToken: unknown): number | null {
  if (typeof mfaSessionToken !== "string") return null;
  try {
    const decoded = jwt.verify(mfaSessionToken, mfaSessionSecret()) as unknown as { sub: number; purpose: string };
    return decoded.purpose === "mfa" ? decoded.sub : null;
  } catch {
    return null;
  }
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
    decoded = jwt.verify(mfaSessionToken, mfaSessionSecret()) as unknown as typeof decoded;
  } catch {
    throw new AuthError("INVALID_MFA_SESSION", "INVALID_MFA_SESSION", 401);
  }

  if (decoded.purpose !== "mfa") throw new AuthError("INVALID_MFA_SESSION", "INVALID_MFA_SESSION", 401);

  const valid = await verifyMfaToken(decoded.sub, totpCode);
  if (!valid) throw new AuthError("INVALID_MFA_CODE", "INVALID_MFA_CODE", 401);

  return getUserWithRolesAndPermissions(decoded.sub);
}

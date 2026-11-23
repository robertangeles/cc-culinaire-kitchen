/**
 * @module services/appleSignInService
 *
 * What a verified Sign in with Apple identity means for an account. `appleIdentity` checks the token;
 * this decides which account it is.
 *
 * Matching, in order, and nothing else:
 *   1. Apple's subject (`sub`), the only stable id. A returning person always matches here.
 *   2. A first sign-in whose email Apple reports as verified and which matches an existing account whose own
 *      email is verified too: the Apple subject is linked to that account. A matching address on an account
 *      that never verified it is refused (ACCOUNT_EMAIL_UNVERIFIED): whoever registered it may not own it,
 *      and linking would hand them a verified account with a password they chose.
 *   3. Otherwise a new account. A private-relay address (`…@privaterelay.appleid.com`) never matches anything
 *      by email: it is a different address from the one the person registered with. Joining the two accounts
 *      is the explicit, signed-in {@link linkAppleToUser} action.
 *
 * A name is only ever sent on the very first authorization, and by the phone, not in the token; it is used
 * for a new account and nothing else.
 */

import pino from "pino";
import { and, eq, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { appleRevocationRetries, oauthAccount, role, user, userRole } from "../db/schema.js";
import { decrypt, encrypt } from "../utils/crypto.js";
import {
  AuthError,
  getUserWithRolesAndPermissions,
  requireProofToChangeMfa,
  type AuthUser,
  type MfaChangeProof,
} from "./authService.js";
import {
  exchangeAuthorizationCode,
  isAppleRevocationConfigured,
  revokeAppleRefreshToken,
  verifyAppleIdentityToken,
  type AppleClaims,
} from "./appleIdentity.js";
import { encryptUserPii, hashForLookup } from "./piiService.js";

const log = pino({ name: "appleSignInService" });

/** How recently Apple must have issued the token for a sensitive action (linking, deleting the account). */
const FRESH_APPLE_TOKEN_SECONDS = 5 * 60;

export interface AppleSignInInput {
  identityToken: string;
  /** The random value whose SHA-256 the phone gave Apple; the token must carry that hash. */
  nonce: string;
  /** Lets the server get Apple's refresh token, which account deletion later revokes. Optional: sign-in works without it. */
  authorizationCode?: string;
  /** Apple sends the name once, on the first authorization, and only to the phone. */
  givenName?: string;
  familyName?: string;
}

/** The unique index an insert ran into, or undefined when the error is not a unique violation (23505). */
function violatedIndex(err: unknown): string | undefined {
  for (const e of [err, (err as { cause?: unknown } | null)?.cause] as Array<{ code?: string; constraint_name?: string } | null>) {
    if (e?.code === "23505") return e.constraint_name ?? "";
  }
  return undefined;
}

async function userIdForSubject(sub: string): Promise<number | undefined> {
  const [row] = await db
    .select({ userId: oauthAccount.userId })
    .from(oauthAccount)
    .where(and(eq(oauthAccount.oauthProvider, "apple"), eq(oauthAccount.oauthProviderId, sub)));
  return row?.userId;
}

/** The person's own name if the phone sent one, else the part of a real address before the @, else a plain label. */
function displayName(input: AppleSignInInput, claims: AppleClaims): string {
  const given = [input.givenName, input.familyName].map((n) => n?.trim()).filter(Boolean).join(" ");
  if (given) return given;
  if (claims.email && !claims.isPrivateEmail) return claims.email.split("@")[0];
  return "Apple user";
}

function refuseUnusableAccount(status: string | null | undefined): void {
  if (status === "suspended") throw new AuthError("Your account has been suspended.", "ACCOUNT_SUSPENDED", 403);
  if (status === "cancelled") throw new AuthError("Your account has been cancelled.", "ACCOUNT_CANCELLED", 403);
}

/** Links to the verified account with this address, or creates a new account. Returns its user id. */
async function linkOrCreate(claims: AppleClaims, input: AppleSignInInput): Promise<number> {
  if (!claims.email) {
    throw new AuthError(
      "Apple did not share an email address. In Settings > Apple ID > Sign in with Apple, stop using this app, then try again.",
      "APPLE_EMAIL_MISSING",
      400,
    );
  }
  if (!claims.emailVerified) {
    throw new AuthError("Apple has not verified this email address.", "APPLE_EMAIL_NOT_VERIFIED", 403);
  }
  const email = claims.email.toLowerCase();

  try {
    return await db.transaction(async (tx) => {
      const [existing] = claims.isPrivateEmail
        ? []
        : await tx
            .select({ userId: user.userId, emailVerifiedInd: user.emailVerifiedInd, userStatus: user.userStatus })
            .from(user)
            .where(or(eq(user.userEmailHash, hashForLookup(email)), eq(user.userEmail, email)));

      let userId: number;
      if (existing) {
        if (!existing.emailVerifiedInd) {
          throw new AuthError(
            "An account with this email exists but its email was never verified. Verify it from the email we sent, then sign in with Apple again.",
            "ACCOUNT_EMAIL_UNVERIFIED",
            409,
          );
        }
        refuseUnusableAccount(existing.userStatus);
        userId = existing.userId;
      } else {
        const name = displayName(input, claims);
        const [created] = await tx
          .insert(user)
          .values({ userName: name, userEmail: email, emailVerifiedInd: true, ...encryptUserPii({ userName: name, userEmail: email }) })
          .returning({ userId: user.userId });
        userId = created.userId;
        const [subscriber] = await tx.select({ roleId: role.roleId }).from(role).where(eq(role.roleName, "Subscriber"));
        if (subscriber) await tx.insert(userRole).values({ userId, roleId: subscriber.roleId });
      }

      await tx.insert(oauthAccount).values({ userId, oauthProvider: "apple", oauthProviderId: claims.sub });
      return userId;
    });
  } catch (err) {
    const index = violatedIndex(err);
    if (index === "uq_oauth_account_apple_subject") {
      // Two first sign-ins raced and the other won: it is the same person, so use its account.
      const winner = await userIdForSubject(claims.sub);
      if (winner) return winner;
    }
    if (index === "uq_oauth_account_apple_user") {
      throw new AuthError("This account is already linked to a different Apple ID.", "APPLE_ALREADY_LINKED", 409);
    }
    throw err;
  }
}

const sealToken = (token: string) => {
  const { iv, authTag, ciphertext } = encrypt(token);
  return `${iv}:${authTag}:${ciphertext}`;
};

const openToken = (sealed: string) => {
  const [iv, authTag, ciphertext] = sealed.split(":");
  return decrypt(ciphertext, iv, authTag);
};

/** Keeps Apple's refresh token (encrypted) so deleting the account can revoke it. Best effort, never fails a sign-in. */
async function keepRefreshToken(userId: number, authorizationCode: string | undefined): Promise<void> {
  if (!authorizationCode) return;
  const refreshToken = await exchangeAuthorizationCode(authorizationCode);
  if (!refreshToken) return;
  await db
    .update(oauthAccount)
    .set({ providerRefreshTokenEnc: sealToken(refreshToken) })
    .where(and(eq(oauthAccount.userId, userId), eq(oauthAccount.oauthProvider, "apple")));
}

/**
 * Signs in with an Apple identity token from the phone.
 *
 * @throws {AuthError} APPLE_NOT_CONFIGURED, APPLE_UNAVAILABLE, APPLE_TOKEN_INVALID, APPLE_EMAIL_MISSING,
 *   APPLE_EMAIL_NOT_VERIFIED, ACCOUNT_EMAIL_UNVERIFIED, APPLE_ALREADY_LINKED, ACCOUNT_SUSPENDED, ACCOUNT_CANCELLED.
 */
export async function signInWithApple(input: AppleSignInInput): Promise<AuthUser> {
  const claims = await verifyAppleIdentityToken(input.identityToken, input.nonce);
  const userId = (await userIdForSubject(claims.sub)) ?? (await linkOrCreate(claims, input));
  const authUser = await getUserWithRolesAndPermissions(userId);
  refuseUnusableAccount(authUser.userStatus);
  await keepRefreshToken(userId, input.authorizationCode);
  return authUser;
}

/**
 * The signed-in person adds Sign in with Apple to the account they are in: the way to join an Apple account that
 * hid its email to the account they registered with. Asks for the same proof as changing two-factor settings,
 * because a stolen session must not be able to attach someone else's Apple ID and keep access.
 *
 * @throws {AuthError} the codes of {@link signInWithApple} that apply, plus APPLE_ALREADY_LINKED (409) when this
 *   Apple ID belongs to another account or this account already has a different one, and the proof errors
 *   INVALID_CREDENTIALS, RECENT_SIGN_IN_REQUIRED, MFA_REQUIRED, INVALID_MFA_CODE (403).
 */
export async function linkAppleToUser(
  userId: number,
  input: AppleSignInInput,
  proof: MfaChangeProof,
  signedInAt: Date | null,
): Promise<void> {
  const [row] = await db.select().from(user).where(eq(user.userId, userId));
  if (!row) throw new AuthError("USER_NOT_FOUND", "USER_NOT_FOUND", 404);
  await requireProofToChangeMfa(row, proof, signedInAt);

  const claims = await verifyAppleIdentityToken(input.identityToken, input.nonce, { maxAgeSeconds: FRESH_APPLE_TOKEN_SECONDS });
  const owner = await userIdForSubject(claims.sub);
  if (owner === userId) return;
  if (owner !== undefined) {
    throw new AuthError("This Apple ID is already linked to another account.", "APPLE_ALREADY_LINKED", 409);
  }
  try {
    await db.insert(oauthAccount).values({ userId, oauthProvider: "apple", oauthProviderId: claims.sub });
  } catch (err) {
    if (violatedIndex(err) !== undefined) {
      throw new AuthError("This account is already linked to a different Apple ID.", "APPLE_ALREADY_LINKED", 409);
    }
    throw err;
  }
  await keepRefreshToken(userId, input.authorizationCode);
}

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

export interface AppleLink {
  /** Null when no token was kept (revocation was not set up when the person signed in). */
  refreshToken: string | null;
}

/** The user's Apple link, read BEFORE the account is deleted: deletion removes the row that holds the token. */
export async function appleLinkOf(userId: number): Promise<AppleLink | null> {
  const [row] = await db
    .select({ enc: oauthAccount.providerRefreshTokenEnc })
    .from(oauthAccount)
    .where(and(eq(oauthAccount.userId, userId), eq(oauthAccount.oauthProvider, "apple")));
  if (!row) return null;
  if (!row.enc) return { refreshToken: null };
  try {
    return { refreshToken: openToken(row.enc) };
  } catch (err) {
    // A token that cannot be read (encryption key replaced) must not stand in the way of a deletion.
    log.error({ err, userId, alert: "apple_token_unreadable" }, "Stored Apple token could not be decrypted");
    return { refreshToken: null };
  }
}

/**
 * Revokes the Apple token of a deleted account (App Store rule 5.1.1(v)). Runs AFTER the deletion committed and
 * never undoes it. When Apple cannot be reached or refuses, the token is stored (encrypted) in
 * `apple_revocation_retries` for {@link retryAppleRevocations} and a log alert is raised. The person can always
 * remove the app under Settings > Apple ID > Sign in with Apple. This function is the one place that sets that policy.
 */
export async function revokeAppleAfterDeletion(userId: number, link: AppleLink): Promise<void> {
  if (!isAppleRevocationConfigured()) return; // nothing was ever kept to revoke: the key is not set up
  if (!link.refreshToken) {
    log.warn({ userId, alert: "apple_token_not_revoked" }, "Deleted account had an Apple link but no stored token to revoke");
    return;
  }
  try {
    await revokeAppleRefreshToken(link.refreshToken);
  } catch (err) {
    log.error({ err, userId, alert: "apple_token_not_revoked" }, "Could not revoke a deleted account's Apple token; queued for retry");
    try {
      await db.insert(appleRevocationRetries).values({ refreshTokenEnc: sealToken(link.refreshToken), lastError: String(err).slice(0, 500) });
    } catch (queueErr) {
      log.error({ err: queueErr, userId, alert: "apple_token_not_revoked" }, "Could not queue the failed Apple revoke either");
    }
  }
}

/**
 * Tries every queued Apple revoke again; a row Apple accepts is removed, one it refuses again has its attempt
 * count raised. Returns how many were revoked and how many are still queued.
 */
export async function retryAppleRevocations(): Promise<{ revoked: number; remaining: number }> {
  const queued = await db.select().from(appleRevocationRetries);
  let revoked = 0;
  for (const row of queued) {
    try {
      await revokeAppleRefreshToken(openToken(row.refreshTokenEnc));
      await db.delete(appleRevocationRetries).where(eq(appleRevocationRetries.id, row.id));
      revoked++;
    } catch (err) {
      await db
        .update(appleRevocationRetries)
        .set({ attempts: row.attempts + 1, lastError: String(err).slice(0, 500), updatedAt: new Date() })
        .where(eq(appleRevocationRetries.id, row.id));
    }
  }
  return { revoked, remaining: queued.length - revoked };
}

/**
 * True when `identityToken` is a fresh Apple sign-in for the Apple ID linked to this user: the proof an Apple-only
 * account gives to delete itself, in place of a typed email (a hidden private-relay address cannot be typed).
 *
 * @throws {AuthError} APPLE_TOKEN_INVALID and the other verification codes of {@link verifyAppleIdentityToken}.
 */
export async function isFreshAppleSignInFor(userId: number, identityToken: string, nonce: string): Promise<boolean> {
  const claims = await verifyAppleIdentityToken(identityToken, nonce, { maxAgeSeconds: FRESH_APPLE_TOKEN_SECONDS });
  return (await userIdForSubject(claims.sub)) === userId;
}

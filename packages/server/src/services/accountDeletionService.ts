/**
 * @module services/accountDeletionService
 *
 * A signed-in user deleting their OWN account. This service only decides whether the
 * request is allowed (proof of identity, no orphaned organisation); the deletion itself
 * is userAnonymisationService.anonymiseUser.
 *
 * Proof of identity: the password for password accounts, the account email typed back for
 * Google-only accounts (no password exists), and a current MFA code when MFA is on. A typed
 * email is only a confirmation, not a credential, so a Google-only account must also have
 * signed in within the last 10 minutes (a stolen older session is not enough). MFA does not
 * lift that: until MFA changes needed proof, a session alone could enrol an authenticator,
 * and any such enrolment would still be in place.
 *
 * An account with no password may instead give a fresh Sign in with Apple identity token for the Apple ID
 * linked to it. That is a real credential (not just a confirmation), so it replaces both the typed email and
 * the recent-sign-in rule, and it works for a hidden private-relay address, which a person cannot type.
 *
 * Blocked, with a message that says what to do: the only platform Administrator, and the
 * only admin of an organisation that still has other members (it would be left with nobody
 * able to manage it). An Administrator can still delete such a user from Settings.
 */

import bcrypt from "bcrypt";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { organisation, role, user, userOrganisation, userRole } from "../db/schema.js";
import { AuthError, isRecentSignIn, verifyMfaToken } from "./authService.js";
import { isFreshAppleSignInFor } from "./appleSignInService.js";
import { decryptUserPii } from "./piiService.js";
import { anonymiseUser } from "./userAnonymisationService.js";

export class AccountDeletionError extends Error {
  constructor(
    message: string,
    public readonly code: "INVALID_CREDENTIALS" | "RECENT_SIGN_IN_REQUIRED" | "MFA_REQUIRED" | "INVALID_MFA_CODE" | "OWNERSHIP_TRANSFER_REQUIRED" | "LAST_ADMINISTRATOR",
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "AccountDeletionError";
  }
}

export interface DeleteAccountInput {
  password?: string;
  confirmEmail?: string;
  mfaCode?: string;
  /** A fresh Apple identity token and its nonce: proof for an account that has no password and an Apple link. */
  appleIdentityToken?: string;
  appleNonce?: string;
}

/** An organisation is left unmanaged when its only admin leaves while other members remain. */
export function leavesOrganisationUnmanaged(others: { admins: number; members: number }): boolean {
  return others.admins === 0 && others.members > 0;
}

/** True when `userId` is the one and only active Administrator. */
export function isOnlyAdministrator(administratorIds: number[], userId: number): boolean {
  return administratorIds.length === 1 && administratorIds[0] === userId;
}

/** Names of organisations this user is the only admin of while other members remain. */
async function organisationsNeedingNewAdmin(userId: number): Promise<string[]> {
  const adminOf = await db
    .select({ organisationId: userOrganisation.organisationId, name: organisation.organisationName })
    .from(userOrganisation)
    .innerJoin(organisation, eq(organisation.organisationId, userOrganisation.organisationId))
    .where(and(eq(userOrganisation.userId, userId), eq(userOrganisation.role, "admin")));

  const blocked: string[] = [];
  for (const org of adminOf) {
    const [others] = await db
      .select({ admins: count(sql`CASE WHEN ${userOrganisation.role} = 'admin' THEN 1 END`), members: count() })
      .from(userOrganisation)
      .where(and(eq(userOrganisation.organisationId, org.organisationId), ne(userOrganisation.userId, userId)));
    if (leavesOrganisationUnmanaged(others)) blocked.push(org.name);
  }
  return blocked;
}

async function isLastAdministrator(userId: number): Promise<boolean> {
  const admins = await db
    .select({ userId: userRole.userId })
    .from(userRole)
    .innerJoin(role, eq(role.roleId, userRole.roleId))
    .innerJoin(user, eq(user.userId, userRole.userId))
    .where(and(eq(role.roleName, "Administrator"), ne(user.userStatus, "deleted")));
  return isOnlyAdministrator(admins.map((a) => a.userId), userId);
}

/** True only for a fresh Apple sign-in of the Apple ID linked to this account; anything else is a refusal. */
async function proveWithApple(userId: number, identityToken: string, nonce: string): Promise<boolean> {
  try {
    if (await isFreshAppleSignInFor(userId, identityToken, nonce)) return true;
  } catch (err) {
    if (!(err instanceof AuthError) || err.code !== "APPLE_TOKEN_INVALID") throw err;
  }
  throw new AccountDeletionError("That Apple sign-in does not match this account.", "INVALID_CREDENTIALS", 403);
}

/**
 * Delete the caller's own account.
 *
 * @throws {AccountDeletionError} 403 for wrong password / email / MFA code, 409 when blocked.
 * @throws {AuthError} APPLE_UNAVAILABLE / APPLE_NOT_CONFIGURED (503) when Apple cannot be asked to check the token.
 * @throws {UserAnonymisationError} when the Stripe subscription could not be cancelled.
 */
export async function deleteOwnAccount(
  userId: number,
  input: DeleteAccountInput,
  signedInAt: Date | null,
): Promise<void> {
  const [row] = await db.select().from(user).where(eq(user.userId, userId));
  if (!row || row.userStatus === "deleted") throw new AccountDeletionError("Account not found.", "INVALID_CREDENTIALS", 403);

  let appleProven = false;
  if (row.userPasswordHash) {
    const ok = input.password ? await bcrypt.compare(input.password, row.userPasswordHash) : false;
    if (!ok) throw new AccountDeletionError("Incorrect password.", "INVALID_CREDENTIALS", 403);
  } else if (input.appleIdentityToken && input.appleNonce) {
    appleProven = await proveWithApple(userId, input.appleIdentityToken, input.appleNonce);
  } else {
    const email = decryptUserPii(row).userEmail.toLowerCase();
    if (input.confirmEmail?.trim().toLowerCase() !== email) {
      throw new AccountDeletionError("Type your account email address exactly to confirm.", "INVALID_CREDENTIALS", 403);
    }
  }

  // Required for every account without a password, MFA or not: before MFA changes needed proof,
  // a session thief could enrol their own authenticator, and that enrolment would otherwise
  // slip past this rule.
  if (!row.userPasswordHash && !appleProven && !isRecentSignIn(signedInAt)) {
    throw new AccountDeletionError(
      "For your security, sign out, sign back in, and then delete your account.",
      "RECENT_SIGN_IN_REQUIRED",
      403,
    );
  }

  if (row.mfaEnabledInd) {
    if (!input.mfaCode) throw new AccountDeletionError("Enter your authenticator code.", "MFA_REQUIRED", 403);
    if (!(await verifyMfaToken(userId, input.mfaCode))) {
      throw new AccountDeletionError("That authenticator code is not valid.", "INVALID_MFA_CODE", 403);
    }
  }

  if (await isLastAdministrator(userId)) {
    throw new AccountDeletionError(
      "You are the only Administrator. Make someone else an Administrator before deleting this account.",
      "LAST_ADMINISTRATOR",
      409,
    );
  }
  const blocked = await organisationsNeedingNewAdmin(userId);
  if (blocked.length > 0) {
    throw new AccountDeletionError(
      `You are the only admin of ${blocked.join(", ")}. Make another member an admin first, then delete your account.`,
      "OWNERSHIP_TRANSFER_REQUIRED",
      409,
    );
  }

  await anonymiseUser(userId, userId);
}

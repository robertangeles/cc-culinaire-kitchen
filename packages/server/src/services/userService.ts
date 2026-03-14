/**
 * @module services/userService
 *
 * Service layer for user profile management and admin user operations.
 */

import bcrypt from "bcrypt";
import { eq, ilike, or, desc, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { decryptUserPii, encryptUserPii } from "./piiService.js";
import { encryptPii, hashForLookup } from "../utils/crypto.js";
import {
  user,
  role,
  userRole,
  userOrganisation,
  organisation,
  conversation,
  message,
  refreshToken,
  emailVerification,
  oauthAccount,
} from "../db/schema.js";

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? "12", 10);

/** Get a user's profile by ID. */
export async function getUserProfile(userId: number) {
  const rows = await db
    .select()
    .from(user)
    .where(eq(user.userId, userId));

  if (rows.length === 0) return null;

  const { userPasswordHash, mfaSecret, ...rest } = rows[0];
  const pii = decryptUserPii(rest as Record<string, unknown>);
  return { ...rest, ...pii };
}

/** Update profile fields (name, photo, bio, address). */
export async function updateUserProfile(
  userId: number,
  data: {
    userName?: string;
    userPhotoPath?: string;
    userBio?: string;
    userAddressLine1?: string;
    userAddressLine2?: string;
    userSuburb?: string;
    userState?: string;
    userCountry?: string;
    userPostcode?: string;
    userFacebook?: string;
    userInstagram?: string;
    userTiktok?: string;
    userPinterest?: string;
    userLinkedin?: string;
  }
) {
  // Build encrypted fields for any PII being updated (dual-write)
  const encFields: Record<string, unknown> = {};

  if (data.userName) {
    const enc = encryptPii(data.userName);
    if (enc) {
      encFields.userNameEnc = enc.enc;
      encFields.userNameIv = enc.iv;
      encFields.userNameTag = enc.tag;
    }
  }

  if (data.userBio !== undefined) {
    const enc = encryptPii(data.userBio);
    if (enc) {
      encFields.userBioEnc = enc.enc;
      encFields.userBioIv = enc.iv;
      encFields.userBioTag = enc.tag;
    } else {
      encFields.userBioEnc = null;
      encFields.userBioIv = null;
      encFields.userBioTag = null;
    }
  }

  // For address fields, combine and encrypt as JSON
  const addressFields = [
    "userAddressLine1", "userAddressLine2", "userSuburb",
    "userState", "userCountry", "userPostcode",
  ] as const;
  if (addressFields.some((f) => f in data)) {
    const addressData = JSON.stringify({
      line1: data.userAddressLine1 ?? null,
      line2: data.userAddressLine2 ?? null,
      suburb: data.userSuburb ?? null,
      state: data.userState ?? null,
      country: data.userCountry ?? null,
      postcode: data.userPostcode ?? null,
    });
    const enc = encryptPii(addressData);
    if (enc) {
      encFields.userAddressEnc = enc.enc;
      encFields.userAddressIv = enc.iv;
      encFields.userAddressTag = enc.tag;
    }
  }

  await db
    .update(user)
    .set({ ...data, ...encFields, updatedDttm: new Date() })
    .where(eq(user.userId, userId));
}

/** Change password (requires current password verification). */
export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string
) {
  const rows = await db
    .select({ hash: user.userPasswordHash })
    .from(user)
    .where(eq(user.userId, userId));

  if (rows.length === 0) throw new Error("User not found.");

  if (!rows[0].hash) {
    throw new Error("Account uses OAuth login. Set a password via profile settings.");
  }

  const valid = await bcrypt.compare(currentPassword, rows[0].hash);
  if (!valid) throw new Error("Current password is incorrect.");

  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await db
    .update(user)
    .set({ userPasswordHash: hash, updatedDttm: new Date() })
    .where(eq(user.userId, userId));
}

// ---------------------------------------------------------------------------
// Admin operations
// ---------------------------------------------------------------------------

/** List all users with pagination and optional search. */
export async function listAllUsers(
  page: number,
  limit: number,
  search?: string
) {
  const offset = (page - 1) * limit;

  const baseQuery = db
    .select({
      userId: user.userId,
      userName: user.userName,
      userEmail: user.userEmail,
      emailVerifiedInd: user.emailVerifiedInd,
      userPhotoPath: user.userPhotoPath,
      freeSessions: user.freeSessions,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionTier: user.subscriptionTier,
      userStatus: user.userStatus,
      createdDttm: user.createdDttm,
    })
    .from(user);

  const whereClause = search
    ? or(
        ilike(user.userName, `%${search}%`),
        ilike(user.userEmail, `%${search}%`)
      )
    : undefined;

  const rows = whereClause
    ? await baseQuery.where(whereClause).orderBy(desc(user.createdDttm)).limit(limit).offset(offset)
    : await baseQuery.orderBy(desc(user.createdDttm)).limit(limit).offset(offset);

  // Get total count
  const countResult = whereClause
    ? await db.select({ count: sql<number>`count(*)::int` }).from(user).where(whereClause)
    : await db.select({ count: sql<number>`count(*)::int` }).from(user);

  // Decrypt PII for each user row
  const decryptedRows = rows.map((u) => {
    const pii = decryptUserPii(u as Record<string, unknown>);
    return { ...u, userName: pii.userName, userEmail: pii.userEmail };
  });

  // Enrich with roles and organisation
  const enriched = await Promise.all(
    decryptedRows.map(async (u) => {
      const roles = await db
        .select({ roleName: role.roleName })
        .from(userRole)
        .innerJoin(role, eq(userRole.roleId, role.roleId))
        .where(eq(userRole.userId, u.userId));

      const orgs = await db
        .select({ organisationName: organisation.organisationName })
        .from(userOrganisation)
        .innerJoin(organisation, eq(userOrganisation.organisationId, organisation.organisationId))
        .where(eq(userOrganisation.userId, u.userId));

      return {
        ...u,
        roles: roles.map((r) => r.roleName),
        organisation: orgs[0]?.organisationName ?? null,
      };
    })
  );

  return { users: enriched, total: countResult[0].count };
}

/** Admin: update user name, email, or status. */
export async function adminUpdateUser(
  userId: number,
  data: { userName?: string; userEmail?: string; userStatus?: string }
) {
  const encFields: Record<string, unknown> = {};

  if (data.userName) {
    const enc = encryptPii(data.userName);
    if (enc) {
      encFields.userNameEnc = enc.enc;
      encFields.userNameIv = enc.iv;
      encFields.userNameTag = enc.tag;
    }
  }

  if (data.userEmail) {
    const enc = encryptPii(data.userEmail);
    if (enc) {
      encFields.userEmailEnc = enc.enc;
      encFields.userEmailIv = enc.iv;
      encFields.userEmailTag = enc.tag;
    }
    encFields.userEmailHash = hashForLookup(data.userEmail);
  }

  await db
    .update(user)
    .set({ ...data, ...encFields, updatedDttm: new Date() })
    .where(eq(user.userId, userId));
}

/** Suspend a user account. */
export async function suspendUser(userId: number) {
  await db
    .update(user)
    .set({ userStatus: "suspended", updatedDttm: new Date() })
    .where(eq(user.userId, userId));
}

/** Reactivate a suspended user. */
export async function reactivateUser(userId: number) {
  await db
    .update(user)
    .set({ userStatus: "active", updatedDttm: new Date() })
    .where(eq(user.userId, userId));
}

/** Cancel a user account. */
export async function cancelUser(userId: number) {
  await db
    .update(user)
    .set({ userStatus: "cancelled", updatedDttm: new Date() })
    .where(eq(user.userId, userId));
}

/** Update free sessions for a user. */
export async function updateFreeSessions(userId: number, sessions: number) {
  await db
    .update(user)
    .set({ freeSessions: sessions, updatedDttm: new Date() })
    .where(eq(user.userId, userId));
}

/** Admin: update subscription tier and/or status. */
export async function updateSubscription(
  userId: number,
  data: { subscriptionTier?: string; subscriptionStatus?: string }
) {
  await db
    .update(user)
    .set({ ...data, updatedDttm: new Date() })
    .where(eq(user.userId, userId));
}

/** Admin: remove a user from their organisation. */
export async function removeUserOrganisation(userId: number) {
  await db.delete(userOrganisation).where(eq(userOrganisation.userId, userId));
}

/** Assign a role to a user. */
export async function assignRole(userId: number, roleId: number) {
  // Check if already assigned
  const existing = await db
    .select()
    .from(userRole)
    .where(
      sql`${userRole.userId} = ${userId} AND ${userRole.roleId} = ${roleId}`
    );

  if (existing.length > 0) return;

  await db.insert(userRole).values({ userId, roleId });
}

/** Remove a role from a user. */
export async function removeRole(userId: number, roleId: number) {
  await db
    .delete(userRole)
    .where(
      sql`${userRole.userId} = ${userId} AND ${userRole.roleId} = ${roleId}`
    );
}

/**
 * Permanently delete a user and all associated data.
 *
 * Cascade order (respects FK dependencies):
 * 1. messages (via user's conversations)
 * 2. conversations
 * 3. user_role
 * 4. user_organisation
 * 5. refresh_token
 * 6. email_verification
 * 7. oauth_account
 * 8. user
 *
 * @param userId - The user ID to delete.
 * @throws {Error} If the user is not found.
 */
export async function deleteUser(userId: number) {
  const rows = await db.select({ userId: user.userId }).from(user).where(eq(user.userId, userId));
  if (rows.length === 0) throw new Error("User not found");

  // 1. Delete messages for user's conversations
  const convRows = await db
    .select({ conversationId: conversation.conversationId })
    .from(conversation)
    .where(eq(conversation.userId, userId));

  for (const c of convRows) {
    await db.delete(message).where(eq(message.conversationId, c.conversationId));
  }

  // 2. Delete conversations
  await db.delete(conversation).where(eq(conversation.userId, userId));

  // 3-7. Delete related records
  await db.delete(userRole).where(eq(userRole.userId, userId));
  await db.delete(userOrganisation).where(eq(userOrganisation.userId, userId));
  await db.delete(refreshToken).where(eq(refreshToken.userId, userId));
  await db.delete(emailVerification).where(eq(emailVerification.userId, userId));
  await db.delete(oauthAccount).where(eq(oauthAccount.userId, userId));

  // 8. Delete the user
  await db.delete(user).where(eq(user.userId, userId));
}

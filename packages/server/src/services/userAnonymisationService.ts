/**
 * @module services/userAnonymisationService
 *
 * Account deletion for a user: remove what is personal, scrub the identity off the
 * user row, and KEEP the row (and its id).
 *
 * Why not DELETE the row: orders, waste logs, receiving records, stock movements and
 * the audit trail all reference a user id, and the business must keep that history.
 * With the identity scrubbed, those records no longer identify anyone, which is what
 * the published promise says ("no personally identifiable information is retained")
 * and what the Privacy Act's destroy-or-de-identify duty (APP 11.2) asks for. Staff
 * compliance documents follow their own retention lifecycle (complianceRetentionService,
 * Fair Work 7-year records) and are not touched here.
 *
 * Order matters: the Stripe subscription is cancelled FIRST, outside the transaction.
 * If that fails nothing is deleted and the caller can retry; the reverse (data gone,
 * subscription still billing) is the failure to avoid.
 *
 * Limits: an access token already issued stays valid until it expires (short-lived;
 * `authenticate` does not re-read the user), and the Stripe customer object keeps its
 * own name/email until the customer is deleted on the Stripe side.
 */

import { eq, inArray, or } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  benchMention,
  benchMessage,
  brainMemory,
  ckmFeedback,
  conversation,
  deviceToken,
  emailVerification,
  factBrainCorpus,
  factBrainRecall,
  kitchenProfile,
  message,
  notification,
  oauthAccount,
  passwordReset,
  recipe,
  recipeReview,
  refreshToken,
  staffAvailability,
  user,
  userLocationPreference,
  userOrganisation,
  userRole,
  userStoreLocation,
} from "../db/schema.js";
import { cancelSubscriptionNow } from "./stripeService.js";
import * as auditService from "./auditService.js";

export class UserAnonymisationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UserAnonymisationError";
  }
}

/** What is written over the user row. Keys must be real `user` columns (checked by `satisfies` and a test). */
export function scrubbedUserFields(userId: number, now: Date) {
  return {
    userName: "Deleted user",
    // Unique per user, and .invalid can never receive mail (RFC 2606).
    userEmail: `deleted-${userId}@deleted.invalid`,
    userPasswordHash: null,
    emailVerifiedInd: false,
    mfaEnabledInd: false,
    mfaSecret: null,
    userPhotoPath: null,
    subscriptionStatus: "cancelled",
    subscriptionTier: "free",
    currentPeriodEndDttm: null,
    userBio: null,
    userAddressLine1: null,
    userAddressLine2: null,
    userSuburb: null,
    userState: null,
    userCountry: null,
    userPostcode: null,
    userNameEnc: null,
    userNameIv: null,
    userNameTag: null,
    userEmailEnc: null,
    userEmailIv: null,
    userEmailTag: null,
    userEmailHash: null,
    userBioEnc: null,
    userBioIv: null,
    userBioTag: null,
    userAddressEnc: null,
    userAddressIv: null,
    userAddressTag: null,
    userFacebook: null,
    userInstagram: null,
    userTiktok: null,
    userPinterest: null,
    userLinkedin: null,
    userStatus: "deleted",
    selectedLocationId: null,
    selectedOrganisationId: null,
    brainNudgesOptIn: false,
    updatedDttm: now,
  } satisfies Partial<typeof user.$inferInsert>;
}

/** `user` columns deliberately left as they are, and why. */
export const KEPT_USER_COLUMNS: Record<string, string> = {
  userId: "primary key; business history references it",
  freeSessions: "usage counter, not personal data",
  stripeCustomerId: "no personal data by itself; lets Stripe-side records be reconciled or the customer deleted later",
  stripeSubscriptionId: "no personal data by itself; the subscription is cancelled",
  createdDttm: "account creation time; not identifying once the row is scrubbed",
};

/** Foreign keys to `user` whose rows this service removes or detaches. */
export const HANDLED_USER_REFERENCES: readonly string[] = [
  "brain_memory.user_id",
  "ckm_feedback.user_id",
  "device_token.user_id",
  "fact_brain_corpus.user_id",
  "fact_brain_recall.user_id",
  "notification.recipient_user_id",
  "staff_availability.user_id",
  "user_location_preference.user_id",
  "user_store_location.user_id",
];

/**
 * Foreign keys to `user` whose rows are KEPT: business and audit records. They keep
 * pointing at the scrubbed row, so they no longer identify a person. Adding a new FK to
 * `user` fails a test until it is listed here or in HANDLED_USER_REFERENCES.
 */
export const KEPT_USER_REFERENCES: readonly string[] = [
  "audit_log.actor_user_id",
  "compliance_document.uploaded_by",
  "compliance_document.user_id",
  "compliance_document.verified_by",
  "consumption_log.user_id",
  "credit_note.created_by_user_id",
  "discrepancy_photo.uploaded_by_user_id",
  "document_access_log.actor_user_id",
  "foh_sale.created_by",
  "guide.updated_by",
  "ingredient.deleted_by",
  "ingredient_alias.created_by_user_id",
  "ingredient_cross_usage.user_id",
  "inventory_transfer.initiated_by_user_id",
  "inventory_transfer.received_by_user_id",
  "inventory_transfer.sent_by_user_id",
  "menu_item.user_id",
  "order_guide.created_by_user_id",
  "pending_catalog_request.requested_by_user_id",
  "pending_catalog_request.reviewed_by_user_id",
  "prep_session.user_id",
  "prep_task.user_id",
  "purchase_order.approved_by_user_id",
  "purchase_order.created_by_user_id",
  "purchase_order_line.received_by_user_id",
  "receiving_session.received_by_user_id",
  "recipe_version.changed_by",
  "sale.created_by",
  "sale.voided_by",
  "shift.created_by",
  "shift_assignment.user_id",
  "shift_swap_request.from_user_id",
  "shift_swap_request.to_user_id",
  "spend_threshold.created_by_user_id",
  "stock_level.last_counted_by_user_id",
  "stock_movement.user_id",
  "stock_take_category.claimed_by_user_id",
  "stock_take_line.counted_by_user_id",
  "stock_take_session.approved_by_user_id",
  "stock_take_session.opened_by_user_id",
  "store_location.created_by",
  "user_store_location.assigned_by",
  "waste_log.user_id",
];

/**
 * Anonymise a user. Idempotent: an already-deleted user returns without error.
 *
 * @throws {Error} "User not found" when the id does not exist.
 * @throws {UserAnonymisationError} when the Stripe subscription could not be cancelled
 *   (nothing is changed in that case).
 */
export async function anonymiseUser(userId: number, actorUserId: number | null = null): Promise<void> {
  const [row] = await db
    .select({ userStatus: user.userStatus, stripeSubscriptionId: user.stripeSubscriptionId })
    .from(user)
    .where(eq(user.userId, userId));
  if (!row) throw new Error("User not found");
  if (row.userStatus === "deleted") return;

  if (row.stripeSubscriptionId) {
    try {
      await cancelSubscriptionNow(row.stripeSubscriptionId);
    } catch (err) {
      throw new UserAnonymisationError(
        "Could not cancel the user's subscription, so the account was not deleted. Try again.",
        { cause: err },
      );
    }
  }

  await db.transaction(async (tx) => {
    // Conversations and their messages.
    const conversations = await tx
      .select({ conversationId: conversation.conversationId })
      .from(conversation)
      .where(eq(conversation.userId, userId));
    if (conversations.length > 0) {
      await tx.delete(message).where(
        inArray(message.conversationId, conversations.map((c) => c.conversationId)),
      );
    }
    await tx.delete(conversation).where(eq(conversation.userId, userId));

    // Credentials and sign-in links.
    await tx.delete(refreshToken).where(eq(refreshToken.userId, userId));
    await tx.delete(emailVerification).where(eq(emailVerification.userId, userId));
    await tx.delete(passwordReset).where(eq(passwordReset.userId, userId));
    await tx.delete(oauthAccount).where(eq(oauthAccount.userId, userId));
    await tx.delete(deviceToken).where(eq(deviceToken.userId, userId));

    // Access: roles, organisation and location membership, selections.
    await tx.delete(userRole).where(eq(userRole.userId, userId));
    await tx.delete(userOrganisation).where(eq(userOrganisation.userId, userId));
    await tx.delete(userStoreLocation).where(eq(userStoreLocation.userId, userId));
    await tx.delete(userLocationPreference).where(eq(userLocationPreference.userId, userId));

    // Personal content and preferences.
    await tx.delete(notification).where(eq(notification.recipientUserId, userId));
    await tx.delete(kitchenProfile).where(eq(kitchenProfile.userId, userId));
    await tx.delete(brainMemory).where(eq(brainMemory.userId, userId));
    await tx.delete(factBrainCorpus).where(eq(factBrainCorpus.userId, userId));
    await tx.delete(factBrainRecall).where(eq(factBrainRecall.userId, userId));
    await tx.delete(staffAvailability).where(eq(staffAvailability.userId, userId));
    await tx.delete(benchMention).where(eq(benchMention.mentionedUserId, userId));
    await tx.update(ckmFeedback).set({ userId: null }).where(eq(ckmFeedback.userId, userId));

    // Saved recipes (versions cascade) and every review of them, plus the user's own reviews.
    const recipes = await tx.select({ recipeId: recipe.recipeId }).from(recipe).where(eq(recipe.userId, userId));
    const recipeIds = recipes.map((r) => r.recipeId);
    await tx.delete(recipeReview).where(
      recipeIds.length > 0
        ? or(eq(recipeReview.userId, userId), inArray(recipeReview.recipeId, recipeIds))
        : eq(recipeReview.userId, userId),
    );
    if (recipeIds.length > 0) await tx.delete(recipe).where(inArray(recipe.recipeId, recipeIds));

    // Community posts stay in the thread as deleted messages with no text.
    await tx
      .update(benchMessage)
      .set({ deletedInd: true, messageBody: "" })
      .where(eq(benchMessage.userId, userId));

    await tx.update(user).set(scrubbedUserFields(userId, new Date())).where(eq(user.userId, userId));

    await auditService.log(
      { entityType: "user", entityId: String(userId), action: "anonymised", actorUserId },
      tx,
    );
  });
}

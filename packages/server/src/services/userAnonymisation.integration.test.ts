import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

vi.mock("./stripeService.js", () => ({ cancelSubscriptionNow: vi.fn() }));

import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  auditLog,
  conversation,
  kitchenProfile,
  message,
  notification,
  organisation,
  recipe,
  recipeReview,
  refreshToken,
  user,
  userOrganisation,
  userRole,
  wasteLog,
} from "../db/schema.js";
import { registerUser, loginUser } from "./authService.js";
import { createOrganisation } from "./organisationService.js";
import { cancelSubscriptionNow } from "./stripeService.js";
import { anonymiseUser, UserAnonymisationError } from "./userAnonymisationService.js";
import { listAllUsers } from "./userService.js";

/**
 * Real-database behaviour of account deletion: the identity is scrubbed, the row and
 * its id are kept, personal rows are removed, and business/audit history survives
 * still pointing at the (now anonymous) user. Gated on TENANT_IT=1 like the other
 * integration suites. Stripe is mocked: no external call is made.
 */
const RUN = process.env.TENANT_IT === "1";
const tag = `it-anon-${Date.now()}`;

// Each step is a round trip to the remote dev database; the default 30s is too tight.
describe.skipIf(!RUN)("anonymiseUser (real DB)", { timeout: 120_000 }, () => {
  const userIds: number[] = [];
  const orgIds: number[] = [];
  let adminId: number;

  async function makeUser(label: string): Promise<{ userId: number; email: string }> {
    const email = `${tag}-${label}@it.test`;
    const userId = await registerUser(`Real Name ${label}`, email, "Passw0rd!-it-anon");
    userIds.push(userId);
    return { userId, email };
  }

  async function seedPersonalAndBusinessRows(userId: number) {
    const org = await createOrganisation(userId, { name: `${tag}-org-${userId}` });
    orgIds.push(org.organisationId);

    await db
      .update(user)
      .set({ userBio: "I love sauces", userAddressLine1: "1 Test St", userPostcode: "2000", userPhotoPath: "/uploads/me.jpg" })
      .where(eq(user.userId, userId));

    const [conv] = await db.insert(conversation).values({ conversationId: randomUUID(), userId, conversationTitle: "My chat" }).returning();
    await db.insert(message).values({
      messageId: randomUUID(),
      conversationId: conv.conversationId,
      messageRole: "user",
      messageBody: "private question",
      messageSequence: 1,
    });
    await db.insert(refreshToken).values({ userId, tokenHash: `${tag}-${userId}`, expiresAtDttm: new Date(Date.now() + 3_600_000) });
    await db.insert(notification).values({ organisationId: org.organisationId, recipientUserId: userId, type: "TEST" });
    await db.insert(kitchenProfile).values({ userId });
    const [rec] = await db
      .insert(recipe)
      .values({ userId, title: `${tag} recipe`, recipeData: {} })
      .returning({ recipeId: recipe.recipeId });
    await db.insert(recipeReview).values({ recipeId: rec.recipeId, userId, userName: "Real Name", reviewBody: "own review", rating: 5 });
    await db.insert(recipeReview).values({ recipeId: rec.recipeId, userId: adminId, userName: "Someone", reviewBody: "review of their recipe", rating: 4 });

    const [waste] = await db
      .insert(wasteLog)
      .values({ userId, ingredientName: `${tag} flour`, quantity: "2.000", unit: "kg" })
      .returning({ wasteLogId: wasteLog.wasteLogId });
    await db.insert(auditLog).values({ entityType: "it_test", entityId: tag, action: "create", actorUserId: userId });

    return { orgId: org.organisationId, conversationId: conv.conversationId, recipeId: rec.recipeId, wasteLogId: waste.wasteLogId };
  }

  beforeAll(async () => {
    adminId = (await makeUser("admin")).userId;
  });

  afterAll(async () => {
    for (const userId of userIds) {
      await db.delete(auditLog).where(eq(auditLog.actorUserId, userId));
      await db.delete(auditLog).where(and(eq(auditLog.entityType, "user"), eq(auditLog.entityId, String(userId))));
      await db.delete(wasteLog).where(eq(wasteLog.userId, userId));
      await db.delete(recipe).where(eq(recipe.userId, userId));
      await db.delete(notification).where(eq(notification.recipientUserId, userId));
      await db.delete(userOrganisation).where(eq(userOrganisation.userId, userId));
      await db.delete(userRole).where(eq(userRole.userId, userId));
    }
    for (const orgId of orgIds) await db.delete(organisation).where(eq(organisation.organisationId, orgId));
    for (const userId of userIds) {
      await db.delete(conversation).where(eq(conversation.userId, userId));
      await db.delete(kitchenProfile).where(eq(kitchenProfile.userId, userId));
      await db.delete(refreshToken).where(eq(refreshToken.userId, userId));
      await db.delete(user).where(eq(user.userId, userId));
    }
  });

  it("scrubs the identity but keeps the row, removes personal rows, and keeps business history", async () => {
    const { userId, email } = await makeUser("scrub");
    const ids = await seedPersonalAndBusinessRows(userId);

    await anonymiseUser(userId, adminId);

    const [row] = await db.select().from(user).where(eq(user.userId, userId));
    expect(row, "the user row is kept").toBeDefined();
    expect(row.userName).toBe("Deleted user");
    expect(row.userEmail).toBe(`deleted-${userId}@deleted.invalid`);
    expect(row.userStatus).toBe("deleted");
    for (const column of [
      row.userPasswordHash, row.mfaSecret, row.userPhotoPath, row.userBio, row.userAddressLine1, row.userPostcode,
      row.userNameEnc, row.userEmailEnc, row.userEmailHash, row.userBioEnc, row.userAddressEnc,
    ]) {
      expect(column).toBeNull();
    }

    expect(await db.select().from(conversation).where(eq(conversation.conversationId, ids.conversationId))).toHaveLength(0);
    expect(await db.select().from(message).where(eq(message.conversationId, ids.conversationId))).toHaveLength(0);
    expect(await db.select().from(refreshToken).where(eq(refreshToken.userId, userId))).toHaveLength(0);
    expect(await db.select().from(notification).where(eq(notification.recipientUserId, userId))).toHaveLength(0);
    expect(await db.select().from(kitchenProfile).where(eq(kitchenProfile.userId, userId))).toHaveLength(0);
    expect(await db.select().from(userOrganisation).where(eq(userOrganisation.userId, userId))).toHaveLength(0);
    expect(await db.select().from(userRole).where(eq(userRole.userId, userId))).toHaveLength(0);
    expect(await db.select().from(recipe).where(eq(recipe.recipeId, ids.recipeId))).toHaveLength(0);
    expect(await db.select().from(recipeReview).where(eq(recipeReview.recipeId, ids.recipeId))).toHaveLength(0);

    const [waste] = await db.select().from(wasteLog).where(eq(wasteLog.wasteLogId, ids.wasteLogId));
    expect(waste, "business history is kept").toBeDefined();
    expect(waste.userId).toBe(userId);
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.entityType, "it_test"), eq(auditLog.actorUserId, userId)));
    expect(audit, "the audit trail is kept").toHaveLength(1);
    const anonymisedEntry = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, "user"), eq(auditLog.entityId, String(userId))));
    expect(anonymisedEntry.map((a) => a.action)).toEqual(["anonymised"]);
    expect(anonymisedEntry[0].actorUserId).toBe(adminId);

    await expect(loginUser(email, "Passw0rd!-it-anon")).rejects.toThrow();

    const listed = await listAllUsers(1, 1000);
    expect(listed.users.map((u) => u.userId), "deleted users are hidden from the admin list").not.toContain(userId);
  });

  it("is idempotent: a second call changes nothing and logs nothing more", async () => {
    const { userId } = await makeUser("idem");
    await anonymiseUser(userId, adminId);
    await expect(anonymiseUser(userId, adminId)).resolves.toBeUndefined();
    const entries = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, "user"), eq(auditLog.entityId, String(userId))));
    expect(entries).toHaveLength(1);
  });

  it("throws 'User not found' for an id that does not exist", async () => {
    await expect(anonymiseUser(2_000_000_000, adminId)).rejects.toThrow("User not found");
  });

  it("cancels the Stripe subscription first, and does nothing else if that fails", async () => {
    const { userId, email } = await makeUser("stripe");
    await db.update(user).set({ stripeSubscriptionId: "sub_it_test" }).where(eq(user.userId, userId));
    const ids = await seedPersonalAndBusinessRows(userId);

    vi.mocked(cancelSubscriptionNow).mockRejectedValueOnce(new Error("stripe down"));
    await expect(anonymiseUser(userId, adminId)).rejects.toBeInstanceOf(UserAnonymisationError);

    const [untouched] = await db.select().from(user).where(eq(user.userId, userId));
    expect(untouched.userEmail).toBe(email);
    expect(untouched.userStatus).not.toBe("deleted");
    expect(await db.select().from(conversation).where(eq(conversation.conversationId, ids.conversationId))).toHaveLength(1);

    vi.mocked(cancelSubscriptionNow).mockResolvedValueOnce(undefined);
    await anonymiseUser(userId, adminId);
    expect(cancelSubscriptionNow).toHaveBeenLastCalledWith("sub_it_test");
    const [done] = await db.select().from(user).where(eq(user.userId, userId));
    expect(done.userStatus).toBe("deleted");
  });
});

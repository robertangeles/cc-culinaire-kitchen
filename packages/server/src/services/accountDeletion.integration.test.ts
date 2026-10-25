import { describe, it, expect, afterAll, vi } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

vi.mock("./stripeService.js", () => ({ cancelSubscriptionNow: vi.fn() }));

import { and, eq } from "drizzle-orm";
import { generate as otpGenerate, generateSecret as otpGenerateSecret } from "otplib";
import { db } from "../db/index.js";
import { auditLog, organisation, user, userOrganisation, userRole } from "../db/schema.js";
import { registerUser } from "./authService.js";
import { createOrganisation } from "./organisationService.js";
import { getUserProfile } from "./userService.js";
import { AccountDeletionError, deleteOwnAccount } from "./accountDeletionService.js";

/**
 * Real-database behaviour of a user deleting their own account: proof of identity
 * (password, typed email for Google-only accounts, MFA code), the organisation
 * ownership block, and that a refused request changes nothing. Gated on TENANT_IT=1
 * like the other integration suites. Stripe is mocked: no external call is made.
 */
const RUN = process.env.TENANT_IT === "1";
const tag = `it-selfdel-${Date.now()}`;
const PASSWORD = "Passw0rd!-it-selfdel";

describe.skipIf(!RUN)("deleteOwnAccount (real DB)", { timeout: 120_000 }, () => {
  const userIds: number[] = [];
  const orgIds: number[] = [];

  async function makeUser(label: string): Promise<{ userId: number; email: string }> {
    const email = `${tag}-${label}@it.test`;
    const userId = await registerUser(`Real Name ${label}`, email, PASSWORD);
    userIds.push(userId);
    return { userId, email };
  }
  const statusOf = async (userId: number) =>
    (await db.select({ s: user.userStatus }).from(user).where(eq(user.userId, userId)))[0].s;
  const refusal = async (p: Promise<unknown>) => p.then(() => null, (e) => e as AccountDeletionError);

  afterAll(async () => {
    for (const id of userIds) {
      await db.delete(auditLog).where(eq(auditLog.actorUserId, id));
      await db.delete(auditLog).where(and(eq(auditLog.entityType, "user"), eq(auditLog.entityId, String(id))));
      await db.delete(userOrganisation).where(eq(userOrganisation.userId, id));
      await db.delete(userRole).where(eq(userRole.userId, id));
    }
    for (const orgId of orgIds) await db.delete(organisation).where(eq(organisation.organisationId, orgId));
    for (const id of userIds) await db.delete(user).where(eq(user.userId, id));
  });

  it("refuses a wrong or missing password and changes nothing", async () => {
    const { userId } = await makeUser("pw");
    for (const input of [{ password: "wrong-password" }, {}]) {
      const err = await refusal(deleteOwnAccount(userId, input));
      expect(err).toBeInstanceOf(AccountDeletionError);
      expect(err?.statusCode).toBe(403);
      expect(err?.code).toBe("INVALID_CREDENTIALS");
    }
    expect(await statusOf(userId)).not.toBe("deleted");
  });

  it("the profile tells the client whether the account has a password, without leaking the hash", async () => {
    const { userId } = await makeUser("hasPw");
    const withPassword = await getUserProfile(userId);
    expect(withPassword?.hasPassword).toBe(true);
    expect(withPassword).not.toHaveProperty("userPasswordHash");
    await db.update(user).set({ userPasswordHash: null }).where(eq(user.userId, userId));
    expect((await getUserProfile(userId))?.hasPassword).toBe(false);
  });

  it("deletes the account with the right password", async () => {
    const { userId } = await makeUser("pw-ok");
    await deleteOwnAccount(userId, { password: PASSWORD });
    expect(await statusOf(userId)).toBe("deleted");
    const [row] = await db.select().from(user).where(eq(user.userId, userId));
    expect(row.userName).toBe("Deleted user");
    const entries = await db.select().from(auditLog).where(and(eq(auditLog.entityType, "user"), eq(auditLog.entityId, String(userId))));
    expect(entries.map((e) => [e.action, e.actorUserId])).toEqual([["anonymised", userId]]);
  });

  it("a deleted account cannot delete again", async () => {
    const { userId } = await makeUser("twice");
    await deleteOwnAccount(userId, { password: PASSWORD });
    const err = await refusal(deleteOwnAccount(userId, { password: PASSWORD }));
    expect(err?.statusCode).toBe(403);
  });

  it("Google-only account (no password): needs the email typed back, any case", async () => {
    const { userId, email } = await makeUser("oauth");
    await db.update(user).set({ userPasswordHash: null }).where(eq(user.userId, userId));

    for (const input of [{}, { confirmEmail: "someone-else@it.test" }, { password: PASSWORD }]) {
      const err = await refusal(deleteOwnAccount(userId, input));
      expect(err?.statusCode).toBe(403);
    }
    expect(await statusOf(userId)).not.toBe("deleted");

    await deleteOwnAccount(userId, { confirmEmail: `  ${email.toUpperCase()} ` });
    expect(await statusOf(userId)).toBe("deleted");
  });

  it("with MFA on: needs a valid current code in addition to the password", async () => {
    const { userId } = await makeUser("mfa");
    const secret = otpGenerateSecret();
    await db.update(user).set({ mfaEnabledInd: true, mfaSecret: secret }).where(eq(user.userId, userId));

    expect((await refusal(deleteOwnAccount(userId, { password: PASSWORD })))?.code).toBe("MFA_REQUIRED");
    expect((await refusal(deleteOwnAccount(userId, { password: PASSWORD, mfaCode: "000000" })))?.code).toBe("INVALID_MFA_CODE");
    expect((await refusal(deleteOwnAccount(userId, { password: "wrong", mfaCode: await otpGenerate({ secret }) })))?.code).toBe("INVALID_CREDENTIALS");
    expect(await statusOf(userId)).not.toBe("deleted");

    await deleteOwnAccount(userId, { password: PASSWORD, mfaCode: await otpGenerate({ secret }) });
    expect(await statusOf(userId)).toBe("deleted");
  });

  it("blocks the only admin of an organisation that still has other members, until another admin exists", async () => {
    const owner = await makeUser("owner");
    const member = await makeUser("member");
    const org = await createOrganisation(owner.userId, { name: `${tag}-org` });
    orgIds.push(org.organisationId);
    await db.insert(userOrganisation).values({ userId: member.userId, organisationId: org.organisationId, role: "member" });

    const err = await refusal(deleteOwnAccount(owner.userId, { password: PASSWORD }));
    expect(err?.statusCode).toBe(409);
    expect(err?.code).toBe("OWNERSHIP_TRANSFER_REQUIRED");
    expect(err?.message).toContain(`${tag}-org`);
    expect(await statusOf(owner.userId)).not.toBe("deleted");

    await db
      .update(userOrganisation)
      .set({ role: "admin" })
      .where(and(eq(userOrganisation.userId, member.userId), eq(userOrganisation.organisationId, org.organisationId)));
    await deleteOwnAccount(owner.userId, { password: PASSWORD });
    expect(await statusOf(owner.userId)).toBe("deleted");
  });

  it("lets the only member of an organisation delete their account", async () => {
    const solo = await makeUser("solo");
    const org = await createOrganisation(solo.userId, { name: `${tag}-solo-org` });
    orgIds.push(org.organisationId);
    await deleteOwnAccount(solo.userId, { password: PASSWORD });
    expect(await statusOf(solo.userId)).toBe("deleted");
  });
});

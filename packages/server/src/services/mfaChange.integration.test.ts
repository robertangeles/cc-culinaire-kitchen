import { describe, it, expect, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq } from "drizzle-orm";
import { generate as otpGenerate, generateSecret as otpGenerateSecret } from "otplib";
import { db } from "../db/index.js";
import { auditLog, user, userRole } from "../db/schema.js";
import { AuthError, disableMfa, generateMfaSecret, registerUser } from "./authService.js";

/**
 * Real-database behaviour of changing two-factor settings: a session alone must not be able to
 * start enrolment, replace the secret of an account that already has MFA, or switch MFA off.
 * Gated on TENANT_IT=1 like the other integration suites.
 */
const RUN = process.env.TENANT_IT === "1";
const tag = `it-mfachg-${Date.now()}`;
const PASSWORD = "Passw0rd!-it-mfachg";
const MINUTE = 60_000;

describe.skipIf(!RUN)("changing MFA settings (real DB)", { timeout: 120_000 }, () => {
  const userIds: number[] = [];

  async function makeUser(label: string): Promise<number> {
    const userId = await registerUser(`Real Name ${label}`, `${tag}-${label}@it.test`, PASSWORD);
    userIds.push(userId);
    return userId;
  }
  /** An account that already has MFA on, with a known secret. */
  async function makeMfaUser(label: string): Promise<{ userId: number; secret: string }> {
    const userId = await makeUser(label);
    const secret = otpGenerateSecret();
    await db.update(user).set({ mfaSecret: secret, mfaEnabledInd: true }).where(eq(user.userId, userId));
    return { userId, secret };
  }
  const mfaState = async (userId: number) =>
    (await db.select({ secret: user.mfaSecret, enabled: user.mfaEnabledInd }).from(user).where(eq(user.userId, userId)))[0];
  const refusal = async (p: Promise<unknown>) => p.then(() => null, (e) => e as AuthError);
  /** A TOTP is only valid in its 30-second step and the dev DB is remote, so retry with a fresh code. */
  async function disableWithFreshCode(userId: number, secret: string) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await disableMfa(userId, { password: PASSWORD, mfaCode: await otpGenerate({ secret }) }, null);
      } catch (e) {
        if (attempt >= 3 || !(e instanceof AuthError) || e.code !== "INVALID_MFA_CODE") throw e;
      }
    }
  }

  afterAll(async () => {
    for (const id of userIds) {
      await db.delete(auditLog).where(eq(auditLog.actorUserId, id));
      await db.delete(userRole).where(eq(userRole.userId, id));
    }
    for (const id of userIds) await db.delete(user).where(eq(user.userId, id));
  });

  it("refuses to start enrolment without the right password, and stores nothing", async () => {
    const userId = await makeUser("setup-pw");
    for (const proof of [{}, { password: "wrong-password" }]) {
      const err = await refusal(generateMfaSecret(userId, proof, null));
      expect(err).toBeInstanceOf(AuthError);
      expect(err?.code).toBe("INVALID_CREDENTIALS");
      expect(err?.statusCode).toBe(403);
    }
    expect((await mfaState(userId)).secret).toBeNull();
  });

  it("starts enrolment with the right password and stores the pending secret", async () => {
    const userId = await makeUser("setup-ok");
    const result = await generateMfaSecret(userId, { password: PASSWORD }, null);
    expect(result.secret).toBeTruthy();
    expect(await mfaState(userId)).toEqual({ secret: result.secret, enabled: false });
  });

  it("will not replace the secret of an account that already has MFA, whatever is sent", async () => {
    const { userId, secret } = await makeMfaUser("setup-on");
    const err = await refusal(generateMfaSecret(userId, { password: PASSWORD }, new Date()));
    expect(err?.code).toBe("MFA_ALREADY_ENABLED");
    expect(err?.statusCode).toBe(409);
    expect(await mfaState(userId)).toEqual({ secret, enabled: true });
  });

  it("refuses to switch MFA off without the password, then without the authenticator code, then with a wrong one", async () => {
    const { userId, secret } = await makeMfaUser("disable-refused");

    const noPassword = await refusal(disableMfa(userId, { mfaCode: await otpGenerate({ secret }) }, null));
    expect(noPassword?.code).toBe("INVALID_CREDENTIALS");

    const noCode = await refusal(disableMfa(userId, { password: PASSWORD }, null));
    expect(noCode?.code).toBe("MFA_REQUIRED");
    expect(noCode?.statusCode).toBe(403);

    const wrongCode = await refusal(disableMfa(userId, { password: PASSWORD, mfaCode: "000000" }, null));
    expect(wrongCode?.code).toBe("INVALID_MFA_CODE");

    expect(await mfaState(userId)).toEqual({ secret, enabled: true });
  });

  it("switches MFA off with the password and a valid authenticator code, clearing the secret", async () => {
    const { userId, secret } = await makeMfaUser("disable-ok");
    await disableWithFreshCode(userId, secret);
    expect(await mfaState(userId)).toEqual({ secret: null, enabled: false });
  });

  it("lets a user with MFA off cancel a pending enrolment using only the password", async () => {
    const userId = await makeUser("cancel-pending");
    await generateMfaSecret(userId, { password: PASSWORD }, null);
    await disableMfa(userId, { password: PASSWORD }, null);
    expect(await mfaState(userId)).toEqual({ secret: null, enabled: false });
  });

  it("a Google-only account needs a sign-in within the last 10 minutes to start enrolment or switch MFA off", async () => {
    const userId = await makeUser("no-password");
    await db.update(user).set({ userPasswordHash: null }).where(eq(user.userId, userId));

    for (const signedInAt of [null, new Date(Date.now() - 11 * MINUTE)]) {
      const setup = await refusal(generateMfaSecret(userId, {}, signedInAt));
      expect(setup?.code).toBe("RECENT_SIGN_IN_REQUIRED");
      expect(setup?.statusCode).toBe(403);
      const off = await refusal(disableMfa(userId, {}, signedInAt));
      expect(off?.code).toBe("RECENT_SIGN_IN_REQUIRED");
    }
    expect((await mfaState(userId)).secret).toBeNull();

    const result = await generateMfaSecret(userId, {}, new Date(Date.now() - MINUTE));
    expect((await mfaState(userId)).secret).toBe(result.secret);
  });

  it("a Google-only account with MFA on still needs the authenticator code to switch it off", async () => {
    const { userId, secret } = await makeMfaUser("no-password-mfa");
    await db.update(user).set({ userPasswordHash: null }).where(eq(user.userId, userId));
    const recent = new Date();

    const err = await refusal(disableMfa(userId, {}, recent));
    expect(err?.code).toBe("MFA_REQUIRED");
    expect(await mfaState(userId)).toEqual({ secret, enabled: true });
  });
});

import { describe, it, expect, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { refreshToken, user, userRole } from "../db/schema.js";
import { generateTokens, loginUser, registerUser } from "./authService.js";
import { changePassword } from "./userService.js";

/**
 * Real-database behaviour of changing a password: the caller's own session survives, every other
 * sign-in is ended, and a wrong current password changes nothing. Gated on TENANT_IT=1 like the
 * other integration suites.
 */
const RUN = process.env.TENANT_IT === "1";
const tag = `it-pwchg-${Date.now()}`;
const PASSWORD = "Passw0rd!-it-pwchg";
const NEW_PASSWORD = "N3wPassw0rd!-it-pwchg";

describe.skipIf(!RUN)("changing the password (real DB)", { timeout: 120_000 }, () => {
  const userIds: number[] = [];

  /** An account with two live sign-ins, as when the user is on a phone and a laptop. */
  async function makeUserWithTwoSessions(label: string) {
    const email = `${tag}-${label}@it.test`;
    const userId = await registerUser(`Real Name ${label}`, email, PASSWORD);
    userIds.push(userId);
    const signIn = async () => {
      const result = await loginUser(email, PASSWORD);
      if (result.requiresMfa) throw new Error("a new account has no MFA");
      return (await generateTokens(result.user)).refreshToken;
    };
    return { userId, first: await signIn(), second: await signIn() };
  }
  const sessions = async (userId: number) =>
    (await db.select({ id: refreshToken.refreshTokenId }).from(refreshToken).where(eq(refreshToken.userId, userId))).length;

  afterAll(async () => {
    for (const id of userIds) {
      await db.delete(refreshToken).where(eq(refreshToken.userId, id));
      await db.delete(userRole).where(eq(userRole.userId, id));
    }
    for (const id of userIds) await db.delete(user).where(eq(user.userId, id));
  });

  it("keeps the caller's session and ends the others", async () => {
    const { userId, first } = await makeUserWithTwoSessions("keep");
    expect(await sessions(userId)).toBe(2);
    await changePassword(userId, PASSWORD, NEW_PASSWORD, first);
    expect(await sessions(userId)).toBe(1);
  });

  it("ends every session when the caller's own cannot be identified", async () => {
    const { userId } = await makeUserWithTwoSessions("all");
    await changePassword(userId, PASSWORD, NEW_PASSWORD);
    expect(await sessions(userId)).toBe(0);
  });

  it("changes nothing when the current password is wrong", async () => {
    const { userId, first } = await makeUserWithTwoSessions("wrong");
    await expect(changePassword(userId, "not-the-password", NEW_PASSWORD, first)).rejects.toThrow(
      "Current password is incorrect."
    );
    expect(await sessions(userId)).toBe(2);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { user, refreshToken } from "../db/schema.js";
import {
  generateTokens,
  refreshAccessToken,
  revokeRefreshToken,
  getSignInTime,
  getUserWithRolesAndPermissions,
  loginUser,
  verifyAccessToken,
  mfaSessionUserId,
} from "./authService.js";
import { suspendUser, cancelUser, adminUpdateUser, changePassword } from "./userService.js";

/**
 * Refresh-token rotation, real DB: every refresh hands back a new token (30-day sliding), a lost reply
 * can be retried, a spent token used after the grace window revokes the whole sign-in, and a suspended
 * user's sessions die. Also: the MFA-pending token must never pass for an access token.
 *
 * Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";
const DAY = 24 * 3600 * 1000;
const sha = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

const fx = { tag: `rtr_${Date.now().toString(36)}`, userId: 0, mfaUserId: 0 };

async function rowFor(raw: string) {
  const [row] = await db.select().from(refreshToken).where(eq(refreshToken.tokenHash, sha(raw)));
  return row;
}

async function login() {
  return generateTokens(await getUserWithRolesAndPermissions(fx.userId));
}

async function expectRejected(raw: string, code: string) {
  await expect(refreshAccessToken(raw)).rejects.toMatchObject({ code });
}

describe.skipIf(!RUN)("refresh token rotation (real DB)", () => {
  beforeAll(async () => {
    // A real deployment sets this; with it set, the access and MFA signing keys used to be one and the same.
    process.env.JWT_ACCESS_SECRET = "rtr-test-secret";
    const hash = await bcrypt.hash("Passw0rd!", 4);
    [{ id: fx.userId }] = await db
      .insert(user)
      .values({ userName: "RTR", userEmail: `${fx.tag}@it.test`, userPasswordHash: hash, emailVerifiedInd: true })
      .returning({ id: user.userId });
    [{ id: fx.mfaUserId }] = await db
      .insert(user)
      .values({ userName: "RTR MFA", userEmail: `${fx.tag}-mfa@it.test`, userPasswordHash: hash, emailVerifiedInd: true, mfaEnabledInd: true })
      .returning({ id: user.userId });
  });

  afterAll(async () => {
    delete process.env.JWT_ACCESS_SECRET;
    for (const id of [fx.userId, fx.mfaUserId]) {
      await db.delete(refreshToken).where(eq(refreshToken.userId, id));
      await db.delete(user).where(eq(user.userId, id));
    }
  });

  it("hands back a new refresh token and marks the presented one as spent", async () => {
    const first = await login();

    const out = await refreshAccessToken(first.refreshToken);

    expect(out.refreshToken).toBeTruthy();
    expect(out.refreshToken).not.toBe(first.refreshToken);
    expect(out.accessToken).toBeTruthy();
    expect((await rowFor(first.refreshToken)).rotatedAtDttm).not.toBeNull();
    expect((await rowFor(out.refreshToken)).rotatedAtDttm).toBeNull();
  });

  it("the new token refreshes again, in the same family", async () => {
    const first = await login();
    const second = await refreshAccessToken(first.refreshToken);

    const third = await refreshAccessToken(second.refreshToken);

    expect(third.refreshToken).not.toBe(second.refreshToken);
    expect((await rowFor(third.refreshToken)).familyId).toBe((await rowFor(first.refreshToken)).familyId);
  });

  it("slides the expiry: the new token lives 30 days from now", async () => {
    const first = await login();
    await db
      .update(refreshToken)
      .set({ expiresAtDttm: new Date(Date.now() + 2 * DAY) })
      .where(eq(refreshToken.tokenHash, sha(first.refreshToken)));

    const out = await refreshAccessToken(first.refreshToken);

    const expires = (await rowFor(out.refreshToken)).expiresAtDttm.getTime();
    expect(Math.abs(expires - (Date.now() + 30 * DAY))).toBeLessThan(60_000);
  });

  it("a lost reply: presenting the spent token again returns the same new token", async () => {
    const first = await login();
    const out = await refreshAccessToken(first.refreshToken);

    const retry = await refreshAccessToken(first.refreshToken);

    expect(retry.refreshToken).toBe(out.refreshToken);
    // and that token still works
    expect((await refreshAccessToken(out.refreshToken)).refreshToken).toBeTruthy();
  });

  it("a lost reply retried a few minutes later still works while its new token is unused", async () => {
    const first = await login();
    const out = await refreshAccessToken(first.refreshToken);
    await db
      .update(refreshToken)
      .set({ rotatedAtDttm: new Date(Date.now() - 5 * 60_000) })
      .where(eq(refreshToken.tokenHash, sha(first.refreshToken)));

    expect((await refreshAccessToken(first.refreshToken)).refreshToken).toBe(out.refreshToken);
  });

  it("but not half an hour later, even if its new token was never used: that is a replay", async () => {
    const first = await login();
    const out = await refreshAccessToken(first.refreshToken);
    await db
      .update(refreshToken)
      .set({ rotatedAtDttm: new Date(Date.now() - 30 * 60_000) })
      .where(eq(refreshToken.tokenHash, sha(first.refreshToken)));

    await expectRejected(first.refreshToken, "REFRESH_TOKEN_REUSED");
    await expectRejected(out.refreshToken, "INVALID_REFRESH_TOKEN");
  });

  it("two refreshes at once with the same token both succeed with the same new token", async () => {
    const first = await login();

    const [a, b] = await Promise.all([refreshAccessToken(first.refreshToken), refreshAccessToken(first.refreshToken)]);

    expect(a.refreshToken).toBe(b.refreshToken);
  });

  it("reuse: a spent token used after the grace window, once its successor has been used, revokes the whole sign-in", async () => {
    const first = await login();
    const second = await refreshAccessToken(first.refreshToken);
    const third = await refreshAccessToken(second.refreshToken);
    await db
      .update(refreshToken)
      .set({ rotatedAtDttm: new Date(Date.now() - 10 * 60_000) })
      .where(eq(refreshToken.tokenHash, sha(first.refreshToken)));

    await expectRejected(first.refreshToken, "REFRESH_TOKEN_REUSED");

    // the family is gone, including the newest token
    await expectRejected(third.refreshToken, "INVALID_REFRESH_TOKEN");
    await expectRejected(second.refreshToken, "INVALID_REFRESH_TOKEN");
  });

  it("another sign-in of the same user is not touched by a reuse", async () => {
    const mine = await login();
    const other = await login();
    const a = await refreshAccessToken(other.refreshToken);
    const b = await refreshAccessToken(a.refreshToken);
    await db
      .update(refreshToken)
      .set({ rotatedAtDttm: new Date(Date.now() - 10 * 60_000) })
      .where(eq(refreshToken.tokenHash, sha(other.refreshToken)));
    await expectRejected(other.refreshToken, "REFRESH_TOKEN_REUSED");

    expect((await refreshAccessToken(mine.refreshToken)).refreshToken).toBeTruthy();
    void b;
  });

  it("an unknown token is INVALID_REFRESH_TOKEN, an expired one REFRESH_TOKEN_EXPIRED", async () => {
    await expectRejected("not-a-token", "INVALID_REFRESH_TOKEN");
    const first = await login();
    await db
      .update(refreshToken)
      .set({ expiresAtDttm: new Date(Date.now() - 1000) })
      .where(eq(refreshToken.tokenHash, sha(first.refreshToken)));
    await expectRejected(first.refreshToken, "REFRESH_TOKEN_EXPIRED");
  });

  it("the time of the original sign-in survives every refresh", async () => {
    const signedIn = new Date(Date.now() - 5 * 60_000);
    const first = await generateTokens(await getUserWithRolesAndPermissions(fx.userId), { signedInAt: signedIn });

    const out = await refreshAccessToken(first.refreshToken);
    const again = await refreshAccessToken(out.refreshToken);

    for (const raw of [first.refreshToken, out.refreshToken, again.refreshToken]) {
      expect(Math.abs((await getSignInTime(raw, fx.userId))!.getTime() - signedIn.getTime())).toBeLessThan(1000);
    }
  });

  it("logout (revoking the presented token) ends the whole sign-in, not one row", async () => {
    const first = await login();
    const second = await refreshAccessToken(first.refreshToken);
    const third = await refreshAccessToken(second.refreshToken);

    await revokeRefreshToken(third.refreshToken);

    for (const raw of [first.refreshToken, second.refreshToken, third.refreshToken]) {
      await expectRejected(raw, "INVALID_REFRESH_TOKEN");
    }
  });

  it("changing the password ends every other sign-in and every spent copy of the caller's own, keeping only its live token", async () => {
    const other = await login();
    const first = await login();
    const head = await refreshAccessToken(first.refreshToken);

    await changePassword(fx.userId, "Passw0rd!", "N3wPassw0rd!", head.refreshToken);

    expect(await rowFor(other.refreshToken)).toBeUndefined();
    expect(await rowFor(first.refreshToken)).toBeUndefined();
    expect(await rowFor(head.refreshToken)).toBeDefined();
    expect((await refreshAccessToken(head.refreshToken)).refreshToken).toBeTruthy();
  });

  describe("account status", () => {
    it("suspending the user deletes every session, and a suspended user cannot refresh", async () => {
      const a = await login();
      const b = await login();

      await suspendUser(fx.userId);
      try {
        await expectRejected(a.refreshToken, "INVALID_REFRESH_TOKEN");
        await expectRejected(b.refreshToken, "INVALID_REFRESH_TOKEN");
      } finally {
        await db.update(user).set({ userStatus: "active" }).where(eq(user.userId, fx.userId));
      }
    });

    it("a token that somehow survives still cannot refresh while the account is suspended", async () => {
      const a = await login();
      await db.update(user).set({ userStatus: "suspended" }).where(eq(user.userId, fx.userId));
      try {
        await expectRejected(a.refreshToken, "ACCOUNT_SUSPENDED");
        expect(await rowFor(a.refreshToken)).toBeUndefined();
      } finally {
        await db.update(user).set({ userStatus: "active" }).where(eq(user.userId, fx.userId));
      }
    });

    it("cancelling the user, or an admin setting the status, also deletes the sessions", async () => {
      const a = await login();
      await cancelUser(fx.userId);
      await expectRejected(a.refreshToken, "INVALID_REFRESH_TOKEN");

      await db.update(user).set({ userStatus: "active" }).where(eq(user.userId, fx.userId));
      const b = await login();
      await adminUpdateUser(fx.userId, { userStatus: "suspended" });
      await expectRejected(b.refreshToken, "INVALID_REFRESH_TOKEN");
      await db.update(user).set({ userStatus: "active" }).where(eq(user.userId, fx.userId));
    });
  });

  describe("MFA session token", () => {
    async function mfaToken() {
      const out = await loginUser(`${fx.tag}-mfa@it.test`, "Passw0rd!");
      if (!out.requiresMfa) throw new Error("expected an MFA challenge");
      return out.mfaSessionToken;
    }

    it("still identifies the account to the MFA step", async () => {
      expect(mfaSessionUserId(await mfaToken())).toBe(fx.mfaUserId);
    });

    it("is not accepted as an access token", async () => {
      const token = await mfaToken();
      expect(() => verifyAccessToken(token)).toThrow();
    });

    it("a token signed with the access secret that carries the mfa purpose is not an access token either", () => {
      const legacy = jwt.sign({ sub: fx.mfaUserId, purpose: "mfa" }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "5m" });
      expect(() => verifyAccessToken(legacy)).toThrow();
    });

    it("a real access token still verifies", async () => {
      const t = await login();
      expect(verifyAccessToken(t.accessToken).sub).toBe(fx.userId);
    });
  });
});

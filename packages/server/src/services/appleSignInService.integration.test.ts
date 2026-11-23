import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

vi.mock("./stripeService.js", () => ({ cancelSubscriptionNow: vi.fn(), deleteCustomer: vi.fn() }));
const resetEmails: Array<{ to: string; token: string }> = [];
vi.mock("./emailService.js", () => ({
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(async (to: string, _name: string, token: string) => void resetEmails.push({ to, token })),
}));

import jwt from "jsonwebtoken";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { appleRevocationRetries, auditLog, oauthAccount, user, userRole } from "../db/schema.js";
import { loginUser, registerUser, requestPasswordReset, resetPassword } from "./authService.js";
import { appleLinkOf, linkAppleToUser, retryAppleRevocations, signInWithApple, type AppleSignInInput } from "./appleSignInService.js";
import { AccountDeletionError, deleteOwnAccount } from "./accountDeletionService.js";
import { resetAppleKeyCache } from "./appleIdentity.js";
import { anonymiseUser } from "./userAnonymisationService.js";

/**
 * Real-database behaviour of Sign in with Apple: which account an Apple identity lands on, and what deleting that
 * account does at Apple. Tokens are signed here with a local key and Apple's three endpoints are a stubbed `fetch`,
 * so nothing reaches Apple. Gated on TENANT_IT=1 like the other integration suites.
 */
const RUN = process.env.TENANT_IT === "1";
const tag = `it-apple-${Date.now().toString(36)}`;
const CLIENT_ID = "com.culinairekitchen.chef.it";
const NONCE = "n-0123456789abcdef0123456789abcdef";
const PASSWORD = "Passw0rd!-it-apple";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });

let seq = 0;
const sub = () => `${tag}.${++seq}`;
const hashed = (n: string) => crypto.createHash("sha256").update(n).digest("hex");

function appleInput(claims: Record<string, unknown>, extra: Partial<AppleSignInInput> = {}): AppleSignInInput {
  const identityToken = jwt.sign({ nonce: hashed(NONCE), email_verified: "true", ...claims }, privateKey, {
    algorithm: "RS256",
    keyid: "itkey",
    issuer: "https://appleid.apple.com",
    audience: CLIENT_ID,
    expiresIn: "10m",
  });
  return { identityToken, nonce: NONCE, ...extra };
}

let revoked: string[];
let revokeStatus: number;

describe.skipIf(!RUN)("Sign in with Apple (real DB)", { timeout: 120_000 }, () => {
  const userIds: number[] = [];
  const queuedBefore = new Set<string>();
  const queuedHere = async () =>
    (await db.select().from(appleRevocationRetries)).filter((r) => !queuedBefore.has(r.id));

  const rows = (appleSub: string) =>
    db.select().from(oauthAccount).where(and(eq(oauthAccount.oauthProvider, "apple"), eq(oauthAccount.oauthProviderId, appleSub)));
  const userCount = async (email: string) => (await db.select({ id: user.userId }).from(user).where(eq(user.userEmail, email))).length;
  const track = (id: number) => (userIds.push(id), id);
  const refusal = (p: Promise<unknown>) => p.then(() => null, (e) => e as { code: string; statusCode: number });

  async function registered(label: string, opts: { verified?: boolean } = {}) {
    const email = `${tag}-${label}@it.test`;
    const userId = track(await registerUser(`Registered ${label}`, email, PASSWORD));
    await db.update(user).set({ emailVerifiedInd: opts.verified ?? true }).where(eq(user.userId, userId));
    return { userId, email };
  }

  beforeAll(async () => {
    process.env.APPLE_CLIENT_ID = CLIENT_ID;
    for (const r of await db.select({ id: appleRevocationRetries.id }).from(appleRevocationRetries)) queuedBefore.add(r.id);
  });

  beforeEach(() => {
    resetAppleKeyCache();
    revoked = [];
    revokeStatus = 200;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: URLSearchParams }) => {
        if (url.endsWith("/auth/keys")) return Response.json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "itkey", alg: "RS256" }] });
        if (url.endsWith("/auth/token")) return Response.json({ refresh_token: `refresh-for-${init!.body!.get("code")}` });
        if (url.endsWith("/auth/revoke")) {
          revoked.push(init!.body!.get("token")!);
          return Response.json({}, { status: revokeStatus });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.APPLE_TEAM_ID;
    delete process.env.APPLE_KEY_ID;
    delete process.env.APPLE_PRIVATE_KEY;
  });

  afterAll(async () => {
    delete process.env.APPLE_CLIENT_ID;
    const queued = (await queuedHere()).map((r) => r.id);
    if (queued.length > 0) await db.delete(appleRevocationRetries).where(inArray(appleRevocationRetries.id, queued));
    if (userIds.length === 0) return;
    await db.delete(oauthAccount).where(inArray(oauthAccount.userId, userIds));
    for (const id of userIds) {
      await db.delete(auditLog).where(eq(auditLog.actorUserId, id));
      await db.delete(auditLog).where(and(eq(auditLog.entityType, "user"), eq(auditLog.entityId, String(id))));
    }
    await db.delete(userRole).where(inArray(userRole.userId, userIds));
    await db.delete(user).where(inArray(user.userId, userIds));
  });

  const withRevocationKey = () => {
    process.env.APPLE_TEAM_ID = "TEAM123456";
    process.env.APPLE_KEY_ID = "KEY1234567";
    process.env.APPLE_PRIVATE_KEY = ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  };

  describe("a new person", () => {
    it("gets a verified Subscriber account named from the first-sign-in name, linked by Apple's subject", async () => {
      const s = sub();
      const email = `${tag}-new@it.test`;
      const authUser = await signInWithApple(appleInput({ sub: s, email }, { givenName: "Ada", familyName: "Lovelace" }));
      track(authUser.userId);
      expect(authUser).toMatchObject({ userName: "Ada Lovelace", userEmail: email, emailVerified: true, roles: ["Subscriber"] });
      expect((await rows(s))[0].userId).toBe(authUser.userId);
      const [row] = await db.select().from(user).where(eq(user.userId, authUser.userId));
      expect(row.userPasswordHash).toBeNull();
    });

    it("falls back to the part of a real address before the @ when no name was sent", async () => {
      const authUser = await signInWithApple(appleInput({ sub: sub(), email: `${tag}-noname@it.test` }));
      track(authUser.userId);
      expect(authUser.userName).toBe(`${tag}-noname`);
    });

    it("never takes a name from a hidden private-relay address, and does not match it to anyone", async () => {
      const authUser = await signInWithApple(appleInput({ sub: sub(), email: `${tag}abc@privaterelay.appleid.com`, is_private_email: "true" }));
      track(authUser.userId);
      expect(authUser.userName).toBe("Apple user");
    });

    it("is refused without an email, or with an email Apple has not verified, and creates nothing", async () => {
      const a = sub();
      expect(await refusal(signInWithApple(appleInput({ sub: a })))).toMatchObject({ code: "APPLE_EMAIL_MISSING", statusCode: 400 });
      const b = sub();
      expect(await refusal(signInWithApple(appleInput({ sub: b, email: `${tag}-unv@it.test`, email_verified: "false" })))).toMatchObject({
        code: "APPLE_EMAIL_NOT_VERIFIED",
        statusCode: 403,
      });
      expect(await rows(a)).toHaveLength(0);
      expect(await rows(b)).toHaveLength(0);
      expect(await userCount(`${tag}-unv@it.test`)).toBe(0);
    });
  });

  describe("a returning person", () => {
    it("lands on the same account every time, even when the token carries no email", async () => {
      const s = sub();
      const email = `${tag}-again@it.test`;
      const first = await signInWithApple(appleInput({ sub: s, email }));
      track(first.userId);
      const second = await signInWithApple(appleInput({ sub: s }));
      expect(second.userId).toBe(first.userId);
      expect(await userCount(email)).toBe(1);
      expect(await rows(s)).toHaveLength(1);
    });

    it("two first sign-ins racing for one new person make one account", async () => {
      const s = sub();
      const email = `${tag}-race@it.test`;
      const results = await Promise.all(Array.from({ length: 8 }, () => signInWithApple(appleInput({ sub: s, email }))));
      track(results[0].userId);
      expect(new Set(results.map((r) => r.userId)).size).toBe(1);
      expect(await userCount(email)).toBe(1);
      expect(await rows(s)).toHaveLength(1);
    });

    it("is refused for a suspended account, and for a cancelled one", async () => {
      const s = sub();
      const authUser = await signInWithApple(appleInput({ sub: s, email: `${tag}-susp@it.test` }));
      track(authUser.userId);
      await db.update(user).set({ userStatus: "suspended" }).where(eq(user.userId, authUser.userId));
      expect(await refusal(signInWithApple(appleInput({ sub: s })))).toMatchObject({ code: "ACCOUNT_SUSPENDED", statusCode: 403 });
      await db.update(user).set({ userStatus: "cancelled" }).where(eq(user.userId, authUser.userId));
      expect(await refusal(signInWithApple(appleInput({ sub: s })))).toMatchObject({ code: "ACCOUNT_CANCELLED", statusCode: 403 });
    });
  });

  describe("linking to an account that already exists", () => {
    it("links by a verified matching email: same account, nothing new created, its password untouched", async () => {
      const { userId, email } = await registered("match");
      const s = sub();
      const authUser = await signInWithApple(appleInput({ sub: s, email: email.toUpperCase() }));
      expect(authUser.userId).toBe(userId);
      expect(await userCount(email)).toBe(1);
      expect((await rows(s))[0].userId).toBe(userId);
      const [row] = await db.select().from(user).where(eq(user.userId, userId));
      expect(row.userPasswordHash).not.toBeNull();
    });

    it("refuses a matching email on an account that never verified it, and links nothing", async () => {
      const { email } = await registered("unverified", { verified: false });
      const s = sub();
      expect(await refusal(signInWithApple(appleInput({ sub: s, email })))).toMatchObject({ code: "ACCOUNT_EMAIL_UNVERIFIED", statusCode: 409 });
      expect(await rows(s)).toHaveLength(0);
    });

    it("never links a hidden private-relay address by email: it is a new account", async () => {
      const { userId } = await registered("relay");
      const authUser = await signInWithApple(appleInput({ sub: sub(), email: `${tag}relay@privaterelay.appleid.com`, is_private_email: "true" }));
      track(authUser.userId);
      expect(authUser.userId).not.toBe(userId);
    });

    it("refuses a matching email on a suspended account, and links nothing", async () => {
      const { userId, email } = await registered("suspended");
      await db.update(user).set({ userStatus: "suspended" }).where(eq(user.userId, userId));
      const s = sub();
      expect(await refusal(signInWithApple(appleInput({ sub: s, email })))).toMatchObject({ code: "ACCOUNT_SUSPENDED" });
      expect(await rows(s)).toHaveLength(0);
    });

    it("refuses a second, different Apple ID on an account that already has one, and links nothing", async () => {
      const { email } = await registered("two");
      await signInWithApple(appleInput({ sub: sub(), email }));
      const other = sub();
      expect(await refusal(signInWithApple(appleInput({ sub: other, email })))).toMatchObject({ code: "APPLE_ALREADY_LINKED", statusCode: 409 });
      expect(await rows(other)).toHaveLength(0);
    });
  });

  describe("the explicit link action (the way to join a hidden-email Apple account to a registered one)", () => {
    it("links the Apple ID to the signed-in account when the password is right, and the next Apple sign-in lands there", async () => {
      const { userId } = await registered("link");
      const s = sub();
      await linkAppleToUser(userId, appleInput({ sub: s, email: `${tag}-hidden1@privaterelay.appleid.com`, is_private_email: true }), { password: PASSWORD }, null);
      const next = await signInWithApple(appleInput({ sub: s }));
      expect(next.userId).toBe(userId);
    });

    it("refuses a wrong or missing password, and a Google-style account that did not sign in just now; links nothing", async () => {
      const { userId } = await registered("linkproof");
      const s = sub();
      const input = appleInput({ sub: s });
      expect(await refusal(linkAppleToUser(userId, input, { password: "wrong" }, null))).toMatchObject({ code: "INVALID_CREDENTIALS", statusCode: 403 });
      expect(await refusal(linkAppleToUser(userId, input, {}, null))).toMatchObject({ code: "INVALID_CREDENTIALS" });
      await db.update(user).set({ userPasswordHash: null }).where(eq(user.userId, userId));
      expect(await refusal(linkAppleToUser(userId, input, {}, null))).toMatchObject({ code: "RECENT_SIGN_IN_REQUIRED" });
      expect(await rows(s)).toHaveLength(0);
      await linkAppleToUser(userId, input, {}, new Date());
      expect(await rows(s)).toHaveLength(1);
    });

    it("answers a repeat of the same link with success, and refuses an Apple ID that belongs to someone else", async () => {
      const mine = await registered("repeat");
      const theirs = await registered("theirs");
      const s = sub();
      await linkAppleToUser(mine.userId, appleInput({ sub: s }), { password: PASSWORD }, null);
      await linkAppleToUser(mine.userId, appleInput({ sub: s }), { password: PASSWORD }, null);
      expect(await rows(s)).toHaveLength(1);
      expect(await refusal(linkAppleToUser(theirs.userId, appleInput({ sub: s }), { password: PASSWORD }, null))).toMatchObject({
        code: "APPLE_ALREADY_LINKED",
        statusCode: 409,
      });
    });

    it("refuses a different Apple ID on an account that already has one", async () => {
      const { userId } = await registered("alreadyhas");
      await linkAppleToUser(userId, appleInput({ sub: sub() }), { password: PASSWORD }, null);
      const other = sub();
      expect(await refusal(linkAppleToUser(userId, appleInput({ sub: other }), { password: PASSWORD }, null))).toMatchObject({
        code: "APPLE_ALREADY_LINKED",
      });
      expect(await rows(other)).toHaveLength(0);
    });
  });

  describe("Apple's refresh token and account deletion", () => {
    it("keeps the token encrypted, only when the Apple key is set up, and reads it back for deletion", async () => {
      const without = await signInWithApple(appleInput({ sub: sub(), email: `${tag}-nokey@it.test` }, { authorizationCode: "c0" }));
      track(without.userId);
      expect((await appleLinkOf(without.userId))?.refreshToken).toBeNull();

      withRevocationKey();
      const s = sub();
      const authUser = await signInWithApple(appleInput({ sub: s, email: `${tag}-key@it.test` }, { authorizationCode: "c1" }));
      track(authUser.userId);
      const [row] = await rows(s);
      expect(row.providerRefreshTokenEnc).toBeTruthy();
      expect(row.providerRefreshTokenEnc).not.toContain("refresh-for-c1");
      expect((await appleLinkOf(authUser.userId))?.refreshToken).toBe("refresh-for-c1");
    });

    it("deleting the account revokes Apple's token and removes the link", async () => {
      withRevocationKey();
      const authUser = await signInWithApple(appleInput({ sub: sub(), email: `${tag}-del@it.test` }, { authorizationCode: "c2" }));
      track(authUser.userId);
      await anonymiseUser(authUser.userId, authUser.userId);
      expect(revoked).toEqual(["refresh-for-c2"]);
      expect(await appleLinkOf(authUser.userId)).toBeNull();
      expect((await db.select({ s: user.userStatus }).from(user).where(eq(user.userId, authUser.userId)))[0].s).toBe("deleted");
    });

    it("a deleted person who signs in with Apple again starts a new account", async () => {
      const s = sub();
      const email = `${tag}-back@it.test`;
      const first = await signInWithApple(appleInput({ sub: s, email }));
      track(first.userId);
      await anonymiseUser(first.userId, first.userId);
      const again = await signInWithApple(appleInput({ sub: s, email }));
      track(again.userId);
      expect(again.userId).not.toBe(first.userId);
    });

    it("deletion still stands when Apple refuses the revoke, and the token waits (encrypted) in the retry queue until Apple accepts it", async () => {
      withRevocationKey();
      revokeStatus = 500;
      const authUser = await signInWithApple(appleInput({ sub: sub(), email: `${tag}-refuse@it.test` }, { authorizationCode: "c3" }));
      track(authUser.userId);
      await anonymiseUser(authUser.userId, authUser.userId);
      expect(revoked).toEqual(["refresh-for-c3"]);
      expect((await db.select({ s: user.userStatus }).from(user).where(eq(user.userId, authUser.userId)))[0].s).toBe("deleted");

      const [queued] = await queuedHere();
      expect(queued).toMatchObject({ attempts: 1 });
      expect(queued.refreshTokenEnc).not.toContain("refresh-for-c3");

      expect(await retryAppleRevocations()).toMatchObject({ revoked: 0 });
      expect((await queuedHere())[0].attempts).toBe(2);

      revokeStatus = 200;
      revoked = [];
      expect(await retryAppleRevocations()).toMatchObject({ revoked: 1 });
      expect(revoked).toEqual(["refresh-for-c3"]);
      expect(await queuedHere()).toHaveLength(0);
    });

    it("makes no Apple call when the account has no Apple link, or the key is not set up", async () => {
      const { userId } = await registered("plain");
      await anonymiseUser(userId, userId);
      const authUser = await signInWithApple(appleInput({ sub: sub(), email: `${tag}-nocall@it.test` }, { authorizationCode: "c4" }));
      track(authUser.userId);
      await anonymiseUser(authUser.userId, authUser.userId);
      expect(revoked).toEqual([]);
    });
  });

  describe("an Apple-only account deleting itself", () => {
    const signedIn = async (label: string, extra: Record<string, unknown> = {}) => {
      const s = sub();
      const authUser = await signInWithApple(appleInput({ sub: s, email: `${tag}-${label}@privaterelay.appleid.com`, is_private_email: "true", ...extra }));
      track(authUser.userId);
      return { ...authUser, sub: s };
    };

    it("is proven by a fresh Apple sign-in, with no typed email and no recent sign-in, and revokes at Apple", async () => {
      withRevocationKey();
      const a = await signedIn("delapple");
      const input = appleInput({ sub: a.sub }, { authorizationCode: undefined });
      await deleteOwnAccount(a.userId, { appleIdentityToken: input.identityToken, appleNonce: input.nonce }, null);
      expect((await db.select({ s: user.userStatus }).from(user).where(eq(user.userId, a.userId)))[0].s).toBe("deleted");
    });

    it("is refused for an Apple token issued more than five minutes ago, and deletes nothing", async () => {
      const a = await signedIn("delstale");
      const stale = appleInput({ sub: a.sub, iat: Math.floor(Date.now() / 1000) - 600 });
      const err = await refusal(deleteOwnAccount(a.userId, { appleIdentityToken: stale.identityToken, appleNonce: stale.nonce }, null));
      expect(err).toMatchObject({ code: "INVALID_CREDENTIALS", statusCode: 403 });
      expect((await db.select({ s: user.userStatus }).from(user).where(eq(user.userId, a.userId)))[0].s).not.toBe("deleted");
    });

    it("is refused for an Apple token of someone else's Apple ID, or a token that does not verify, and deletes nothing", async () => {
      const a = await signedIn("delmine");
      const b = await signedIn("delother");
      const theirs = appleInput({ sub: b.sub });
      const err = await refusal(deleteOwnAccount(a.userId, { appleIdentityToken: theirs.identityToken, appleNonce: theirs.nonce }, null));
      expect(err).toBeInstanceOf(AccountDeletionError);
      expect(err).toMatchObject({ code: "INVALID_CREDENTIALS", statusCode: 403 });
      const bad = await refusal(deleteOwnAccount(a.userId, { appleIdentityToken: "garbage", appleNonce: NONCE }, null));
      expect(bad).toMatchObject({ code: "INVALID_CREDENTIALS", statusCode: 403 });
      expect((await db.select({ s: user.userStatus }).from(user).where(eq(user.userId, a.userId)))[0].s).not.toBe("deleted");
    });

    it("still needs the typed email or a recent sign-in when no Apple proof is given", async () => {
      const a = await signedIn("delnoproof");
      expect(await refusal(deleteOwnAccount(a.userId, {}, null))).toMatchObject({ code: "INVALID_CREDENTIALS" });
    });

    it("does not replace the password of an account that has one", async () => {
      const { userId } = await registered("delpw");
      const t = appleInput({ sub: sub() });
      expect(await refusal(deleteOwnAccount(userId, { appleIdentityToken: t.identityToken, appleNonce: t.nonce }, null))).toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
    });
  });

  describe("web access for an Apple-only person", () => {
    it("can set a password with the ordinary forgot-password email, then sign in on the web with it", async () => {
      const email = `${tag}-web@it.test`;
      const authUser = await signInWithApple(appleInput({ sub: sub(), email }));
      track(authUser.userId);
      expect(await refusal(loginUser(email, PASSWORD))).toMatchObject({ code: "INVALID_CREDENTIALS" });

      await requestPasswordReset(email);
      expect(resetEmails.at(-1)?.to).toBe(email);
      await resetPassword(resetEmails.at(-1)!.token, PASSWORD);

      const result = await loginUser(email, PASSWORD);
      expect(result).toMatchObject({ requiresMfa: false, user: { userId: authUser.userId } });
    });
  });
});

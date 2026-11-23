import { describe, it, expect, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { db } from "../db/index.js";
import { guestSession, user } from "../db/schema.js";
import { checkUsageLimit, chargeSession, decrementFreeSessions } from "../middleware/usage.js";
import { checkGuestUsageLimit } from "../middleware/guestUsage.js";
import { incrementGuestSessions } from "./guestService.js";

/**
 * The free-session and guest-session counters under concurrent requests, and the 403 a spent quota answers with.
 * Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

const tag = `sq_${Date.now().toString(36)}`;
const users: number[] = [];
const tokens: string[] = [];

async function makeUser(over: Partial<typeof user.$inferInsert> = {}) {
  const [{ id }] = await db.insert(user).values({ userName: tag, userEmail: `${tag}-${users.length}@it.test`, ...over }).returning({ id: user.userId });
  users.push(id);
  return id;
}
async function makeGuest(sessionsUsed = 0) {
  const token = randomUUID();
  tokens.push(token);
  await db.insert(guestSession).values({ sessionToken: token, sessionsUsed });
  return token;
}
const freeOf = async (id: number) => (await db.select({ n: user.freeSessions }).from(user).where(eq(user.userId, id)))[0].n;
const usedOf = async (token: string) => (await db.select({ n: guestSession.sessionsUsed }).from(guestSession).where(eq(guestSession.sessionToken, token)))[0].n;

function answerOf(check: (req: Request, res: Response, next: () => void) => unknown, req: object) {
  return new Promise<{ status: number; body: Record<string, unknown> } | "next">((done) => {
    const res = { status(code: number) { (this as { code: number }).code = code; return this; }, json(body: Record<string, unknown>) { done({ status: (this as unknown as { code: number }).code, body }); } } as unknown as Response;
    Promise.resolve(check(req as Request, res, () => done("next")));
  });
}

describe.skipIf(!RUN)("session quota (real DB)", () => {
  afterAll(async () => {
    if (users.length) await db.delete(user).where(inArray(user.userId, users));
    if (tokens.length) await db.delete(guestSession).where(inArray(guestSession.sessionToken, tokens));
  });

  describe("free sessions", () => {
    it("ten concurrent charges against five sessions leave exactly zero, never negative and never short", async () => {
      const id = await makeUser({ freeSessions: 5 });
      await Promise.all(Array.from({ length: 10 }, () => decrementFreeSessions(id)));
      expect(await freeOf(id)).toBe(0);
    });

    it("three concurrent charges take exactly three", async () => {
      const id = await makeUser({ freeSessions: 5 });
      await Promise.all(Array.from({ length: 3 }, () => decrementFreeSessions(id)));
      expect(await freeOf(id)).toBe(2);
    });

    it("a paid subscriber's sessions are not touched", async () => {
      const id = await makeUser({ freeSessions: 5, subscriptionStatus: "active" });
      await decrementFreeSessions(id);
      expect(await freeOf(id)).toBe(5);
    });

    it("a spent quota answers 403 FREE_SESSIONS_EXHAUSTED, still carrying upgradeRequired for the web", async () => {
      const id = await makeUser({ freeSessions: 0 });
      const out = await answerOf(checkUsageLimit, { user: { sub: id } });
      expect(out).toMatchObject({ status: 403, body: { code: "FREE_SESSIONS_EXHAUSTED", upgradeRequired: true } });
    });
  });

  describe("guest sessions", () => {
    it("twelve concurrent charges count twelve", async () => {
      const token = await makeGuest();
      await Promise.all(Array.from({ length: 12 }, () => incrementGuestSessions(token)));
      expect(await usedOf(token)).toBe(12);
    });

    it("a guest at the limit answers 403 GUEST_QUOTA_EXHAUSTED, still carrying registrationRequired for the web", async () => {
      const token = await makeGuest(10);
      const out = await answerOf(checkGuestUsageLimit, { guestToken: token });
      expect(out).toMatchObject({ status: 403, body: { code: "GUEST_QUOTA_EXHAUSTED", registrationRequired: true } });
    });
  });

  describe("chargeSession", () => {
    it("charges the signed-in user when there is one, else the guest", async () => {
      const id = await makeUser({ freeSessions: 5 });
      const token = await makeGuest();
      await chargeSession({ user: { sub: id } } as Request);
      await chargeSession({ guestToken: token } as Request);
      expect([await freeOf(id), await usedOf(token)]).toEqual([4, 1]);
    });
  });
});

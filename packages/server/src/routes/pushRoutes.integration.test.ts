import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq, inArray } from "drizzle-orm";
import type { Request, Response } from "express";
import { db } from "../db/index.js";
import { deviceToken, pushOptOuts, pushQuietHours, refreshToken, user } from "../db/schema.js";
import {
  handleRegisterDevice,
  handleUnregisterDevice,
  handleGetPushPreferences,
  handleUpdatePushPreferences,
} from "../controllers/notificationsController.js";
import { handleLogout } from "../controllers/authController.js";
import { AuthError, generateTokens, getUserWithRolesAndPermissions, refreshAccessToken, refreshTokenFamily, revokeAllRefreshTokens, revokeRefreshToken } from "../services/authService.js";
import notificationsRouter from "./notifications.js";

/**
 * The phone's push endpoints, called through the real controllers against a real database.
 * Gated on TENANT_IT=1, like the other real-DB suites.
 */
const RUN = process.env.TENANT_IT === "1";
const tag = `pr_${Date.now().toString(36)}`;

type Handler = (req: Request, res: Response, next: (err?: unknown) => void) => Promise<void> | void;

/** Runs a handler the way Express would and returns what it answered. `userId` undefined = no valid token (authenticate would have refused first on the real route). */
async function call(handler: Handler, userId: number | undefined, body?: unknown, extra: Record<string, unknown> = {}) {
  return new Promise<{ status: number; body: any; error?: unknown }>((done) => {
    const out = { status: 200, body: undefined as unknown };
    const res = {
      status(n: number) { out.status = n; return res; },
      json(b: unknown) { out.body = b; done({ ...out, body: b }); return res; },
      clearCookie() { return res; },
      cookie() { return res; },
    } as unknown as Response;
    const req = { user: userId === undefined ? undefined : { sub: userId, roles: [], permissions: [] }, body, cookies: {}, ...extra } as unknown as Request;
    Promise.resolve(handler(req, res, (error) => done({ status: 500, body: undefined, error }))).catch((error) => done({ status: 500, body: undefined, error }));
  });
}

describe("push routes: wiring", () => {
  it("puts `authenticate` in front of register, unregister and both push-preferences routes", () => {
    const stack = (notificationsRouter as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string }> } }> }).stack;
    for (const [method, path] of [["post", "/register-device"], ["post", "/unregister-device"], ["get", "/push-preferences"], ["put", "/push-preferences"]]) {
      const layer = stack.find((l) => l.route?.path === path && l.route.methods[method]);
      expect(layer, `${method} ${path}`).toBeDefined();
      expect(layer!.route!.stack[0].name, `${method} ${path}`).toBe("authenticate");
    }
  });
});

describe.skipIf(!RUN)("push routes (real DB)", () => {
  let alice: number;
  let bob: number;
  const tok = (n: string) => `ExponentPushToken[${tag}-${n}]`;
  const tokensOf = async (...ids: number[]) => (await db.select().from(deviceToken).where(inArray(deviceToken.userId, ids))).map((r) => r.tokenValue).sort();

  beforeAll(async () => {
    [{ id: alice }] = await db.insert(user).values({ userName: `${tag} Alice`, userEmail: `${tag}-a@it.test` }).returning({ id: user.userId });
    [{ id: bob }] = await db.insert(user).values({ userName: `${tag} Bob`, userEmail: `${tag}-b@it.test` }).returning({ id: user.userId });
  });

  afterAll(async () => {
    const ids = [alice, bob];
    await db.delete(deviceToken).where(inArray(deviceToken.userId, ids));
    await db.delete(pushOptOuts).where(inArray(pushOptOuts.userId, ids));
    await db.delete(pushQuietHours).where(inArray(pushQuietHours.userId, ids));
    await db.delete(refreshToken).where(inArray(refreshToken.userId, ids));
    await db.delete(user).where(inArray(user.userId, ids));
  });

  describe("register-device", () => {
    it("401s without a signed-in user and 400s a bad body, both with a code", async () => {
      expect(await call(handleRegisterDevice, undefined, { deviceToken: tok("x"), platform: "ios" })).toMatchObject({ status: 401, body: { code: "UNAUTHENTICATED" } });
      expect(await call(handleRegisterDevice, alice, { platform: "ios" })).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
    });

    it("registers a token (200), and the same token moves to the next person who signs in on that device", async () => {
      expect((await call(handleRegisterDevice, alice, { deviceToken: tok("shared"), platform: "ios" })).status).toBe(200);
      expect(await tokensOf(alice)).toEqual([tok("shared")]);
      await call(handleRegisterDevice, bob, { deviceToken: tok("shared"), platform: "ios" });
      expect(await tokensOf(alice)).toEqual([]);
      expect(await tokensOf(bob)).toEqual([tok("shared")]);
      await db.delete(deviceToken).where(eq(deviceToken.userId, bob));
    });
  });

  describe("unregister-device", () => {
    it("removes the caller's own token (200)", async () => {
      await call(handleRegisterDevice, alice, { deviceToken: tok("a1"), platform: "android" });
      await call(handleRegisterDevice, alice, { deviceToken: tok("a2"), platform: "android" });
      expect((await call(handleUnregisterDevice, alice, { deviceToken: tok("a1") })).status).toBe(200);
      expect(await tokensOf(alice)).toEqual([tok("a2")]);
    });

    it("answers 200 again for a token that is already gone, so a repeat is safe", async () => {
      expect((await call(handleUnregisterDevice, alice, { deviceToken: tok("a1") })).status).toBe(200);
    });

    it("does not remove another person's token", async () => {
      await call(handleRegisterDevice, bob, { deviceToken: tok("b1"), platform: "ios" });
      expect((await call(handleUnregisterDevice, alice, { deviceToken: tok("b1") })).status).toBe(200);
      expect(await tokensOf(bob)).toEqual([tok("b1")]);
    });

    it("401s without a signed-in user and 400s a missing token, both with a code", async () => {
      expect(await call(handleUnregisterDevice, undefined, { deviceToken: tok("a2") })).toMatchObject({ status: 401, body: { code: "UNAUTHENTICATED" } });
      expect(await call(handleUnregisterDevice, alice, {})).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
      expect(await tokensOf(alice)).toEqual([tok("a2")]);
    });
  });

  describe("logout", () => {
    it("removes this device's token for the person who signs out, and revokes their session", async () => {
      const tokens = await generateTokens(await getUserWithRolesAndPermissions(alice));
      const res = await call(handleLogout, undefined, { refreshToken: tokens.refreshToken, deviceToken: tok("a2") });
      expect(res.status).toBe(200);
      expect(await tokensOf(alice)).toEqual([]);
      expect(await db.select().from(refreshToken).where(eq(refreshToken.userId, alice))).toEqual([]);
    });

    it("leaves a token that is not the signing-out person's", async () => {
      const tokens = await generateTokens(await getUserWithRolesAndPermissions(alice));
      const res = await call(handleLogout, undefined, { refreshToken: tokens.refreshToken, deviceToken: tok("b1") });
      expect(res.status).toBe(200);
      expect(await tokensOf(bob)).toEqual([tok("b1")]);
    });

    it("still logs out an older app that sends no device token, and a request with no session at all", async () => {
      const tokens = await generateTokens(await getUserWithRolesAndPermissions(alice));
      expect((await call(handleLogout, undefined, { refreshToken: tokens.refreshToken })).status).toBe(200);
      expect((await call(handleLogout, undefined, { deviceToken: tok("b1") })).status).toBe(200);
      expect(await tokensOf(bob)).toEqual([tok("b1")]); // no refresh token proves nothing: nobody's token is touched
    });

    it("removes the device token when the presented refresh token has expired", async () => {
      await call(handleRegisterDevice, alice, { deviceToken: tok("a3"), platform: "ios" });
      const tokens = await generateTokens(await getUserWithRolesAndPermissions(alice));
      await db.update(refreshToken).set({ expiresAtDttm: new Date(Date.now() - 1000) }).where(eq(refreshToken.userId, alice));
      expect((await call(handleLogout, undefined, { refreshToken: tokens.refreshToken, deviceToken: tok("a3") })).status).toBe(200);
      expect(await tokensOf(alice)).toEqual([]);
    });

    it("removes the device token when the presented refresh token was already rotated", async () => {
      await call(handleRegisterDevice, alice, { deviceToken: tok("a4"), platform: "ios" });
      const tokens = await generateTokens(await getUserWithRolesAndPermissions(alice));
      await refreshAccessToken(tokens.refreshToken);
      expect((await call(handleLogout, undefined, { refreshToken: tokens.refreshToken, deviceToken: tok("a4") })).status).toBe(200);
      expect(await tokensOf(alice)).toEqual([]);
    });

    it("answers 200 and removes nothing for a refresh token that matches no row", async () => {
      await call(handleRegisterDevice, alice, { deviceToken: tok("a5"), platform: "ios" });
      const res = await call(handleLogout, undefined, { refreshToken: "f".repeat(128), deviceToken: tok("a5") });
      expect(res.status).toBe(200);
      expect(await tokensOf(alice, bob)).toEqual([tok("a5"), tok("b1")]);
      await db.delete(deviceToken).where(eq(deviceToken.userId, alice));
    });
  });

  describe("sign-ins ended by the server", () => {
    const signIn = async (userId: number) => generateTokens(await getUserWithRolesAndPermissions(userId));
    const hashOf = (raw: string) => createHash("sha256").update(raw).digest("hex");
    const expire = (raw: string) => db.update(refreshToken).set({ expiresAtDttm: new Date(Date.now() - 1000) }).where(eq(refreshToken.tokenHash, hashOf(raw)));
    const register = (name: string, raw?: string) => call(handleRegisterDevice, alice, { deviceToken: tok(name), platform: "ios", refreshToken: raw });
    let phone: { refreshToken: string };
    let web: { refreshToken: string };

    /** Alice signed in on a phone and on the web: "phone" is registered under the phone's sign-in, "web" under the web's, "old" by a client that named none. */
    beforeEach(async () => {
      await db.delete(refreshToken).where(inArray(refreshToken.userId, [alice, bob]));
      await db.delete(deviceToken).where(eq(deviceToken.userId, alice));
      phone = await signIn(alice);
      web = await signIn(alice);
      await register("phone", phone.refreshToken);
      await register("web", web.refreshToken);
      await register("old");
    });

    it("register-device records the caller's sign-in, and none for a client that presents no refresh token or someone else's", async () => {
      const bobs = await signIn(bob);
      await register("stolen", bobs.refreshToken);
      const rows = await db.select().from(deviceToken).where(eq(deviceToken.userId, alice));
      const familyOf = (name: string) => rows.find((r) => r.tokenValue === tok(name))!.refreshFamilyId;
      expect(familyOf("phone")).toBe(await refreshTokenFamily(phone.refreshToken, alice));
      expect(familyOf("web")).toBe(await refreshTokenFamily(web.refreshToken, alice));
      expect(familyOf("phone")).not.toBe(familyOf("web"));
      expect(familyOf("old")).toBeNull();
      expect(familyOf("stolen")).toBeNull();
    });

    it("removes every device token of the person when all their sign-ins are revoked, and nobody else's", async () => {
      await revokeAllRefreshTokens(alice);
      expect(await tokensOf(alice, bob)).toEqual([tok("b1")]);
    });

    it("a password change on the web removes the signed-out phone's token and keeps the web's own", async () => {
      await revokeAllRefreshTokens(alice, await refreshTokenFamily(web.refreshToken, alice));
      expect(await tokensOf(alice)).toEqual([tok("old"), tok("web")]);
    });

    it("removes the phone's token when its sign-in is revoked for reuse of a spent refresh token", async () => {
      const second = await refreshAccessToken(phone.refreshToken);
      await refreshAccessToken(second.refreshToken);
      await db.update(refreshToken).set({ rotatedAtDttm: new Date(Date.now() - 60 * 60 * 1000) }).where(eq(refreshToken.tokenHash, hashOf(phone.refreshToken)));
      await expect(refreshAccessToken(phone.refreshToken)).rejects.toMatchObject({ code: "REFRESH_TOKEN_REUSED" });
      expect(await tokensOf(alice)).toEqual([tok("old"), tok("web")]);
    });

    it("removes the phone's token when its refresh token is refused as expired, and the rest when the last sign-in expires", async () => {
      await expire(phone.refreshToken);
      await expect(refreshAccessToken(phone.refreshToken)).rejects.toMatchObject({ code: "REFRESH_TOKEN_EXPIRED" });
      expect(await tokensOf(alice)).toEqual([tok("old"), tok("web")]);
      await expire(web.refreshToken);
      await expect(refreshAccessToken(web.refreshToken)).rejects.toMatchObject({ code: "REFRESH_TOKEN_EXPIRED" });
      expect(await tokensOf(alice)).toEqual([]);
    });

    it("removes the token of a sign-in that expired unnoticed the next time the person signs in", async () => {
      await expire(phone.refreshToken);
      await signIn(alice);
      expect(await tokensOf(alice)).toEqual([tok("old"), tok("web")]);
    });

    it("keeps the phone's token through a refresh, which rotates the token inside the same sign-in", async () => {
      const next = await refreshAccessToken(phone.refreshToken);
      await refreshAccessToken(next.refreshToken);
      expect(await tokensOf(alice)).toEqual([tok("old"), tok("phone"), tok("web")]);
    });

    it("logout removes the tokens registered under that sign-in even when the app sends no device token", async () => {
      expect((await call(handleLogout, undefined, { refreshToken: phone.refreshToken })).status).toBe(200);
      expect(await tokensOf(alice)).toEqual([tok("old"), tok("web")]);
    });

    it("keeps the phone's token when its session is re-minted as the same sign-in", async () => {
      const familyId = await refreshTokenFamily(phone.refreshToken, alice);
      await revokeRefreshToken(phone.refreshToken);
      const reminted = await generateTokens(await getUserWithRolesAndPermissions(alice), { familyId });
      await refreshAccessToken(reminted.refreshToken);
      expect(await tokensOf(alice)).toEqual([tok("old"), tok("phone"), tok("web")]);
    });

    it("removes the device tokens when a suspended account's refresh ends every sign-in", async () => {
      await db.update(user).set({ userStatus: "suspended" }).where(eq(user.userId, alice));
      await expect(refreshAccessToken(phone.refreshToken)).rejects.toBeInstanceOf(AuthError);
      await db.update(user).set({ userStatus: "active" }).where(eq(user.userId, alice));
      expect(await tokensOf(alice)).toEqual([]);
    });
  });

  describe("push-preferences", () => {
    it("401s without a signed-in user", async () => {
      expect(await call(handleGetPushPreferences, undefined)).toMatchObject({ status: 401, body: { code: "UNAUTHENTICATED" } });
      expect(await call(handleUpdatePushPreferences, undefined, {})).toMatchObject({ status: 401, body: { code: "UNAUTHENTICATED" } });
    });

    it("starts with every type on and no quiet hours", async () => {
      const { status, body } = await call(handleGetPushPreferences, alice);
      expect(status).toBe(200);
      expect(body.quietHours).toBeNull();
      expect(body.types.length).toBeGreaterThan(10);
      expect(body.types.every((t: { enabled: boolean; label: string }) => t.enabled && t.label.length > 0)).toBe(true);
    });

    it("switches types off, replaces the list on the next update, and leaves it alone when the key is left out", async () => {
      let r = await call(handleUpdatePushPreferences, alice, { disabledTypes: ["SHIFT_CHANGED", "SHIFT_CANCELLED"] });
      expect(r.status).toBe(200);
      const off = (b: any) => b.types.filter((t: any) => !t.enabled).map((t: any) => t.type).sort();
      expect(off(r.body)).toEqual(["SHIFT_CANCELLED", "SHIFT_CHANGED"]);
      r = await call(handleUpdatePushPreferences, alice, { disabledTypes: ["SHIFT_CHANGED", "DOCUMENT_REJECTED"] });
      expect(off(r.body)).toEqual(["DOCUMENT_REJECTED", "SHIFT_CHANGED"]);
      r = await call(handleUpdatePushPreferences, alice, { quietHours: { start: "22:00", end: "07:00", timeZone: "Australia/Sydney" } });
      expect(off(r.body)).toEqual(["DOCUMENT_REJECTED", "SHIFT_CHANGED"]);
      r = await call(handleUpdatePushPreferences, alice, { disabledTypes: [] });
      expect(off(r.body)).toEqual([]);
      expect(r.body.quietHours).toEqual({ start: "22:00", end: "07:00", timeZone: "Australia/Sydney" });
    });

    it("sets, changes and clears quiet hours", async () => {
      let r = await call(handleUpdatePushPreferences, alice, { quietHours: { start: "21:30", end: "06:15", timeZone: "Europe/London" } });
      expect(r.body.quietHours).toEqual({ start: "21:30", end: "06:15", timeZone: "Europe/London" });
      r = await call(handleUpdatePushPreferences, alice, { quietHours: null });
      expect(r.body.quietHours).toBeNull();
    });

    it("refuses bad input with 400 VALIDATION and changes nothing", async () => {
      for (const body of [
        { quietHours: { start: "25:00", end: "07:00", timeZone: "UTC" } },
        { quietHours: { start: "22:00", end: "22:00", timeZone: "UTC" } },
        { quietHours: { start: "22:00", end: "07:00", timeZone: "Mars/Olympus" } },
        { disabledTypes: ["NOT_A_TYPE"] },
        { disabledTypes: "SHIFT_CHANGED" },
      ]) {
        expect(await call(handleUpdatePushPreferences, alice, body), JSON.stringify(body)).toMatchObject({ status: 400, body: { code: "VALIDATION" } });
      }
      expect((await call(handleGetPushPreferences, alice)).body.quietHours).toBeNull();
    });

    it("keeps each person's settings to themselves", async () => {
      await call(handleUpdatePushPreferences, alice, { disabledTypes: ["BRAIN_NUDGE"], quietHours: { start: "23:00", end: "05:00", timeZone: "UTC" } });
      const mine = (await call(handleGetPushPreferences, bob)).body;
      expect(mine.quietHours).toBeNull();
      expect(mine.types.every((t: any) => t.enabled)).toBe(true);
    });
  });
});

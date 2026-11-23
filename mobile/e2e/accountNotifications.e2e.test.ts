import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generate } from "otplib";
import { NOTIFICATION_TYPES } from "@culinaire/shared/schemas/push";
import { createApiClient, type Tokens } from "../src/api/client";
import { createAuthApi } from "../src/api/auth";
import { createAccountApi } from "../src/api/account";
import { createNotificationsApi } from "../src/notifications/notificationsApi";
import { notificationHandlers } from "../src/notifications/notificationCommands";
import { createOutbox, type OutboxEntry } from "../src/outbox/outbox";
import { createInboxStore } from "../src/notifications/inboxStore";

/**
 * Profile, account security, the inbox and push settings against a real server, with the phone's own code and no UI: a person
 * who just registered edits their details and kitchen profile, changes their password, sets up and removes two-step verification,
 * reads the inbox, marks a notification read through the queue, and registers, configures and removes push for this device.
 * Needs the server on E2E_API_URL (default http://localhost:3009) with the push migration (0004) applied. The avatar upload needs
 * Cloudinary, so it is covered by the screen tests only. Skipped locally without E2E credentials, like the other e2e suites.
 */
const baseUrl = process.env.E2E_API_URL ?? "http://localhost:3009";
const newEmail = `ph-account-${Date.now().toString(36)}@culinaire.test`;
const FIRST_PASSWORD = "Phone-Account-Pass-1!";
const SECOND_PASSWORD = "Phone-Account-Pass-2!";
/** Set by the person running it to a notification id made for this account (see mobile/README.md), to check a real one is read. */
const seededNotification = process.env.E2E_NOTIFICATION_ID;

describe.skipIf(!process.env.CI && !process.env.E2E_USER_EMAIL)("profile, security, inbox and push against the real server", () => {
  let tokens: Tokens | null = null;
  let password = FIRST_PASSWORD;
  const tokenStore = { load: async () => tokens, save: async (t: Tokens) => void (tokens = t), clear: async () => void (tokens = null) };
  const client = createApiClient({ baseUrl, tokenStore, appVersion: "0.1.0-e2e", timeoutMs: 20_000 });
  const authApi = createAuthApi(client, tokenStore);
  const accountApi = createAccountApi(client, tokenStore);
  const notificationsApi = createNotificationsApi(client, tokenStore);
  let userId = 0;

  beforeAll(async () => {
    await authApi.register("Phone Account", newEmail, FIRST_PASSWORD);
    const result = await authApi.signIn(newEmail, FIRST_PASSWORD);
    if (result.status !== "signedIn") throw new Error("expected a plain sign-in");
    userId = result.user.userId;
  });

  afterAll(async () => {
    if (tokens) await accountApi.deleteAccount({ password }).catch(() => {});
  });

  it("saves every detail, clears an emptied one, and the person reads back the new name", async () => {
    const before = await accountApi.details();
    const { userEmail: _e, userPhotoPath: _p, ...fields } = before;
    await accountApi.saveDetails({ ...fields, userName: "Phone Account Edited", userSuburb: "Fitzroy", userCountry: "Australia", userInstagram: "https://instagram.com/x" });
    expect(await accountApi.details()).toMatchObject({ userName: "Phone Account Edited", userSuburb: "Fitzroy", userCountry: "Australia", userInstagram: "https://instagram.com/x" });
    const saved = await accountApi.details();
    const { userEmail: _e2, userPhotoPath: _p2, ...again } = saved;
    await accountApi.saveDetails({ ...again, userSuburb: "" });
    expect(await accountApi.details()).toMatchObject({ userSuburb: "", userCountry: "Australia" });
    expect((await authApi.me()).userName).toBe("Phone Account Edited");
  });

  it("saves the skill level alone and leaves the rest of the kitchen profile as it was", async () => {
    await accountApi.saveKitchenProfile({ skillLevel: "line_cook", restaurantName: "Before" });
    await accountApi.saveKitchenProfile({ skillLevel: "head_chef" });
    expect(await accountApi.kitchenProfile()).toMatchObject({ skillLevel: "head_chef", restaurantName: "Before" });
    const options = await accountApi.personalisationOptions();
    expect(Array.isArray(options.skill_level)).toBe(true);
  });

  it("changes the password: this sign-in keeps working, the old password no longer signs in", async () => {
    await expect(accountApi.changePassword("not-it", SECOND_PASSWORD)).rejects.toMatchObject({ code: "bad_request" });
    await accountApi.changePassword(FIRST_PASSWORD, SECOND_PASSWORD);
    password = SECOND_PASSWORD;
    expect((await authApi.me()).userEmail).toBe(newEmail);
    await expect(createAuthApi(client, { load: async () => null, save: async () => {}, clear: async () => {} }).signIn(newEmail, FIRST_PASSWORD)).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("sets up two-step verification with the password and the first code, then removes it with both", async () => {
    await expect(accountApi.mfaSetup({ password: "wrong" })).rejects.toMatchObject({ serverCode: "INVALID_CREDENTIALS" });
    const { secret, qrCodeDataUrl } = await accountApi.mfaSetup({ password });
    expect(qrCodeDataUrl).toMatch(/^data:image\/png/);
    await expect(accountApi.mfaEnable("000000")).rejects.toMatchObject({ code: "bad_request" });
    await accountApi.mfaEnable(await generate({ secret }));
    expect(await accountApi.facts()).toMatchObject({ mfaEnabled: true });
    await expect(accountApi.mfaDisable({ password })).rejects.toMatchObject({ serverCode: "MFA_REQUIRED" });
    await accountApi.mfaDisable({ password, mfaCode: await generate({ secret }) });
    expect(await accountApi.facts()).toMatchObject({ mfaEnabled: false });
  });

  it("reads the inbox and marks a notification read through the queue (one that is gone counts as done)", async () => {
    const entries = new Map<string, OutboxEntry>();
    const outbox = createOutbox({
      store: { list: async () => [...entries.values()], put: async (e) => void entries.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => entries.delete(i)) },
      send: async () => {},
      handlers: notificationHandlers(notificationsApi),
      now: Date.now,
      newId: () => `e${entries.size + 1}`,
      getUserId: () => userId,
    });
    const kv = new Map<string, string>();
    const inbox = createInboxStore({ api: notificationsApi, kv: { get: async (k) => kv.get(k) ?? null, set: async (k, v) => void kv.set(k, v), delete: async (k) => void kv.delete(k) }, outbox, getUserId: () => userId, kick: () => {} });
    await inbox.refresh();
    expect(inbox.getSnapshot()).toMatchObject({ phase: "ready", offline: false });
    const target = seededNotification ?? "00000000-0000-4000-8000-000000000000";
    if (seededNotification) expect(inbox.getSnapshot().items.map((n) => n.notificationId)).toContain(seededNotification);
    await inbox.markRead(target);
    await outbox.drain();
    expect([...entries.values()][0].status).toBe("ACCEPTED");
    await inbox.refresh();
    expect(inbox.getSnapshot().items.map((n) => n.notificationId)).not.toContain(target);
    expect(await notificationsApi.unreadCount()).toBe(inbox.getSnapshot().unread);
  });

  it("registers this device's push token, switches a kind off, sets quiet hours, and removes the token", async () => {
    const prefs = await notificationsApi.preferences();
    expect(prefs.types.map((t) => t.type)).toEqual(expect.arrayContaining([...NOTIFICATION_TYPES]));
    const updated = await notificationsApi.savePreferences({ disabledTypes: ["ROSTER_PUBLISHED"], quietHours: { start: "22:00", end: "07:00", timeZone: "Australia/Melbourne" } });
    expect(updated.types.find((t) => t.type === "ROSTER_PUBLISHED")?.enabled).toBe(false);
    expect(updated.quietHours).toEqual({ start: "22:00", end: "07:00", timeZone: "Australia/Melbourne" });
    await expect(notificationsApi.savePreferences({ quietHours: { start: "22:00", end: "22:00", timeZone: "UTC" } })).rejects.toMatchObject({ serverCode: "VALIDATION" });
    expect((await notificationsApi.savePreferences({ quietHours: null })).quietHours).toBeNull();

    const token = `ExponentPushToken[e2e-${Date.now().toString(36)}]`;
    await notificationsApi.registerDevice(token, "android");
    await notificationsApi.registerDevice(token, "android"); // a repeat at the next start is fine
    await notificationsApi.unregisterDevice(token);
    await notificationsApi.unregisterDevice(token); // and so is removing it twice
  });
});

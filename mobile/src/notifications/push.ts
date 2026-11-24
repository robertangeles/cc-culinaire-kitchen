/**
 * Push on this phone, as plain logic: whether the person turned it on, the system permission, registering the device's token
 * with the sign-in it belongs to, and removing it again. The native calls (`expo-notifications`) are behind `PushNative`, so the
 * tests drive a fake. The system permission is asked only when the person taps "Turn on", never at launch.
 */

import { PushDataSchema, type PushData } from "@culinaire/shared/schemas/push";
import type { KvStore } from "../storage/kv";
import type { NotificationsApi } from "./notificationsApi";

export type Permission = { status: "granted" | "denied" | "undetermined"; canAskAgain: boolean };

export interface PushNative {
  platform: "android" | "ios";
  permission(): Promise<Permission>;
  /** Shows the system prompt (only when it can still be shown). */
  requestPermission(): Promise<Permission>;
  /** The Expo push token. Throws when this build cannot get one (no Expo project id, no Firebase set-up on Android). */
  token(): Promise<string>;
  /** The system settings page for this app, for a permission that was refused for good. */
  openSettings(): void;
}

/**
 * - `off`: not turned on in the app (or the system has not been asked yet).
 * - `on`: allowed, and this device's token is registered for the signed-in account.
 * - `blocked`: the system permission was refused; only the phone's settings can change it.
 * - `unavailable`: allowed, but this build cannot get a push token (the owner's Expo and Firebase set-up is missing).
 */
export type PushStatus = "checking" | "off" | "on" | "blocked" | "unavailable";

export interface PushDeps {
  native: PushNative;
  api: Pick<NotificationsApi, "registerDevice" | "unregisterDevice">;
  kv: KvStore;
  getUserId: () => number | null;
}

/** The longest sign-out waits for the server to forget this device; the server also drops it when the sign-in ends. */
const UNREGISTER_TIMEOUT_MS = 3000;

export function createPush({ native, api, kv, getUserId }: PushDeps) {
  let status: PushStatus = "checking";
  let busy = false;
  const listeners = new Set<() => void>();
  const set = (next: PushStatus) => {
    status = next;
    listeners.forEach((l) => l());
  };
  const wantedKey = (userId: number) => `push.wanted.${userId}`;
  const tokenKey = (userId: number) => `push.token.${userId}`;

  /** With permission granted: get the token and register it. A server that cannot be reached leaves it "on"; the next sync registers. */
  async function register(userId: number): Promise<void> {
    let token: string;
    try {
      token = await native.token();
    } catch {
      return set("unavailable");
    }
    await kv.set(tokenKey(userId), token);
    set("on");
    await api.registerDevice(token, native.platform).catch(() => undefined);
  }

  async function run(work: (userId: number) => Promise<void>) {
    const userId = getUserId();
    if (userId === null || busy) return;
    busy = true;
    try {
      await work(userId);
    } finally {
      busy = false;
    }
  }

  return {
    getStatus: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    /** At each sign-in and app start: register again if push is on (the token can change, and it belongs to this sign-in). Never prompts. */
    sync(): Promise<void> {
      return run(async (userId) => {
        const permission = await native.permission();
        if ((await kv.get(wantedKey(userId))) !== "1") return set(permission.status === "denied" && !permission.canAskAgain ? "blocked" : "off");
        if (permission.status !== "granted") return set(permission.status === "denied" ? "blocked" : "off");
        await register(userId);
      });
    },

    /** The person tapped "Turn on": ask the system if it may still ask, else send them to the settings. */
    enable(): Promise<void> {
      return run(async (userId) => {
        await kv.set(wantedKey(userId), "1");
        let permission = await native.permission();
        if (permission.status !== "granted" && permission.canAskAgain) permission = await native.requestPermission();
        if (permission.status !== "granted") {
          if (!permission.canAskAgain) native.openSettings();
          return set("blocked");
        }
        await register(userId);
      });
    },

    /** Turned off in the app: the server forgets this device, so nothing is sent to it. */
    disable(): Promise<void> {
      return run(async (userId) => {
        await kv.set(wantedKey(userId), "0");
        const token = await kv.get(tokenKey(userId));
        set("off");
        if (token) {
          await api.unregisterDevice(token).catch(() => undefined);
          await kv.delete(tokenKey(userId));
        }
      });
    },

    /** Before the tokens are cleared at sign-out: the next person on this phone must not get this one's pushes. Best effort and short. */
    async beforeSignOut(): Promise<void> {
      const userId = getUserId();
      if (userId === null) return;
      const token = await kv.get(tokenKey(userId)).catch(() => null);
      if (!token) return;
      await api.unregisterDevice(token, UNREGISTER_TIMEOUT_MS).catch(() => undefined);
      await kv.delete(tokenKey(userId)).catch(() => undefined);
      set("checking");
    },

    openSettings: () => native.openSettings(),
  };
}

export type Push = ReturnType<typeof createPush>;

/** The data of a tapped push, or null for one that is not ours (or a malformed one): ids and an in-app route, never text. */
export function readPushData(data: unknown): PushData | null {
  const parsed = PushDataSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
